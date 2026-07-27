import { z } from 'zod';

export const roles = ['ADMINISTRATOR', 'FACILITIES_MANAGER', 'PERSON_IN_CHARGE', 'WORKER', 'OVERSEER'] as const;
export type Role = (typeof roles)[number];

export const workTypes = ['INTERNAL', 'VENDOR'] as const;
export type WorkType = (typeof workTypes)[number];

export const vendorSearchSchema = z.object({
  vendorSearchNote: z.string().trim().min(3).max(2000),
  potentialVendorName: z.string().trim().max(200).optional(),
  contactedVendorName: z.string().trim().max(200).optional(),
  shortlistNote: z.string().trim().max(2000).optional(),
  vendorContactDetails: z.string().trim().max(1000).optional(),
  expectedVersion: z.number().int().positive(),
}).superRefine((value, context) => {
  if (!value.potentialVendorName && !value.contactedVendorName && !value.shortlistNote) {
    context.addIssue({ code: 'custom', path: ['potentialVendorName'], message: 'Add a potential vendor, contacted vendor, or shortlist note.' });
  }
});
export type VendorSearchInput = z.infer<typeof vendorSearchSchema>;

export const proposalSubmissionSchema = z.object({
  vendorName: z.string().trim().min(2).max(200),
  quotedCost: z.coerce.number().positive().max(999999999999.99),
  proposalValidityDate: z.string().date().optional(),
  expectedWorkDuration: z.string().trim().max(300).optional(),
  proposalNotes: z.string().trim().max(2000).optional(),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
  sourceDriveFileId: z.string().trim().min(3).max(300).optional(),
  expectedVersion: z.number().int().positive(),
});
export type ProposalSubmissionInput = z.infer<typeof proposalSubmissionSchema>;

export const proposalDecisions = ['APPROVED', 'REJECTED', 'REVISION_REQUIRED'] as const;
export type ProposalDecision = (typeof proposalDecisions)[number];

export const proposalDecisionSchema = z.object({
  decision: z.enum(proposalDecisions),
  decisionNote: z.string().trim().min(3).max(2000),
  plannedStartDate: z.string().date().optional(),
  expectedVersion: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.decision === 'APPROVED' && !value.plannedStartDate) {
    context.addIssue({ code: 'custom', path: ['plannedStartDate'], message: 'Planned start date is required for an approved proposal.' });
  }
});
export type ProposalDecisionInput = z.infer<typeof proposalDecisionSchema>;

export const workflowStages = [
  'PLANNED',
  'FINDING_VENDOR',
  'PROPOSAL',
  'APPROVAL',
  'SCHEDULED',
  'IN_PROGRESS',
  'REVIEW',
  'COMPLETED',
] as const;
export type WorkflowStage = (typeof workflowStages)[number];

export const priorities = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const;
export type Priority = (typeof priorities)[number];

export const taskConditions = ['ON_TRACK', 'AT_RISK', 'BLOCKED'] as const;
export type TaskCondition = (typeof taskConditions)[number];

export const blockerCategories = [
  'DEPENDENCY',
  'MATERIALS',
  'VENDOR',
  'ACCESS',
  'BUDGET',
  'SAFETY',
  'APPROVAL',
  'OTHER',
] as const;
export type BlockerCategory = (typeof blockerCategories)[number];

