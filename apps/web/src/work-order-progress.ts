import type { WorkflowStage, WorkType } from '@woko/domain';

import type { Locale } from './i18n';

const progressCopy = {
  en: {
    phases: ['Planned', 'Preparing', 'In progress', 'Checking', 'Completed'],
    details: {
      PLANNED: 'Scope and responsibility are being confirmed.',
      FINDING_VENDOR: 'The team is finding a suitable vendor.',
      PROPOSAL: 'A vendor proposal is being prepared.',
      APPROVAL: 'The proposal is waiting for management approval.',
      SCHEDULED: 'The work is ready and waiting for its start date.',
      IN_PROGRESS: 'The assigned team is carrying out the work.',
      REVIEW: 'The work is finished and waiting for a final check.',
      COMPLETED: 'The work order has been completed.',
    },
  },
  id: {
    phases: ['Direncanakan', 'Persiapan', 'Dikerjakan', 'Pemeriksaan', 'Selesai'],
    details: {
      PLANNED: 'Ruang lingkup dan penanggung jawab sedang dikonfirmasi.',
      FINDING_VENDOR: 'Tim sedang mencari vendor yang sesuai.',
      PROPOSAL: 'Proposal vendor sedang disiapkan.',
      APPROVAL: 'Proposal sedang menunggu persetujuan manajemen.',
      SCHEDULED: 'Pekerjaan siap dan menunggu tanggal mulai.',
      IN_PROGRESS: 'Tim yang ditugaskan sedang mengerjakan pekerjaan ini.',
      REVIEW: 'Pekerjaan telah selesai dan menunggu pemeriksaan akhir.',
      COMPLETED: 'Work order telah selesai.',
    },
  },
} as const;

export const projectPhases = progressCopy.en.phases;

export function getProjectPhases(locale: Locale = 'en') {
  return progressCopy[locale].phases;
}

interface ProgressInput {
  workflow_stage: WorkflowStage;
  work_type: WorkType;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
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
  const phaseIndex = order.status === 'COMPLETED' ? 4 : phaseByStage[order.workflow_stage];
  const percentages = [10, 30, 65, 90, 100] as const;
  const copy = progressCopy[locale];
  return {
    phaseIndex,
    label: copy.phases[phaseIndex],
    percent: percentages[phaseIndex],
    detail: copy.details[order.workflow_stage],
  };
}

export function getProgressActionLabel(order: ProgressInput, isManager: boolean): string {
  if (order.status === 'COMPLETED') return 'Reopen work order';
  if (order.workflow_stage === 'APPROVAL') return isManager ? 'Review proposal' : 'Waiting for approval';
  if (order.workflow_stage === 'REVIEW') return isManager ? 'Review completion' : 'Waiting for final check';
  return 'Update progress';
}

export function getUpdateLabel(updateType: string, locale: Locale = 'en'): string {
  const labels: Record<Locale, Record<string, string>> = {
    en: {
      STAGE_TRANSITION: 'Progress updated', VENDOR_SEARCH_UPDATE: 'Vendor search updated', PROPOSAL_SUBMISSION: 'Proposal recorded',
      PROPOSAL_APPROVAL_SUBMISSION: 'Proposal sent for approval', PROPOSAL_DECISION: 'Proposal decision recorded', REVIEW_SUBMISSION: 'Sent for final check',
      REVIEW_DECISION: 'Final check completed', CONDITION_CHANGE: 'Work condition updated', DUE_DATE_CHANGE: 'Due date changed', PARTICIPANTS_CHANGED: 'Participants changed', FILE_EVIDENCE_ADDED: 'File evidence added', PROGRESS_UPDATE: 'Progress update',
    },
    id: {
      STAGE_TRANSITION: 'Progres diperbarui', VENDOR_SEARCH_UPDATE: 'Pencarian vendor diperbarui', PROPOSAL_SUBMISSION: 'Proposal dicatat',
      PROPOSAL_APPROVAL_SUBMISSION: 'Proposal dikirim untuk persetujuan', PROPOSAL_DECISION: 'Keputusan proposal dicatat', REVIEW_SUBMISSION: 'Dikirim untuk pemeriksaan akhir',
      REVIEW_DECISION: 'Pemeriksaan akhir selesai', CONDITION_CHANGE: 'Kondisi pekerjaan diperbarui', DUE_DATE_CHANGE: 'Tenggat diubah', PARTICIPANTS_CHANGED: 'Orang yang terlibat diubah', FILE_EVIDENCE_ADDED: 'Bukti file ditambahkan', PROGRESS_UPDATE: 'Pembaruan progres',
    },
  };
  return labels[locale][updateType] ?? updateType.replaceAll('_', ' ').toLowerCase();
}
