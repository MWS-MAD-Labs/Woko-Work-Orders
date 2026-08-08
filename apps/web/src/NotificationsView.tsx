import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileCheck2,
  Info,
  Mail,
  MailCheck,
  MessageSquare,
  RefreshCcw,
  UserRoundPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS, id as idLocale } from 'date-fns/locale';
import { api } from './api';
import { storedLocale, type Locale } from './i18n';

export interface NotificationItem {
  id: string;
  work_order_id: string | null;
  work_order_number: string | null;
  type: string;
  title: string;
  message: string;
  read_status: boolean;
  email_status: string;
  email_attempts: number;
  email_last_error: string | null;
  created_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
}

type NotificationTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

interface NotificationPresentation {
  category: string;
  label: string;
  tone: NotificationTone;
  icon: LucideIcon;
  informational?: boolean;
}

interface DigestItem {
  id: string;
  template_id: string;
  status: string;
  recurrence: string;
  period_date: string;
  due_at: string;
  title: string;
  location: string;
  item_count: number;
  resolved_count: number;
  workers: string[];
}

interface DigestDetail {
  id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  period_start: string | null;
  period_end: string | null;
  items: DigestItem[];
}

const presentations: Record<Locale, Record<string, NotificationPresentation>> = {
  en: {
    ASSIGNMENT: { category: 'Responsibility update', label: 'Assigned', tone: 'info', icon: UserRoundPlus },
    REASSIGNMENT: { category: 'Responsibility update', label: 'Reassigned', tone: 'info', icon: RefreshCcw },
    PROGRESS_COMMENT: { category: 'Progress discussion', label: 'New comment', tone: 'info', icon: MessageSquare },
    DUE_DATE_CHANGED: { category: 'Schedule update', label: 'Due date changed', tone: 'warning', icon: CalendarClock },
    CRITICAL_PRIORITY_CHANGED: { category: 'Priority update', label: 'Critical priority', tone: 'danger', icon: AlertTriangle },
    DUE_IN_SEVEN_DAYS: { category: 'Upcoming deadline', label: 'Due in 7 days', tone: 'info', icon: CalendarClock },
    DUE_IN_TWO_DAYS: { category: 'Upcoming deadline', label: 'Due in 2 days', tone: 'warning', icon: CalendarClock },
    DUE_TODAY: { category: 'Deadline reminder', label: 'Due today', tone: 'danger', icon: AlertTriangle },
    FIRST_DAY_OVERDUE: { category: 'Overdue alert', label: 'Overdue today', tone: 'danger', icon: AlertTriangle },
    CRITICAL_OVERDUE_REMINDER: { category: 'Critical overdue alert', label: 'Action required', tone: 'danger', icon: AlertTriangle },
    OVERDUE_REMINDER: { category: 'Overdue reminder', label: 'Overdue', tone: 'danger', icon: AlertTriangle },
    CONDITION_CHANGED: { category: 'Condition update', label: 'Status changed', tone: 'warning', icon: AlertTriangle },
    PROPOSAL_SUBMITTED: { category: 'Vendor proposal', label: 'Awaiting approval', tone: 'warning', icon: FileCheck2 },
    PROPOSAL_APPROVED: { category: 'Proposal decision', label: 'Approved', tone: 'success', icon: CircleCheck },
    PROPOSAL_REJECTED: { category: 'Proposal decision', label: 'Rejected', tone: 'danger', icon: CircleX },
    PROPOSAL_REVISION_REQUIRED: { category: 'Proposal decision', label: 'Revision required', tone: 'warning', icon: RefreshCcw },
    COMPLETION_REVIEW_SUBMITTED: { category: 'Completion review', label: 'Review submitted', tone: 'info', icon: ClipboardCheck },
    COMPLETION_APPROVED: { category: 'Completion decision', label: 'Approved', tone: 'success', icon: CircleCheck },
    COMPLETION_REJECTED: { category: 'Completion decision', label: 'Changes required', tone: 'danger', icon: CircleX },
    WORK_ORDER_REOPENED: { category: 'Work order status', label: 'Reopened', tone: 'warning', icon: RefreshCcw },
    WORK_ORDER_CANCELLED: { category: 'Work order status', label: 'Cancelled', tone: 'neutral', icon: CircleX },
    WORK_LIST_DAILY_REMINDER: { category: 'Routine Work reminder', label: 'Unfinished today', tone: 'warning', icon: ClipboardList },
    WORK_LIST_MISSED_DIGEST: { category: 'Routine Work monitoring', label: 'No action required', tone: 'warning', icon: Info, informational: true },
    WORK_LIST_WEEKLY_DIGEST: { category: 'Routine Work report', label: 'Weekly summary', tone: 'info', icon: BarChart3, informational: true },
  },
  id: {
    ASSIGNMENT: { category: 'Pembaruan tanggung jawab', label: 'Ditugaskan', tone: 'info', icon: UserRoundPlus },
    REASSIGNMENT: { category: 'Pembaruan tanggung jawab', label: 'Dialihkan', tone: 'info', icon: RefreshCcw },
    PROGRESS_COMMENT: { category: 'Diskusi progres', label: 'Komentar baru', tone: 'info', icon: MessageSquare },
    DUE_DATE_CHANGED: { category: 'Pembaruan jadwal', label: 'Tanggal tenggat diubah', tone: 'warning', icon: CalendarClock },
    CRITICAL_PRIORITY_CHANGED: { category: 'Pembaruan prioritas', label: 'Prioritas kritis', tone: 'danger', icon: AlertTriangle },
    DUE_IN_SEVEN_DAYS: { category: 'Tenggat mendatang', label: 'Jatuh tempo dalam 7 hari', tone: 'info', icon: CalendarClock },
    DUE_IN_TWO_DAYS: { category: 'Tenggat mendatang', label: 'Jatuh tempo dalam 2 hari', tone: 'warning', icon: CalendarClock },
    DUE_TODAY: { category: 'Pengingat tenggat', label: 'Jatuh tempo hari ini', tone: 'danger', icon: AlertTriangle },
    FIRST_DAY_OVERDUE: { category: 'Peringatan keterlambatan', label: 'Mulai terlambat hari ini', tone: 'danger', icon: AlertTriangle },
    CRITICAL_OVERDUE_REMINDER: { category: 'Peringatan keterlambatan kritis', label: 'Perlu tindakan', tone: 'danger', icon: AlertTriangle },
    OVERDUE_REMINDER: { category: 'Pengingat keterlambatan', label: 'Terlambat', tone: 'danger', icon: AlertTriangle },
    CONDITION_CHANGED: { category: 'Pembaruan kondisi', label: 'Status berubah', tone: 'warning', icon: AlertTriangle },
    PROPOSAL_SUBMITTED: { category: 'Proposal vendor', label: 'Menunggu persetujuan', tone: 'warning', icon: FileCheck2 },
    PROPOSAL_APPROVED: { category: 'Keputusan proposal', label: 'Disetujui', tone: 'success', icon: CircleCheck },
    PROPOSAL_REJECTED: { category: 'Keputusan proposal', label: 'Ditolak', tone: 'danger', icon: CircleX },
    PROPOSAL_REVISION_REQUIRED: { category: 'Keputusan proposal', label: 'Perlu revisi', tone: 'warning', icon: RefreshCcw },
    COMPLETION_REVIEW_SUBMITTED: { category: 'Tinjauan penyelesaian', label: 'Diajukan untuk ditinjau', tone: 'info', icon: ClipboardCheck },
    COMPLETION_APPROVED: { category: 'Keputusan penyelesaian', label: 'Disetujui', tone: 'success', icon: CircleCheck },
    COMPLETION_REJECTED: { category: 'Keputusan penyelesaian', label: 'Perlu perubahan', tone: 'danger', icon: CircleX },
    WORK_ORDER_REOPENED: { category: 'Status pekerjaan', label: 'Dibuka kembali', tone: 'warning', icon: RefreshCcw },
    WORK_ORDER_CANCELLED: { category: 'Status pekerjaan', label: 'Dibatalkan', tone: 'neutral', icon: CircleX },
    WORK_LIST_DAILY_REMINDER: { category: 'Pengingat Pekerjaan Rutin', label: 'Belum selesai hari ini', tone: 'warning', icon: ClipboardList },
    WORK_LIST_MISSED_DIGEST: { category: 'Pemantauan Pekerjaan Rutin', label: 'Tidak perlu tindakan', tone: 'warning', icon: Info, informational: true },
    WORK_LIST_WEEKLY_DIGEST: { category: 'Laporan Pekerjaan Rutin', label: 'Ringkasan mingguan', tone: 'info', icon: BarChart3, informational: true },
  },
};

