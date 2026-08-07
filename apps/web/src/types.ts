import type { AttachmentContext, EvidenceType, InternalProcurementStatus, Priority, Role, WorkflowStage, WorkType } from '@woko/domain';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  profilePhotoUrl?: string;
  roles: Role[];
  preferredLocale: 'id' | 'en';
  sessionExpiresAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  active: boolean;
  identity_linked: boolean;
  last_login_at: string | null;
  created_at: string;
  roles: Role[];
}

export interface LocationOption {
  id: string;
  building_id: string;
  parent_id: string | null;
  type_label: string;
  name: string;
  sort_order: number;
}

export interface WorkOption {
  option_type: 'WORK_TYPE' | 'CATEGORY' | 'EXECUTION_WINDOW';
  code: string;
  label: string;
  sort_order: number;
}

export interface ReferenceData {
  users: Array<{ id: string; full_name: string; email: string; roles: Role[] }>;
  campuses: Array<{ id: string; name: string }>;
  buildings: Array<{ id: string; campus_id: string; name: string }>;
  locationOptions: LocationOption[];
  workOptions: WorkOption[];
  periods: Array<{ name: string; type: 'SEMESTER' | 'ACADEMIC_YEAR'; start_date: string; end_date: string; academic_year_label: string }>;
}

export interface AdminWorkOption {
  id: string;
  option_type: 'WORK_TYPE' | 'CATEGORY' | 'EXECUTION_WINDOW';
  code: string;
  label: string;
  active: boolean;
  sort_order: number;
}

export interface AdminLocationData {
  campuses: Array<{ id: string; code: string; name: string; active: boolean }>;
  buildings: Array<{ id: string; campus_id: string; code: string; name: string; active: boolean }>;
  options: Array<LocationOption & { code: string | null; active: boolean }>;
}

export interface WorkOrder {
  id: string;
  work_order_number: string;
  title: string;
  description: string;
  category: string;
  work_type: WorkType;
  priority: Priority;
  condition: 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';
  workflow_stage: WorkflowStage;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  due_date: string;
  planned_start_date: string | null;
  room_or_area: string;
  floor: string | null;
  building: string;
  campus: string;
  assignee_id: string;
  assignee_name: string;
  assignee_email: string;
  assignees: Array<{ id: string; full_name: string; email: string; profile_photo_url: string | null }>;
  workers: Array<{ id: string; full_name: string; email: string; profile_photo_url: string | null }>;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewer_photo_url: string | null;
  overseers: Array<{ id: string; full_name: string; email: string; profile_photo_url: string | null }>;
  procurement: { status: InternalProcurementStatus; requirement_note: string | null; submitted_by_name: string | null; submitted_at: string | null; decided_by_name: string | null; decided_at: string | null; decision_note: string | null; version: number } | null;
  drive_folder_url: string | null;
  drive_provisioning_status: 'PROVISIONING' | 'COMPLETE' | 'FAILED';
  drive_provisioning_error: string | null;
  drive_subfolders: Partial<Record<EvidenceType | 'APPROVALS' | 'OTHER', string>>;
  version: number;
  created_at: string;
  updated_at: string;
  deadlineGroup: string;
  updates?: Array<{ id: string; update_type: string; previous_stage: string | null; new_stage: string | null; note: string; structured_data: Record<string, unknown>; author: string; created_at: string; comments: Array<{ id: string; body: string; author_id: string; author: string; created_at: string }> }>;
  audits?: Array<{ id: string; event_type: string; previous_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; reason: string | null; author: string | null; created_at: string }>;
  attachments?: Array<{ id: string; evidence_type: EvidenceType; attachment_context: AttachmentContext; source_type: 'UPLOAD' | 'DRIVE_LINK' | 'DRIVE_COPY' | 'DRIVE_MOVE' | 'DRIVE_SHORTCUT'; file_name: string; original_file_name: string | null; mime_type: string; file_size: number | null; drive_url: string; uploaded_by: string; created_at: string }>;
}

export type WorkListItemStatus = 'COMPLETED' | 'NOT_APPLICABLE' | 'ISSUE_FOUND';
export interface WorkListOccurrence { id: string; template_id: string; template_version: number; recurrence: 'DAILY' | 'WEEKLY' | 'MONTHLY'; period_date: string; due_at: string; status: 'OPEN' | 'OVERDUE' | 'MISSED' | 'SUBMITTED' | 'SUBMITTED_LATE'; location_snapshot: { name: string }; template_snapshot: { title: string; instructions: string }; overall_note: string | null; submitted_at: string | null; version: number; workers?: Array<{ id: string; full_name: string; profile_photo_url: string | null }>; required_resolved_count?: number; required_count?: number; item_count?: number; preview_items?: Array<{ id: string; title: string; instructions: string; required: boolean; sort_order: number; status: WorkListItemStatus | null; note: string | null; resolved_by: string | null }>; items?: Array<{ id: string; title: string; instructions: string; required: boolean; sort_order: number; status: WorkListItemStatus | null; note: string | null; resolved_by: string | null; resolved_at: string | null; evidence: Array<{ id: string; drive_url: string; file_name: string; uploaded_by: string; created_at: string }> }>; evidence?: Array<{ id: string; drive_url: string; file_name: string; uploaded_by: string; created_at: string }>; }
export interface WorkListTemplate { id: string; title: string; instructions: string; active: boolean; version: number; location_ids: string[]; worker_ids: string[]; items: Array<{ id?: string; title: string; instructions: string; recurrence: 'DAILY' | 'WEEKLY' | 'MONTHLY'; required: boolean; sort_order?: number }>; }

export interface ProposalApprovalItem {
  id: string;
  work_order_number: string;
  title: string;
  priority: Priority;
  due_date: string;
  version: number;
  workflow_stage: 'APPROVAL';
  assignee_name: string;
  proposal_data: {
    vendorName: string;
    quotedCost: number;
    proposalValidityDate?: string;
    expectedWorkDuration?: string;
    proposalNotes?: string;
  };
  submitted_at: string;
  submitted_by_id: string;
  submitted_by_name: string;
  can_decide: boolean;
}

export interface CompletionReviewItem {
  id: string;
  work_order_number: string;
  title: string;
  priority: Priority;
  due_date: string;
  version: number;
  workflow_stage: 'REVIEW';
  assignee_name: string;
  completion_summary: string;
  submitted_at: string;
  submitted_by_id: string;
  submitted_by_name: string;
  completion_evidence: Array<{
    id: string;
    file_name: string;
    mime_type: string;
    drive_url: string;
    uploaded_by: string;
    created_at: string;
  }>;
  decision_history: Array<{
    id: string;
    decision: 'APPROVED' | 'REJECTED';
    note: string;
    waiver_reason: string | null;
    decided_by: string;
    decided_at: string;
  }>;
}

export interface InternalProcurementReviewItem {
  id: string;
  work_order_number: string;
  title: string;
  priority: Priority;
  due_date: string;
  version: number;
  procurement_version: number;
  requirement_note: string;
  submitted_at: string;
  submitted_by_name: string;
  proposal_documents: Array<{ id: string; file_name: string; mime_type: string; drive_url: string; uploaded_by: string }>;
}

export interface ApprovalQueue {
  proposalApprovals: ProposalApprovalItem[];
  completionReviews: CompletionReviewItem[];
  internalProcurementReviews: InternalProcurementReviewItem[];
}
