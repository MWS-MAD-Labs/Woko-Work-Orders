import { describe, expect, it } from 'vitest';
import { getDeadlineGroup, isOverdue } from './deadlines.js';
import { formatWorkOrderNumber } from './work-order-number.js';
import { canCreateWorkOrder, canTransitionProcurement, canWorkerRecordProgress, proposalDecisionTargets, validateTransition } from './workflow.js';
import { changeConditionSchema, changeDueDateSchema, createWorkOrderSchema, proposalDecisionSchema, proposalSubmissionSchema, roles, vendorSearchSchema } from './types.js';

describe('workflow transitions', () => {
  it('allows a person in charge to move one internal stage forward', () => {
    expect(validateTransition({ workType: 'INTERNAL', from: 'PLANNED', to: 'SCHEDULED', roles: ['PERSON_IN_CHARGE'], plannedStartDate: '2026-07-20' })).toEqual({ allowed: true });
  });

  it('does not allow a person in charge to complete their own work', () => {
    expect(validateTransition({ workType: 'INTERNAL', from: 'REVIEW', to: 'COMPLETED', roles: ['PERSON_IN_CHARGE'], hasCompletionEvidence: true }).code).toBe('MANAGER_APPROVAL_REQUIRED');
  });

  it('requires a reason when a manager skips stages', () => {
    expect(validateTransition({ workType: 'VENDOR', from: 'PLANNED', to: 'PROPOSAL', roles: ['FACILITIES_MANAGER'] }).code).toBe('REASON_REQUIRED');
  });

  it('requires the structured endpoint for proposal submission', () => {
    expect(validateTransition({ workType: 'VENDOR', from: 'PROPOSAL', to: 'APPROVAL', roles: ['PERSON_IN_CHARGE'] }).code).toBe('STRUCTURED_VENDOR_ACTION_REQUIRED');
  });

  it('requires a planned start date before scheduling', () => {
    expect(validateTransition({ workType: 'INTERNAL', from: 'PLANNED', to: 'SCHEDULED', roles: ['PERSON_IN_CHARGE'] }).code).toBe('PLANNED_START_DATE_REQUIRED');
  });

  it('requires a completion summary before review', () => {
    expect(validateTransition({ workType: 'INTERNAL', from: 'IN_PROGRESS', to: 'REVIEW', roles: ['PERSON_IN_CHARGE'] }).code).toBe('COMPLETION_SUMMARY_REQUIRED');
  });

  it('requires completion evidence or a manager waiver', () => {
    expect(validateTransition({ workType: 'INTERNAL', from: 'REVIEW', to: 'COMPLETED', roles: ['FACILITIES_MANAGER'] }).code).toBe('COMPLETION_EVIDENCE_REQUIRED');
    expect(validateTransition({ workType: 'INTERNAL', from: 'REVIEW', to: 'COMPLETED', roles: ['FACILITIES_MANAGER'], hasCompletionEvidence: true }).allowed).toBe(true);
    expect(validateTransition({ workType: 'INTERNAL', from: 'REVIEW', to: 'COMPLETED', roles: ['FACILITIES_MANAGER'], completionEvidenceWaiverReason: 'Camera was unavailable after an emergency repair.' }).allowed).toBe(true);
  });

  it('does not grant workflow transitions to workers', () => {
    expect(validateTransition({ workType: 'INTERNAL', from: 'IN_PROGRESS', to: 'REVIEW', roles: ['WORKER'], completionSummary: 'Finished.' }).code).toBe('FORBIDDEN');
  });

  it('blocks unresolved procurement and requires a manager override reason', () => {
    expect(validateTransition({ workType: 'INTERNAL', from: 'IN_PROGRESS', to: 'REVIEW', roles: ['PERSON_IN_CHARGE'], completionSummary: 'Finished.', procurementStatus: 'SUBMITTED' }).code).toBe('PROCUREMENT_UNRESOLVED');
    expect(validateTransition({ workType: 'INTERNAL', from: 'IN_PROGRESS', to: 'REVIEW', roles: ['FACILITIES_MANAGER'], completionSummary: 'Finished.', procurementStatus: 'SUBMITTED' }).code).toBe('PROCUREMENT_OVERRIDE_REASON_REQUIRED');
    expect(validateTransition({ workType: 'INTERNAL', from: 'IN_PROGRESS', to: 'REVIEW', roles: ['FACILITIES_MANAGER'], completionSummary: 'Finished.', procurementStatus: 'SUBMITTED', procurementOverrideReason: 'Emergency safety work cannot wait for Finance.' }).allowed).toBe(true);
  });
});

