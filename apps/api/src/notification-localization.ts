export type NotificationLocale = 'id' | 'en';

export interface LocalizableNotification {
  type: string;
  title: string;
  message: string;
}

const typeLabels: Record<string, string> = {
  ASSIGNMENT: 'Penugasan',
  REASSIGNMENT: 'Pengalihan tugas',
  PROGRESS_COMMENT: 'Komentar progres',
  CONDITION_CHANGED: 'Kondisi berubah',
  CRITICAL_PRIORITY_CHANGED: 'Prioritas kritis berubah',
  DUE_DATE_CHANGED: 'Tenggat berubah',
  PROPOSAL_SUBMITTED: 'Proposal menunggu persetujuan',
  PROPOSAL_APPROVED: 'Proposal disetujui',
  PROPOSAL_REJECTED: 'Proposal ditolak',
  PROPOSAL_REVISION_REQUIRED: 'Proposal perlu direvisi',
  COMPLETION_REVIEW_SUBMITTED: 'Ulasan penyelesaian diajukan',
  COMPLETION_APPROVED: 'Penyelesaian disetujui',
  COMPLETION_REJECTED: 'Penyelesaian perlu diperbaiki',
  WORK_ORDER_REOPENED: 'Pekerjaan dibuka kembali',
  WORK_ORDER_CANCELLED: 'Pekerjaan dibatalkan',
  DUE_IN_SEVEN_DAYS: 'Tenggat dalam 7 hari',
  DUE_IN_TWO_DAYS: 'Tenggat dalam 2 hari',
  DUE_TODAY: 'Jatuh tempo hari ini',
  FIRST_DAY_OVERDUE: 'Mulai terlambat hari ini',
  CRITICAL_OVERDUE_REMINDER: 'Kritis dan terlambat',
  OVERDUE_REMINDER: 'Pengingat keterlambatan',
  WORK_LIST_DAILY_REMINDER: 'Pengingat daftar kerja hari ini',
  WORK_LIST_MISSED_DIGEST: 'Ringkasan daftar kerja terlewat',
};

const values: Record<string, string> = {
  CRITICAL: 'Kritis', HIGH: 'Tinggi', NORMAL: 'Normal', LOW: 'Rendah',
  ON_TRACK: 'Sesuai rencana', AT_RISK: 'Berisiko', BLOCKED: 'Terhambat',
  PLANNED: 'Direncanakan', FINDING_VENDOR: 'Mencari vendor', PROPOSAL: 'Proposal', APPROVAL: 'Persetujuan',
  SCHEDULED: 'Terjadwal', IN_PROGRESS: 'Sedang dikerjakan', REVIEW: 'Ulasan', COMPLETED: 'Selesai',
  APPROVED: 'Disetujui', REJECTED: 'Ditolak', REVISION_REQUIRED: 'Perlu revisi', CANCELLED: 'Dibatalkan',
};

