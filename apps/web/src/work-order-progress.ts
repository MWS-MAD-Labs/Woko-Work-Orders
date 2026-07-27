import type { InternalProcurementStatus, WorkflowStage, WorkType } from '@woko/domain';

import type { Locale } from './i18n';

const progressCopy = {
  en: {
    phases: ['Planning', 'Ready for Work', 'In Progress', 'Review', 'Completed'],
    details: {
      PLANNED: 'Scope and responsibility are being confirmed.',
      FINDING_VENDOR: 'The team is finding a suitable vendor.',
      PROPOSAL: 'A vendor proposal is being prepared.',
      APPROVAL: 'The proposal is waiting for management approval.',
      SCHEDULED: 'The work is ready. The first progress update will start it.',
      IN_PROGRESS: 'The assigned team is carrying out the work.',
      REVIEW: 'The work was submitted for completion and is waiting for review.',
      COMPLETED: 'The work order has been completed.',
    },
  },
  id: {
    phases: ['Perencanaan', 'Siap Dikerjakan', 'Dikerjakan', 'Peninjauan', 'Selesai'],
    details: {
      PLANNED: 'Ruang lingkup dan penanggung jawab sedang dikonfirmasi.',
      FINDING_VENDOR: 'Tim sedang mencari vendor yang sesuai.',
      PROPOSAL: 'Proposal vendor sedang disiapkan.',
      APPROVAL: 'Proposal sedang menunggu persetujuan manajemen.',
      SCHEDULED: 'Pekerjaan siap. Pembaruan progres pertama akan memulai pekerjaan.',
      IN_PROGRESS: 'Tim yang ditugaskan sedang mengerjakan pekerjaan ini.',
      REVIEW: 'Pekerjaan telah diajukan untuk penyelesaian dan menunggu peninjauan.',
      COMPLETED: 'Work order telah selesai.',
    },
  },
} as const;

export const projectPhases = progressCopy.en.phases;

export function getProjectPhases(locale: Locale = 'en', workType: WorkType = 'INTERNAL') {
  if (workType === 'VENDOR') return locale === 'id' ? ['Direncanakan', 'Persiapan', 'Dikerjakan', 'Pemeriksaan', 'Selesai'] : ['Planned', 'Preparing', 'In progress', 'Checking', 'Completed'];
  return progressCopy[locale].phases;
}

interface ProgressInput {
  workflow_stage: WorkflowStage;
  work_type: WorkType;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  procurement?: { status: InternalProcurementStatus } | null;
}

const phaseByStage: Record<WorkflowStage, number> = {
  PLANNED: 0,
  FINDING_VENDOR: 1,
  PROPOSAL: 1,
  APPROVAL: 1,
  SCHEDULED: 1,
  IN_PROGRESS: 2,
  REVIEW: 3,
  COMPLETED: 4,
};

export function getProjectProgress(order: ProgressInput, locale: Locale = 'en') {
  const basePhaseIndex = order.status === 'COMPLETED' ? 4 : phaseByStage[order.workflow_stage];
  const percentages = [10, 30, 65, 90, 100] as const;
  const copy = progressCopy[locale];
  const procurementStatus = order.work_type === 'INTERNAL' && order.workflow_stage === 'PLANNED' ? order.procurement?.status : undefined;
  const procurementCopy: Record<Locale, Partial<Record<InternalProcurementStatus, string>>> = {
    en: { PROPOSAL_REQUIRED: 'Waiting for Proposal', SUBMITTED: 'Proposal Submitted', REVISION_REQUIRED: 'Waiting for Revised Proposal', REJECTED: 'Proposal Rejected' },
    id: { PROPOSAL_REQUIRED: 'Menunggu Proposal', SUBMITTED: 'Proposal Diajukan', REVISION_REQUIRED: 'Menunggu Revisi Proposal', REJECTED: 'Proposal Ditolak' },
  };
  const isProcuring = Boolean(procurementStatus && !['NOT_REQUIRED', 'APPROVED'].includes(procurementStatus));
  const vendorPhaseLabels = locale === 'id' ? ['Direncanakan', 'Persiapan', 'Dikerjakan', 'Pemeriksaan', 'Selesai'] : ['Planned', 'Preparing', 'In progress', 'Checking', 'Completed'];
  const phaseIndex = isProcuring ? 1 : basePhaseIndex;
  const label = isProcuring ? (locale === 'id' ? 'Pengadaan' : 'Procuring') : order.work_type === 'VENDOR' ? vendorPhaseLabels[phaseIndex] ?? copy.phases[phaseIndex] : copy.phases[phaseIndex];
  return {
    phaseIndex,
    label,
    sublabel: procurementStatus ? procurementCopy[locale][procurementStatus] : undefined,
    percent: percentages[phaseIndex],
    detail: isProcuring ? (locale === 'id' ? 'Pengadaan harus diselesaikan sebelum pekerjaan siap dikerjakan.' : 'Procurement must be resolved before the work is ready to start.') : copy.details[order.workflow_stage],
  };
}

