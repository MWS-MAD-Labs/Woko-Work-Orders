import type { InternalProcurementStatus, ProposalDecision, Role, WorkflowStage, WorkType } from './types.js';

export const workflowByType: Record<WorkType, readonly WorkflowStage[]> = {
  INTERNAL: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'],
  VENDOR: ['PLANNED', 'FINDING_VENDOR', 'PROPOSAL', 'APPROVAL', 'SCHEDULED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'],
};

export const proposalDecisionTargets: Record<ProposalDecision, WorkflowStage> = {
  APPROVED: 'SCHEDULED',
  REJECTED: 'FINDING_VENDOR',
  REVISION_REQUIRED: 'PROPOSAL',
};

export interface TransitionRequest {
  workType: WorkType;
  from: WorkflowStage;
  to: WorkflowStage;
  roles: readonly Role[];
  reason?: string;
  hasProposalEvidence?: boolean;
  hasCompletionEvidence?: boolean;
  completionEvidenceWaiverReason?: string;
  plannedStartDate?: string;
  completionSummary?: string;
  procurementStatus?: InternalProcurementStatus;
  procurementOverrideReason?: string;
}

export interface TransitionResult {
  allowed: boolean;
  code?: string;
}

export function validateTransition(request: TransitionRequest): TransitionResult {
  const stages = workflowByType[request.workType];
  const fromIndex = stages.indexOf(request.from);
  const toIndex = stages.indexOf(request.to);
  const isManager = request.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
  const isPersonInCharge = request.roles.includes('PERSON_IN_CHARGE');

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return { allowed: false, code: 'INVALID_STAGE' };

  if (request.to === 'COMPLETED' && !isManager) return { allowed: false, code: 'MANAGER_APPROVAL_REQUIRED' };
  if (request.from === 'APPROVAL' && !isManager) return { allowed: false, code: 'MANAGER_APPROVAL_REQUIRED' };
  if (request.workType === 'VENDOR' && request.from === 'APPROVAL') return { allowed: false, code: 'PROPOSAL_DECISION_REQUIRED' };
  if (request.workType === 'VENDOR' && (
    (request.from === 'PLANNED' && request.to === 'FINDING_VENDOR') ||
    (request.from === 'FINDING_VENDOR' && request.to === 'PROPOSAL') ||
    (request.from === 'PROPOSAL' && request.to === 'APPROVAL')
  )) return { allowed: false, code: 'STRUCTURED_VENDOR_ACTION_REQUIRED' };
  if (!isManager && !isPersonInCharge) return { allowed: false, code: 'FORBIDDEN' };

  if (!isManager && toIndex !== fromIndex + 1) return { allowed: false, code: 'ONE_STEP_FORWARD_ONLY' };
  if (isManager && toIndex < fromIndex && !request.reason?.trim()) return { allowed: false, code: 'REASON_REQUIRED' };
  if (isManager && toIndex > fromIndex + 1 && !request.reason?.trim()) return { allowed: false, code: 'REASON_REQUIRED' };

  if (request.from === 'PROPOSAL' && request.to === 'APPROVAL' && !request.hasProposalEvidence) {
    return { allowed: false, code: 'PROPOSAL_EVIDENCE_REQUIRED' };
  }

  if (request.to === 'SCHEDULED' && !request.plannedStartDate) {
    return { allowed: false, code: 'PLANNED_START_DATE_REQUIRED' };
  }

  if (request.to === 'REVIEW' && !request.completionSummary?.trim()) {
    return { allowed: false, code: 'COMPLETION_SUMMARY_REQUIRED' };
  }

  if (request.workType === 'INTERNAL' && request.from === 'IN_PROGRESS' && request.to === 'REVIEW') {
    const unresolved = request.procurementStatus && !['NOT_REQUIRED', 'APPROVED'].includes(request.procurementStatus);
    if (unresolved && (!isManager || !request.procurementOverrideReason?.trim())) {
      return { allowed: false, code: isManager ? 'PROCUREMENT_OVERRIDE_REASON_REQUIRED' : 'PROCUREMENT_UNRESOLVED' };
    }
  }

  if (request.from === 'REVIEW' && request.to === 'COMPLETED') {
    const hasEvidence = request.hasCompletionEvidence || Boolean(request.completionEvidenceWaiverReason?.trim());
    if (!hasEvidence) return { allowed: false, code: 'COMPLETION_EVIDENCE_REQUIRED' };
  }

  return { allowed: true };
}

export function canCreateWorkOrder(roles: readonly Role[]): boolean {
  return roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER' || role === 'PERSON_IN_CHARGE');
}

export function canWorkerRecordProgress(input: {
  roles: readonly Role[];
  assignedWorker: boolean;
  status: string;
  workType: WorkType;
  stage: WorkflowStage;
}): boolean {
  return input.roles.includes('WORKER') && input.assignedWorker && input.status === 'ACTIVE' && input.workType === 'INTERNAL' && input.stage === 'IN_PROGRESS';
}

export const procurementTransitions: Record<InternalProcurementStatus, readonly InternalProcurementStatus[]> = {
  NOT_REQUIRED: ['PROPOSAL_REQUIRED'],
  PROPOSAL_REQUIRED: ['SUBMITTED', 'NOT_REQUIRED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'NOT_REQUIRED'],
  APPROVED: [],
  REJECTED: ['PROPOSAL_REQUIRED', 'NOT_REQUIRED'],
  REVISION_REQUIRED: ['SUBMITTED', 'NOT_REQUIRED'],
};

export function canTransitionProcurement(from: InternalProcurementStatus, to: InternalProcurementStatus): boolean {
  return procurementTransitions[from].includes(to);
}