describe('vendor workflow inputs', () => {
  it('requires a concrete vendor-search result', () => {
    expect(vendorSearchSchema.safeParse({ vendorSearchNote: 'Called vendors.', expectedVersion: 1 }).success).toBe(false);
    expect(vendorSearchSchema.safeParse({ vendorSearchNote: 'Called vendors.', contactedVendorName: 'PT Sejahtera', expectedVersion: 1 }).success).toBe(true);
  });

  it('requires a positive quoted cost', () => {
    expect(proposalSubmissionSchema.safeParse({ vendorName: 'PT Sejahtera', quotedCost: 0, expectedVersion: 1 }).success).toBe(false);
  });

  it('requires a planned start date when approving', () => {
    expect(proposalDecisionSchema.safeParse({ decision: 'APPROVED', decisionNote: 'Approved.', expectedVersion: 1 }).success).toBe(false);
  });

  it('maps every management decision to the required stage', () => {
    expect(proposalDecisionTargets).toEqual({ APPROVED: 'SCHEDULED', REJECTED: 'FINDING_VENDOR', REVISION_REQUIRED: 'PROPOSAL' });
  });
});

describe('condition changes', () => {
  it('requires an explanation and expected impact for at-risk work', () => {
    expect(changeConditionSchema.safeParse({ condition: 'AT_RISK', explanation: 'Delivery may slip', expectedVersion: 1 }).success).toBe(false);
    expect(changeConditionSchema.safeParse({ condition: 'AT_RISK', explanation: 'Delivery may slip', expectedImpact: 'Review could move by two days', expectedVersion: 1 }).success).toBe(true);
  });

  it('requires blocker details and a resolution date', () => {
    expect(changeConditionSchema.safeParse({ condition: 'BLOCKED', blockerCategory: 'MATERIALS', explanation: 'Replacement hinge is unavailable', expectedVersion: 1 }).success).toBe(false);
    expect(changeConditionSchema.safeParse({ condition: 'BLOCKED', blockerCategory: 'MATERIALS', explanation: 'Replacement hinge is unavailable', expectedResolutionDate: '2026-07-22', expectedVersion: 1 }).success).toBe(true);
  });

  it('requires a resolution note when returning on track', () => {
    expect(changeConditionSchema.safeParse({ condition: 'ON_TRACK', expectedVersion: 1 }).success).toBe(false);
    expect(changeConditionSchema.safeParse({ condition: 'ON_TRACK', resolutionNote: 'Replacement hinge arrived', expectedVersion: 1 }).success).toBe(true);
  });
});

describe('due-date changes', () => {
  it('requires a manager reason', () => {
    expect(changeDueDateSchema.safeParse({ dueDate: '2026-07-31', expectedVersion: 1 }).success).toBe(false);
    expect(changeDueDateSchema.safeParse({ dueDate: '2026-07-31', reason: 'Vendor delivery was rescheduled', expectedVersion: 1 }).success).toBe(true);
  });
});

describe('deadline grouping', () => {
  const today = new Date('2026-07-17T05:00:00Z');

  it('groups active overdue work', () => {
    expect(getDeadlineGroup({ dueDate: '2026-07-16', status: 'ACTIVE', today })).toBe('OVERDUE');
    expect(isOverdue('2026-07-16', 'ACTIVE', today)).toBe(true);
  });

  it('calculates overdue independently from task condition', () => {
    const dueDate = '2026-07-16';
    expect(getDeadlineGroup({ dueDate, status: 'ACTIVE', today })).toBe('OVERDUE');
  });

  it('keeps completed work in the archive', () => {
    expect(getDeadlineGroup({ dueDate: '2026-01-01', status: 'COMPLETED', today })).toBe('ARCHIVE');
  });

  it('uses a Monday-to-Sunday week', () => {
    expect(getDeadlineGroup({ dueDate: '2026-07-19', status: 'ACTIVE', today })).toBe('THIS_WEEK');
    expect(getDeadlineGroup({ dueDate: '2026-07-20', status: 'ACTIVE', today })).toBe('THIS_MONTH');
  });
});