export const changeConditionSchema = z.discriminatedUnion('condition', [
  z.object({
    condition: z.literal('AT_RISK'),
    explanation: z.string().trim().min(3).max(2000),
    expectedImpact: z.string().trim().min(3).max(2000),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    condition: z.literal('BLOCKED'),
    blockerCategory: z.enum(blockerCategories),
    explanation: z.string().trim().min(3).max(2000),
    expectedResolutionDate: z.string().date(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    condition: z.literal('ON_TRACK'),
    resolutionNote: z.string().trim().min(3).max(2000),
    expectedVersion: z.number().int().positive(),
  }),
]);
export type ChangeConditionInput = z.infer<typeof changeConditionSchema>;

export const evidenceTypes = ['INITIAL', 'PROGRESS', 'PROPOSAL', 'COMPLETION'] as const;
export type EvidenceType = (typeof evidenceTypes)[number];

export const attachmentSources = ['UPLOAD', 'DRIVE_MOVE', 'DRIVE_COPY', 'DRIVE_EXPORT', 'DRIVE_SHORTCUT'] as const;
export type AttachmentSource = (typeof attachmentSources)[number];

export const attachmentContexts = ['INITIAL', 'PROGRESS_UPDATE', 'VENDOR_PROPOSAL', 'INTERNAL_PROCUREMENT', 'COMPLETION'] as const;
export type AttachmentContext = (typeof attachmentContexts)[number];

export const internalProcurementStatuses = ['NOT_REQUIRED', 'PROPOSAL_REQUIRED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'] as const;
export type InternalProcurementStatus = (typeof internalProcurementStatuses)[number];

const expectedVersionsSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedProcurementVersion: z.number().int().positive(),
});

export const requireProcurementSchema = expectedVersionsSchema.extend({
  requirementNote: z.string().trim().min(3).max(2000),
});

export const updateProcurementSchema = expectedVersionsSchema.extend({
  requirementNote: z.string().trim().min(3).max(2000),
});

export const submitProcurementSchema = expectedVersionsSchema.extend({
  attachmentIds: z.array(z.string().uuid()).min(1).max(20),
  confirmation: z.literal(true),
  note: z.string().trim().max(2000).optional(),
});

export const decideProcurementSchema = expectedVersionsSchema.extend({
  decision: z.enum(['APPROVED', 'REJECTED', 'REVISION_REQUIRED']),
  decisionNote: z.string().trim().min(3).max(2000),
});

export const clearProcurementSchema = expectedVersionsSchema.extend({
  reason: z.string().trim().min(3).max(2000),
});

export const attachmentDraftSchema = z.object({
  context: z.enum(attachmentContexts),
  expectedVersion: z.number().int().positive(),
});

export const driveAttachmentDraftSchema = attachmentDraftSchema.extend({
  sourceDriveFileId: z.string().trim().min(3).max(300),
});

export const evidenceRules = {
  maxFileSizeBytes: 15 * 1024 * 1024,
  maxFilesPerType: 20,
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'],
} as const;

export const linkDriveEvidenceSchema = z.object({
  evidenceType: z.enum(evidenceTypes),
  driveUrl: z.string().url().max(2000),
  expectedVersion: z.number().int().positive(),
});

export const transferDriveEvidenceSchema = z.object({
  evidenceType: z.enum(evidenceTypes),
  attachmentContext: z.enum(attachmentContexts).optional(),
  sourceDriveFileId: z.string().trim().min(3).max(300),
  expectedVersion: z.number().int().positive(),
});

export const changeDueDateSchema = z.object({
  dueDate: z.string().date(),
  reason: z.string().trim().min(3).max(1000),
  expectedVersion: z.number().int().positive(),
});
export type ChangeDueDateInput = z.infer<typeof changeDueDateSchema>;

export const workOrderStatuses = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type WorkOrderStatus = (typeof workOrderStatuses)[number];

export const categories = [
  'BUILDING_STRUCTURE',
  'PAINTING',
  'DOORS_AND_WINDOWS',
  'ELECTRICAL',
  'PLUMBING',
  'AIR_CONDITIONING',
  'FURNITURE',
  'SAFETY_AND_SECURITY',
  'OUTDOOR_AREAS',
  'RENOVATION',
  'OTHER',
] as const;

export const executionWindows = [
  'NO_RESTRICTION',
  'AFTER_SCHOOL_HOURS',
  'WEEKEND_ONLY',
  'SCHOOL_HOLIDAY_ONLY',
  'REQUIRES_AREA_CLOSURE',
  'CUSTOM_RESTRICTION',
] as const;