const defaultPresentations: Record<Locale, NotificationPresentation> = {
  en: { category: 'Work update', label: 'Update', tone: 'info', icon: Bell },
  id: { category: 'Pembaruan pekerjaan', label: 'Pembaruan', tone: 'info', icon: Bell },
};

const statusLabels: Record<Locale, Record<string, string>> = {
  en: { OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', MISSED: 'Missed', SUBMITTED: 'Submitted', ISSUE_FOUND: 'Issue found', NOT_APPLICABLE: 'Not applicable' },
  id: { OPEN: 'Terbuka', IN_PROGRESS: 'Sedang dikerjakan', COMPLETED: 'Selesai', MISSED: 'Terlewat', SUBMITTED: 'Diajukan', ISSUE_FOUND: 'Masalah ditemukan', NOT_APPLICABLE: 'Tidak berlaku' },
};

const recurrenceLabels: Record<Locale, Record<string, string>> = {
  en: { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' },
  id: { DAILY: 'Harian', WEEKLY: 'Mingguan', MONTHLY: 'Bulanan' },
};


function enumLabel(value: string, locale: Locale, labels: Record<Locale, Record<string, string>>) {
  return labels[locale][value] ?? value.replaceAll('_', ' ').toLocaleLowerCase(locale === 'id' ? 'id-ID' : 'en-US');
}

function presentationFor(item: NotificationItem, locale: Locale): NotificationPresentation {
  const presentation = presentations[locale][item.type] ?? defaultPresentations[locale];
  if (item.type !== 'CONDITION_CHANGED') return presentation;
  if (/\bBLOCKED\b/i.test(item.title) || /\bto BLOCKED\b/i.test(item.message)) return { ...presentation, label: locale === 'id' ? 'Terhambat' : 'Blocked', tone: 'danger' };
  if (/\bON[ _]TRACK\b/i.test(item.title) || /\bto ON[ _]TRACK\b/i.test(item.message)) return { ...presentation, label: locale === 'id' ? 'Sesuai rencana' : 'On track', tone: 'success', icon: CircleCheck };
  return { ...presentation, label: locale === 'id' ? 'Berisiko' : 'At risk' };
}

function extractWorkListMessage(message: string) {
  let summary = message.trim();
  let note: string | null = null;
  const noteMatch = summary.match(/\s+(No worker action is required;.+)$/i);
  if (noteMatch?.index !== undefined && noteMatch[1]) {
    note = noteMatch[1];
    summary = summary.slice(0, noteMatch.index).trim();
  }

  let instruction: string | null = null;
  const instructionMatch = summary.match(/\s+(Complete (?:it|them) before the deadline\.)$/i);
  if (instructionMatch?.index !== undefined && instructionMatch[1]) {
    instruction = instructionMatch[1];
    summary = summary.slice(0, instructionMatch.index).trim();
  }

  const colonIndex = summary.indexOf(': ');
  if (colonIndex < 0) return { summary, note, instruction };
  return { summary: `${summary.slice(0, colonIndex)}.`, note, instruction };
}

function NotificationMessage({ item, locale }: { item: NotificationItem; locale: Locale }) {
  if (item.type === 'WORK_LIST_WEEKLY_DIGEST') {
    const [summary = item.message, activity = ''] = item.message.split(': ');
    const metrics = activity.replace(/\.$/, '').split(', ').filter(Boolean);
    return <div className="notification-message compact"><p>{summary}.</p><div className="notification-metrics">{metrics.map((metric) => <span key={metric}>{metric}</span>)}</div></div>;
  }

  if (item.type.startsWith('WORK_LIST_')) {
    const content = extractWorkListMessage(item.message);
    const count = content.summary.match(/^\d+/)?.[0];
    return <div className="notification-message compact"><p>{content.summary}</p><div className="notification-inline-facts">{count && <span><strong>{count}</strong> {locale === 'id' ? 'pekerjaan rutin' : 'Routine Work items'}</span>}{content.instruction && <span>{locale === 'id' ? 'Selesaikan sebelum tenggat' : 'Complete before deadline'}</span>}{content.note && <span>{locale === 'id' ? 'Pekerja tidak perlu bertindak' : 'No worker action'}</span>}</div></div>;
  }

  const [message = item.message, reason] = item.message.split(/(?:\. )?Reason: /, 2);
  return <div className="notification-message compact"><p>{message}{reason && !message.endsWith('.') ? '.' : ''}</p>{reason && <p className="notification-reason compact"><strong>{locale === 'id' ? 'Alasan:' : 'Reason:'}</strong> <span>{reason}</span></p>}</div>;
}

function isDigest(item: NotificationItem) {
  return item.type === 'WORK_LIST_MISSED_DIGEST' || item.type === 'WORK_LIST_WEEKLY_DIGEST';
}

interface DigestGroup {
  templateId: string;
  title: string;
  recurrence: string;
  periodDate: string;
  items: DigestItem[];
}

function formatDateValue(value: string, locale: Locale) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : format(date, 'd MMM yyyy', { locale: locale === 'id' ? idLocale : enUS });
}

function DigestChecklistGroup({ group, locale }: { group: DigestGroup; locale: Locale }) {
  const previewLimit = 3;
  const [expanded, setExpanded] = useState(false);
  const resolvedCount = group.items.reduce((total, item) => total + item.resolved_count, 0);
  const itemCount = group.items.reduce((total, item) => total + item.item_count, 0);
  const collapsible = group.items.length > previewLimit;
  const visibleItems = expanded ? group.items : group.items.slice(0, previewLimit);
  const hiddenCount = group.items.length - previewLimit;

  return <article className="digest-checklist-group">
    <header className="digest-group-header"><div><span>{enumLabel(group.recurrence, locale, recurrenceLabels)} · {formatDateValue(group.periodDate, locale)}</span><strong>{group.title}</strong></div><div><span>{group.items.length} {locale === 'id' ? 'lokasi' : `location${group.items.length === 1 ? '' : 's'}`}</span><small>{resolvedCount}/{itemCount} {locale === 'id' ? 'item selesai' : 'items resolved'}</small></div></header>
    <div className="digest-location-list">{visibleItems.map((item) => <div className="digest-location-row" key={item.id}><div><strong>{item.location}</strong><small>{item.workers.join(', ') || (locale === 'id' ? 'Belum ada pekerja yang ditugaskan' : 'No worker assigned')}</small></div><div className="digest-item-stats"><span className={`digest-status status-${item.status.toLowerCase()}`}>{enumLabel(item.status, locale, statusLabels)}</span><small>{item.resolved_count}/{item.item_count}</small></div></div>)}</div>
    {collapsible && <button className="digest-location-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? <><ChevronUp /> {locale === 'id' ? 'Tampilkan lebih sedikit' : 'Show less'}</> : <><ChevronDown /> {locale === 'id' ? `Tampilkan ${hiddenCount} lokasi lainnya` : `Show ${hiddenCount} more location${hiddenCount === 1 ? '' : 's'}`}</>}</button>}
  </article>;
}

function DigestDetailView({ id, locale, onBack }: { id: string; locale: Locale; onBack: () => void }) {
  const [digest, setDigest] = useState<DigestDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setDigest(null);
    setError('');
    void api<DigestDetail>(`/notifications/${id}/digest`).then(setDigest).catch((caught) => setError(locale === 'id' ? 'Ringkasan ini tidak dapat dimuat.' : caught instanceof Error ? caught.message : 'Could not load this digest.'));
  }, [id, locale]);

  const notifications = locale === 'id' ? 'Notifikasi' : 'Notifications';
  if (error) return <div className="digest-detail"><button className="digest-back" onClick={onBack}><ArrowLeft /> {notifications}</button><p className="form-error" role="alert">{error}</p></div>;
  if (!digest) return <div className="digest-detail"><button className="digest-back" onClick={onBack}><ArrowLeft /> {notifications}</button><p className="muted">{locale === 'id' ? 'Memuat ringkasan…' : 'Loading digest…'}</p></div>;

  const counts = digest.items.reduce<Record<string, number>>((summary, item) => { summary[item.status] = (summary[item.status] ?? 0) + 1; return summary; }, {});
  const groups = Array.from(digest.items.reduce<Map<string, DigestGroup>>((result, item) => {
    const key = `${item.template_id}\u0000${item.recurrence}\u0000${item.period_date}`;
    const group = result.get(key) ?? { templateId: item.template_id, title: item.title, recurrence: item.recurrence, periodDate: item.period_date, items: [] };
    group.items.push(item);
    result.set(key, group);
    return result;
  }, new Map()).values());
  const period = digest.period_start ? digest.period_start === digest.period_end ? formatDateValue(digest.period_start, locale) : `${formatDateValue(digest.period_start, locale)} – ${formatDateValue(digest.period_end ?? digest.period_start, locale)}` : formatDateValue(digest.created_at, locale);
  return <div className="digest-detail">
    <button className="digest-back" onClick={onBack}><ArrowLeft /> {notifications}</button>
    <header className="digest-detail-header"><div><span>{locale === 'id' ? 'Ringkasan Pekerjaan Rutin' : 'Routine Work digest'}</span><h3>{digest.title}</h3><p>{period} · {digest.items.length} {locale === 'id' ? 'pekerjaan rutin' : 'Routine Work items'}</p></div><Info /></header>
    <div className="digest-summary-strip">{Object.entries(counts).map(([status, count]) => <span key={status}><strong>{count}</strong>{enumLabel(status, locale, statusLabels)}</span>)}</div>
    {!digest.items.length && <div className="digest-fallback"><p>{digest.message}</p><small>{locale === 'id' ? 'Rincian data sumber tidak tersedia untuk ringkasan historis ini.' : 'Detailed source records are unavailable for this historical digest.'}</small></div>}
    {digest.items.length > 0 && <div className="digest-item-list">{groups.map((group) => <DigestChecklistGroup group={group} locale={locale} key={`${group.templateId}-${group.recurrence}-${group.periodDate}`} />)}</div>}
  </div>;
}