describe('work-order number', () => {
  it('uses a stable padded format', () => {
    expect(formatWorkOrderNumber(2026, 48)).toBe('FAC-2026-0048');
  });
});

describe('v0.6 authorization policies', () => {
  it('includes the worker role and permits PIC creation', () => {
    expect(roles).toContain('WORKER');
    expect(canCreateWorkOrder(['PERSON_IN_CHARGE'])).toBe(true);
    expect(canCreateWorkOrder(['WORKER'])).toBe(false);
  });

  it('allows worker progress only for assigned active internal work in progress', () => {
    expect(canWorkerRecordProgress({ roles: ['WORKER'], assignedWorker: true, status: 'ACTIVE', workType: 'INTERNAL', stage: 'IN_PROGRESS' })).toBe(true);
    expect(canWorkerRecordProgress({ roles: ['WORKER'], assignedWorker: true, status: 'ACTIVE', workType: 'VENDOR', stage: 'IN_PROGRESS' })).toBe(false);
    expect(canWorkerRecordProgress({ roles: ['WORKER'], assignedWorker: false, status: 'ACTIVE', workType: 'INTERNAL', stage: 'IN_PROGRESS' })).toBe(false);
  });

  it('validates procurement transitions', () => {
    expect(canTransitionProcurement('NOT_REQUIRED', 'PROPOSAL_REQUIRED')).toBe(true);
    expect(canTransitionProcurement('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransitionProcurement('APPROVED', 'SUBMITTED')).toBe(false);
  });
});

describe('work-order creation', () => {
  const valid = {
    title: 'Repair classroom doors',
    description: 'Repair the hinges and frames on four classroom doors.',
    category: 'DOORS_AND_WINDOWS',
    campusId: '10000000-0000-4000-8000-000000000001',
    buildingId: '20000000-0000-4000-8000-000000000001',
    locationOptionId: '50000000-0000-4000-8000-000000000001',
    roomOrArea: 'Classrooms 2A-2D',
    assigneeIds: ['30000000-0000-4000-8000-000000000002'],
    workerIds: [],
    overseerIds: [],
    workType: 'INTERNAL',
    priority: 'HIGH',
    dueDate: '2026-07-31',
    executionWindow: 'NO_RESTRICTION',
    planSummary: 'Inspect and replace damaged hinges.',
  } as const;

  it('accepts a complete internal work order', () => {
    expect(createWorkOrderSchema.safeParse(valid).success).toBe(true);
  });

  it('allows a work order at building level without area or floor details', () => {
    const { locationOptionId: _locationOptionId, roomOrArea: _roomOrArea, ...buildingOnly } = valid;
    expect(createWorkOrderSchema.safeParse(buildingOnly).success).toBe(true);
  });

  it('requires a note for custom execution restrictions', () => {
    const result = createWorkOrderSchema.safeParse({ ...valid, executionWindow: 'CUSTOM_RESTRICTION' });
    expect(result.success).toBe(false);
  });

  it('rejects a reviewer who is also a PIC', () => {
    const result = createWorkOrderSchema.safeParse({ ...valid, reviewerId: valid.assigneeIds[0] });
    expect(result.success).toBe(false);
  });

  it('rejects workers on vendor work and duplicate responsibilities', () => {
    const workerId = '30000000-0000-4000-8000-000000000003';
    expect(createWorkOrderSchema.safeParse({ ...valid, workType: 'VENDOR', workerIds: [workerId] }).success).toBe(false);
    expect(createWorkOrderSchema.safeParse({ ...valid, workerIds: valid.assigneeIds }).success).toBe(false);
  });
});