export const createWorkOrderSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(5000),
  category: z.string().trim().min(1).max(80).regex(/^[A-Z0-9_]+$/),
  campusId: z.string().uuid(),
  buildingId: z.string().uuid(),
  locationOptionId: z.string().uuid().optional(),
  roomOrArea: z.string().trim().max(500).optional(),
  floor: z.string().trim().max(80).optional(),
  assigneeIds: z.array(z.string().uuid()).min(1).max(20),
  workerIds: z.array(z.string().uuid()).max(50).default([]),
  reviewerId: z.string().uuid().optional(),
  overseerIds: z.array(z.string().uuid()).max(50).default([]),
  workType: z.enum(workTypes),
  priority: z.enum(priorities).default('NORMAL'),
  dueDate: z.string().date(),
  plannedStartDate: z.string().date().optional(),
  procurementRequired: z.boolean().optional(),
  procurementRequirementNote: z.string().trim().max(2000).optional(),
  executionWindow: z.enum(executionWindows).default('NO_RESTRICTION'),
  executionWindowNote: z.string().trim().max(500).optional(),
  planSummary: z.string().trim().min(3).max(2000),
}).superRefine((value, context) => {
  if (value.workType === 'INTERNAL' && value.procurementRequired === undefined) {
    context.addIssue({ code: 'custom', path: ['procurementRequired'], message: 'Choose whether procurement is required.' });
  }
  if (value.workType === 'INTERNAL' && value.procurementRequired && !value.procurementRequirementNote?.trim()) {
    context.addIssue({ code: 'custom', path: ['procurementRequirementNote'], message: 'Describe what must be procured.' });
  }
  if (value.workType === 'VENDOR' && (value.procurementRequired !== undefined || value.procurementRequirementNote)) {
    context.addIssue({ code: 'custom', path: ['procurementRequired'], message: 'Internal procurement only applies to internal work orders.' });
  }
  if (value.executionWindow === 'CUSTOM_RESTRICTION' && !value.executionWindowNote) {
    context.addIssue({ code: 'custom', path: ['executionWindowNote'], message: 'Custom restriction note is required.' });
  }
  if (new Set(value.assigneeIds).size !== value.assigneeIds.length) {
    context.addIssue({ code: 'custom', path: ['assigneeIds'], message: 'Each person in charge may only be selected once.' });
  }
  if (new Set(value.workerIds).size !== value.workerIds.length) {
    context.addIssue({ code: 'custom', path: ['workerIds'], message: 'Each worker may only be selected once.' });
  }
  if (new Set(value.overseerIds).size !== value.overseerIds.length) {
    context.addIssue({ code: 'custom', path: ['overseerIds'], message: 'Each overseer may only be selected once.' });
  }
  if (value.workType === 'VENDOR' && value.workerIds.length) {
    context.addIssue({ code: 'custom', path: ['workerIds'], message: 'Vendor work orders cannot have workers.' });
  }
  if (value.reviewerId && value.assigneeIds.includes(value.reviewerId)) {
    context.addIssue({ code: 'custom', path: ['reviewerId'], message: 'Reviewer must be different from every person in charge.' });
  }
  const core = new Set([...value.assigneeIds, ...value.workerIds, ...(value.reviewerId ? [value.reviewerId] : [])]);
  if (core.size !== value.assigneeIds.length + value.workerIds.length + (value.reviewerId ? 1 : 0)) {
    context.addIssue({ code: 'custom', path: ['workerIds'], message: 'A person cannot hold multiple responsibilities on the same work order.' });
  }
  if (value.overseerIds.some((id) => core.has(id))) {
    context.addIssue({ code: 'custom', path: ['overseerIds'], message: 'Overseers must be different from the PIC, workers, and reviewer.' });
  }
});

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

export interface WorkOrderSummary {
  id: string;
  number: string;
  title: string;
  workType: WorkType;
  stage: WorkflowStage;
  condition: TaskCondition;
  status: WorkOrderStatus;
  priority: Priority;
  dueDate: string;
  assignee: { id: string; fullName: string; email: string; profilePhotoUrl?: string };
  building: string;
  roomOrArea: string;
  updatedAt: string;
}