function emailStatusLabel(item: NotificationItem, locale: Locale) {
  if (item.email_status === 'RETRYING') return locale === 'id' ? `Mengirim ulang email · percobaan ${item.email_attempts}` : `Retrying email · attempt ${item.email_attempts}`;
  const labels: Record<Locale, Record<string, string>> = {
    en: { PENDING: 'Email queued', SENDING: 'Sending email', SENT: 'Email sent', FAILED: 'Email failed', DISABLED: 'Email disabled' },
    id: { PENDING: 'Email dalam antrean', SENDING: 'Mengirim email', SENT: 'Email terkirim', FAILED: 'Email gagal dikirim', DISABLED: 'Email dinonaktifkan' },
  };
  return labels[locale][item.email_status] ?? (locale === 'id' ? `Email: ${enumLabel(item.email_status, locale, statusLabels)}` : `Email ${item.email_status.toLowerCase()}`);
}

export function NotificationsView({ locale = storedLocale(), onClose, onChanged, canRetryEmail }: { locale?: Locale; onClose: () => void; onChanged: () => void; canRetryEmail: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [digestId, setDigestId] = useState(() => new URLSearchParams(window.location.search).get('digest'));
  const isId = locale === 'id';
  const dateLocale = isId ? idLocale : enUS;
  const load = async () => {
    try {
      setError('');
      setItems(await api<NotificationItem[]>('/notifications'));
    } catch (caught) {
      setError(isId ? 'Notifikasi tidak dapat dimuat.' : caught instanceof Error ? caught.message : 'Could not load notifications.');
    }
  };
  useEffect(() => { void load(); }, [locale]);
  const update = async (notificationId: string, action: 'read' | 'acknowledge') => {
    try {
      setError('');
      await api(`/notifications/${notificationId}/${action}`, { method: 'POST' });
      await load();
      onChanged();
    } catch (caught) {
      setError(isId ? 'Status notifikasi tidak dapat diperbarui.' : caught instanceof Error ? caught.message : 'Could not update the notification.');
    }
  };
  const readAll = async () => {
    try {
      setError('');
      await api('/notifications/read-all', { method: 'POST' });
      await load();
      onChanged();
    } catch (caught) {
      setError(isId ? 'Notifikasi tidak dapat ditandai sudah dibaca.' : caught instanceof Error ? caught.message : 'Could not mark notifications as read.');
    }
  };
  const retryEmail = async (notificationId: string) => {
    setRetryingId(notificationId);
    setError('');
    try {
      await api(`/notifications/${notificationId}/retry-email`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(isId ? 'Pengiriman email tidak dapat dicoba ulang.' : caught instanceof Error ? caught.message : 'Could not retry email delivery.');
    } finally {
      setRetryingId(null);
    }
  };
  const unreadCount = items.filter((item) => !item.read_status).length;
  const openDigest = (notificationId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('digest', notificationId);
    window.history.replaceState({}, '', url);
    setDigestId(notificationId);
    void update(notificationId, 'read');
  };
  const closeDigest = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('digest');
    window.history.replaceState({}, '', url);
    setDigestId(null);
  };
  return <div className="sheet-backdrop"><section className="sheet notifications-sheet">
    <header className="sheet-header"><div><span>{isId ? 'Pembaruan dan pengingat' : 'Updates and reminders'}</span><h2>{digestId ? (isId ? 'Rincian ringkasan' : 'Digest details') : (isId ? 'Notifikasi' : 'Notifications')}</h2></div><button className="icon-button" onClick={onClose} aria-label={isId ? 'Tutup notifikasi' : 'Close notifications'}><X /></button></header>
    <div className="sheet-content">
      {digestId ? <DigestDetailView id={digestId} locale={locale} onBack={closeDigest} /> : <>
        <div className="notification-toolbar"><div><strong>{unreadCount ? (isId ? `${unreadCount} belum dibaca` : `${unreadCount} unread`) : (isId ? 'Semua sudah dibaca' : 'You’re all caught up')}</strong><p className="muted">{isId ? 'Pembaruan ringkas beserta status pengiriman dan tindakan.' : 'Compact updates with delivery and action status.'}</p></div><button className="secondary-button" onClick={() => void readAll()} disabled={!unreadCount}><CheckCheck /> {isId ? 'Tandai semua sudah dibaca' : 'Mark all read'}</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="notification-list">{items.map((item) => {
          const presentation = presentationFor(item, locale);
          const Icon = presentation.icon;
          return <article className={`notification-card tone-${presentation.tone}${item.read_status ? '' : ' unread'}${presentation.informational ? ' informational' : ''}`} key={item.id}>
            <div className="notification-card-accent" aria-hidden="true" />
            <div className="notification-icon" aria-hidden="true"><Icon /></div>
            <div className="notification-card-main">
              <div className="notification-card-topline"><div><span className="notification-category">{presentation.category}</span>{item.work_order_number && <span className="notification-reference">{item.work_order_number}</span>}{!item.read_status && <span className="notification-new-dot" title={isId ? 'Belum dibaca' : 'Unread'} />}</div><span className="notification-badge">{presentation.label}</span></div>
              <div className="notification-card-content"><h3>{item.title}</h3><NotificationMessage item={item} locale={locale} /></div>
              {item.email_last_error && <p className="notification-delivery-error">{isId ? 'Rincian kegagalan pengiriman email' : 'Email delivery detail'}: {item.email_last_error}</p>}
              <footer className="notification-card-footer"><div className="notification-meta"><span>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: dateLocale })}</span><span className={`email-status email-${item.email_status.toLowerCase()}`}><Mail /> {emailStatusLabel(item, locale)}</span></div><div className="notification-actions">{isDigest(item) && <button className="notification-detail-link" onClick={() => openDigest(item.id)}>{isId ? 'Lihat ringkasan' : 'View digest'} <ExternalLink /></button>}{canRetryEmail && item.email_status === 'FAILED' && <button className="secondary-button" onClick={() => void retryEmail(item.id)} disabled={retryingId === item.id}>{retryingId === item.id ? (isId ? 'Mencoba ulang…' : 'Retrying…') : (isId ? 'Coba ulang email' : 'Retry email')}</button>}{!item.read_status && <button className="secondary-button" onClick={() => void update(item.id, 'read')}><Check /> {isId ? 'Tandai sudah dibaca' : 'Mark read'}</button>}{item.type !== 'WORK_LIST_MISSED_DIGEST' && !item.acknowledged_at && <button className="primary-button" onClick={() => void update(item.id, 'acknowledge')}><MailCheck /> {isId ? 'Konfirmasi' : 'Acknowledge'}</button>}</div></footer>
            </div>
          </article>;
        })}</div>
        {!items.length && !error && <p className="empty-approval">{isId ? 'Belum ada notifikasi.' : 'No notifications yet.'}</p>}
      </>}
    </div>
  </section></div>;
}