export function getProgressActionLabel(order: ProgressInput, isManager: boolean, locale: Locale = 'en'): string {
  const labels = locale === 'id'
    ? { reopen: 'Buka kembali pekerjaan', reviewProposal: 'Tinjau proposal', waitingApproval: 'Menunggu persetujuan', reviewCompletion: 'Tinjau penyelesaian', waitingFinalCheck: 'Menunggu pemeriksaan akhir', continueProcurement: 'Lanjutkan pengadaan', updateProgress: 'Perbarui progres' }
    : { reopen: 'Reopen work order', reviewProposal: 'Review proposal', waitingApproval: 'Waiting for approval', reviewCompletion: 'Review completion', waitingFinalCheck: 'Waiting for final check', continueProcurement: 'Continue procurement', updateProgress: 'Update progress' };
  if (order.status === 'COMPLETED') return labels.reopen;
  if (order.workflow_stage === 'APPROVAL') return isManager ? labels.reviewProposal : labels.waitingApproval;
  if (order.workflow_stage === 'REVIEW') return isManager ? labels.reviewCompletion : labels.waitingFinalCheck;
  if (order.workflow_stage === 'PLANNED' && order.work_type === 'INTERNAL' && order.procurement && !['NOT_REQUIRED', 'APPROVED'].includes(order.procurement.status)) return labels.continueProcurement;
  return labels.updateProgress;
}

export function getUpdateLabel(updateType: string, locale: Locale = 'en'): string {
  const labels: Record<Locale, Record<string, string>> = {
    en: {
      STAGE_TRANSITION: 'Progress updated', VENDOR_SEARCH_UPDATE: 'Vendor search updated', PROPOSAL_SUBMISSION: 'Proposal recorded',
      PROPOSAL_APPROVAL_REQUESTED: 'Proposal sent for approval', APPROVAL_DECISION: 'Proposal decision recorded',
      PROPOSAL_APPROVAL_SUBMISSION: 'Proposal sent for approval', PROPOSAL_DECISION: 'Proposal decision recorded', REVIEW_SUBMISSION: 'Sent for final check',
      REVIEW_DECISION: 'Final check completed', CONDITION_CHANGE: 'Work condition updated', DUE_DATE_CHANGE: 'Due date changed', PARTICIPANTS_CHANGED: 'Participants changed', FILE_EVIDENCE_ADDED: 'File evidence added', PROGRESS_UPDATE: 'Progress update',
    },
    id: {
      STAGE_TRANSITION: 'Progres diperbarui', VENDOR_SEARCH_UPDATE: 'Pencarian vendor diperbarui', PROPOSAL_SUBMISSION: 'Proposal dicatat',
      PROPOSAL_APPROVAL_REQUESTED: 'Proposal dikirim untuk persetujuan', APPROVAL_DECISION: 'Keputusan persetujuan dicatat',
      PROPOSAL_APPROVAL_SUBMISSION: 'Proposal dikirim untuk persetujuan', PROPOSAL_DECISION: 'Keputusan proposal dicatat', REVIEW_SUBMISSION: 'Dikirim untuk pemeriksaan akhir',
      REVIEW_DECISION: 'Pemeriksaan akhir selesai', CONDITION_CHANGE: 'Kondisi pekerjaan diperbarui', DUE_DATE_CHANGE: 'Tenggat diubah', PARTICIPANTS_CHANGED: 'Orang yang terlibat diubah', FILE_EVIDENCE_ADDED: 'Bukti file ditambahkan', PROGRESS_UPDATE: 'Pembaruan progres',
    },
  };
  return labels[locale][updateType] ?? updateType.replaceAll('_', ' ').toLowerCase();
}
