import { describe, expect, it } from 'vitest';
import { proposalDecisionSchema, proposalSubmissionSchema, transferDriveEvidenceSchema, validateTransition, vendorSearchSchema } from '@woko/domain';

describe('vendor workflow API contracts', () => {
  it('requires structured vendor actions instead of a generic adjacent transition', () => {
    expect(validateTransition({ workType: 'VENDOR', from: 'PLANNED', to: 'FINDING_VENDOR', roles: ['PERSON_IN_CHARGE'] }).code).toBe('STRUCTURED_VENDOR_ACTION_REQUIRED');
    expect(validateTransition({ workType: 'VENDOR', from: 'APPROVAL', to: 'SCHEDULED', roles: ['FACILITIES_MANAGER'], plannedStartDate: '2026-08-20' }).code).toBe('PROPOSAL_DECISION_REQUIRED');
  });

  it('validates required structured fields', () => {
    expect(vendorSearchSchema.safeParse({ vendorSearchNote: 'Contacted vendors.', contactedVendorName: 'PT Sejahtera', expectedVersion: 1 }).success).toBe(true);
    expect(proposalSubmissionSchema.safeParse({ vendorName: 'PT Sejahtera', quotedCost: 125000000, sourceDriveFileId: 'drive-file-123', expectedVersion: 2 }).success).toBe(true);
    expect(transferDriveEvidenceSchema.safeParse({ evidenceType: 'PROPOSAL', sourceDriveFileId: 'drive-file-123', expectedVersion: 2 }).success).toBe(true);
    expect(proposalDecisionSchema.safeParse({ decision: 'APPROVED', decisionNote: 'Approved.', plannedStartDate: '2026-08-20', expectedVersion: 4 }).success).toBe(true);
  });
});