export function localizedValue(value: string | null, locale: NotificationLocale): string {
  if (!value) return '—';
  if (locale === 'id') return values[value] ?? value.replaceAll('_', ' ').toLowerCase();
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function localizeTitle(type: string, title: string): string {
  const number = title.match(/FAC-\d{4}-\d{4}/)?.[0];
  const label = typeLabels[type];
  if (!label) return title;
  return number ? `${number}: ${label.toLowerCase()}` : label;
}

function localizeMessage(type: string, message: string): string {
  switch (type) {
    case 'ASSIGNMENT': return message;
    case 'REASSIGNMENT': return message.replace(/^(.+?) was reassigned to (.+?)\. Reason: /, '$1 dialihkan kepada $2. Alasan: ');
    case 'PROGRESS_COMMENT': return message;
    case 'CONDITION_CHANGED': return message.replace(/^(.+?) changed from ([A-Z_ ]+) to ([A-Z_ ]+)\. /, (_match, title, previous, next) => `${title} berubah dari ${localizedValue(previous.trim().replaceAll(' ', '_'), 'id')} menjadi ${localizedValue(next.trim().replaceAll(' ', '_'), 'id')}. `);
    case 'CRITICAL_PRIORITY_CHANGED': return message.replace(/^(.+?) changed from ([A-Z_]+) to ([A-Z_]+)\. Reason: /, (_match, title, previous, next) => `${title} berubah dari ${localizedValue(previous, 'id')} menjadi ${localizedValue(next, 'id')}. Alasan: `);
    case 'DUE_DATE_CHANGED': return message.replace(/^(.+?) is now due (\d{4}-\d{2}-\d{2})\. Reason: /, '$1 sekarang jatuh tempo $2. Alasan: ');
    case 'PROPOSAL_SUBMITTED': return message;
    case 'PROPOSAL_APPROVED':
    case 'PROPOSAL_REJECTED':
    case 'PROPOSAL_REVISION_REQUIRED': return message;
    case 'COMPLETION_REVIEW_SUBMITTED': return message;
    case 'COMPLETION_APPROVED':
    case 'COMPLETION_REJECTED': return message;
    case 'WORK_ORDER_REOPENED': return message.replace(/\. Reason: /, '. Alasan: ');
    case 'WORK_ORDER_CANCELLED': return message.replace(/\. Reason: /, '. Alasan: ');
    case 'DUE_IN_SEVEN_DAYS': return message.replace(/ is due (\d{4}-\d{2}-\d{2})\.$/, ' jatuh tempo $1.');
    case 'DUE_IN_TWO_DAYS': return message.replace(/ is due (\d{4}-\d{2}-\d{2})\.$/, ' jatuh tempo $1.');
    case 'DUE_TODAY': return message.replace(/ is due today\.$/, ' jatuh tempo hari ini.');
    case 'FIRST_DAY_OVERDUE': return message.replace(/ became overdue today\.$/, ' mulai terlambat hari ini.');
    case 'CRITICAL_OVERDUE_REMINDER': return message.replace(/ is critical and (\d+) days overdue\.$/, ' bersifat kritis dan terlambat $1 hari.');
    case 'OVERDUE_REMINDER': return message.replace(/ is (\d+) days overdue\.$/, ' terlambat $1 hari.');
    case 'WORK_LIST_DAILY_REMINDER': return message
      .replace(/^You have ([0-9]+) Work List(s?) with unfinished items today: /, 'Anda memiliki $1 daftar kerja dengan item yang belum selesai hari ini: ')
      .replace(/ Complete them before the deadline\.$/, ' Selesaikan sebelum tenggat.');
    case 'WORK_LIST_MISSED_DIGEST': return message
      .replace(/^([0-9]+) Work List(s?) due (\d{4}-\d{2}-\d{2}) were missed: /, '$1 daftar kerja dengan tenggat $3 terlewat: ')
      .replace(/^([0-9]+) Work List(s?) were missed yesterday: /, '$1 daftar kerja terlewat kemarin: ')
      .replace(/^([0-9]+) Work List(s?) (?:was|were) converted from overdue to missed during deployment: /, '$1 daftar kerja diubah dari terlambat menjadi terlewat saat penerapan sistem: ')
      .replace(/ No worker action is required; this (?:digest|notice) is for facilities monitoring only\.$/, ' Tidak diperlukan tindakan dari pekerja; ringkasan ini hanya untuk pemantauan tim fasilitas.');
    default: return message;
  }
}

export function localizeNotification<T extends LocalizableNotification>(notification: T, locale: NotificationLocale): T {
  if (locale === 'en') return notification;
  return { ...notification, title: localizeTitle(notification.type, notification.title), message: localizeMessage(notification.type, notification.message) };
}

export const emailCopy = {
  en: {
    responsibilityUpdate: 'Responsibility update', assigned: 'Assigned', reassigned: 'Reassigned', scheduleUpdate: 'Schedule update', dueDateChanged: 'Due date changed',
    priorityUpdate: 'Priority update', criticalPriority: 'Critical priority', upcomingDeadline: 'Upcoming deadline', dueIn7Days: 'Due in 7 days', dueIn2Days: 'Due in 2 days',
    deadlineReminder: 'Deadline reminder', dueToday: 'Due today', overdueAlert: 'Overdue alert', firstDayOverdue: 'First day overdue', criticalOverdueAlert: 'Critical overdue alert',
    criticalOverdue: 'Critical & overdue', overdueReminder: 'Overdue reminder', overdue: 'Overdue', conditionUpdate: 'Work condition update', conditionChanged: 'Condition changed',
    vendorProposal: 'Vendor proposal', awaitingApproval: 'Awaiting approval', proposalDecision: 'Vendor proposal decision', approved: 'Approved', rejected: 'Rejected', revisionRequired: 'Revision required',
    completionReview: 'Completion review', reviewSubmitted: 'Review submitted', completionDecision: 'Completion decision', changesRequired: 'Changes required', workOrderStatus: 'Work-order status',
    reopened: 'Reopened', cancelled: 'Cancelled', dailyChecklistReminder: 'Today’s checklist reminder', unfinishedToday: 'Unfinished today', missedMonitoring: 'Facilities monitoring', missed: 'Missed · no action required', workOrderUpdate: 'Work-order update', notification: 'Woko Work Orders notification', priority: 'Priority', condition: 'Condition', stage: 'Stage',
    dueDate: 'Due date', hello: 'Hello', openWorkOrder: 'Open work order', openWorkLists: 'Open Work Lists', signIn: 'Sign in with your Millennia World School Google Workspace account.',
    automated: 'This automated message was sent by Woko Work Orders.', footer: 'Automated notification from Woko Work Orders · MAD Labs · Millennia World School', doNotReply: 'Please do not reply to this email.', facilitiesWork: 'Facilities work', blocked: 'Blocked', onTrack: 'On track', atRisk: 'At risk', progressDiscussion: 'Progress discussion', newComment: 'New comment',
  },
  id: {
    responsibilityUpdate: 'Pembaruan tanggung jawab', assigned: 'Ditugaskan', reassigned: 'Dialihkan', scheduleUpdate: 'Pembaruan jadwal', dueDateChanged: 'Tenggat berubah',
    priorityUpdate: 'Pembaruan prioritas', criticalPriority: 'Prioritas kritis', upcomingDeadline: 'Tenggat mendatang', dueIn7Days: 'Tenggat dalam 7 hari', dueIn2Days: 'Tenggat dalam 2 hari',
    deadlineReminder: 'Pengingat tenggat', dueToday: 'Jatuh tempo hari ini', overdueAlert: 'Peringatan keterlambatan', firstDayOverdue: 'Hari pertama terlambat', criticalOverdueAlert: 'Peringatan kritis dan terlambat',
    criticalOverdue: 'Kritis dan terlambat', overdueReminder: 'Pengingat keterlambatan', overdue: 'Terlambat', conditionUpdate: 'Pembaruan kondisi pekerjaan', conditionChanged: 'Kondisi berubah',
    vendorProposal: 'Proposal vendor', awaitingApproval: 'Menunggu persetujuan', proposalDecision: 'Keputusan proposal vendor', approved: 'Disetujui', rejected: 'Ditolak', revisionRequired: 'Perlu revisi',
    completionReview: 'Ulasan penyelesaian', reviewSubmitted: 'Ulasan diajukan', completionDecision: 'Keputusan penyelesaian', changesRequired: 'Perlu perbaikan', workOrderStatus: 'Status pekerjaan',
    reopened: 'Dibuka kembali', cancelled: 'Dibatalkan', dailyChecklistReminder: 'Pengingat daftar kerja hari ini', unfinishedToday: 'Belum selesai hari ini', missedMonitoring: 'Pemantauan fasilitas', missed: 'Terlewat · tidak perlu tindakan', workOrderUpdate: 'Pembaruan pekerjaan', notification: 'Notifikasi Woko Work Orders', priority: 'Prioritas', condition: 'Kondisi', stage: 'Tahap',
    dueDate: 'Tenggat', hello: 'Halo', openWorkOrder: 'Buka pekerjaan', openWorkLists: 'Buka Daftar Kerja', signIn: 'Masuk dengan akun Google Workspace Millennia World School Anda.',
    automated: 'Pesan otomatis ini dikirim oleh Woko Work Orders.', footer: 'Notifikasi otomatis dari Woko Work Orders · MAD Labs · Millennia World School', doNotReply: 'Mohon jangan membalas email ini.', facilitiesWork: 'Pekerjaan fasilitas', blocked: 'Terhambat', onTrack: 'Sesuai rencana', atRisk: 'Berisiko', progressDiscussion: 'Diskusi progres', newComment: 'Komentar baru',
  },
} as const;
