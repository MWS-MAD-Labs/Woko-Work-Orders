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
import { api } from './api';

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

const notificationPresentations: Record<string, NotificationPresentation> = {
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
  WORK_LIST_DAILY_REMINDER: { category: 'Work List reminder', label: 'Unfinished today', tone: 'warning', icon: ClipboardList },
  WORK_LIST_MISSED_DIGEST: { category: 'Work List monitoring', label: 'No action required', tone: 'warning', icon: Info, informational: true },
  WORK_LIST_WEEKLY_DIGEST: { category: 'Work List report', label: 'Weekly summary', tone: 'info', icon: BarChart3, informational: true },
};

const defaultPresentation: NotificationPresentation = { category: 'Work update', label: 'Update', tone: 'info', icon: Bell };

function presentationFor(item: NotificationItem): NotificationPresentation {
  const presentation = notificationPresentations[item.type] ?? defaultPresentation;
  if (item.type !== 'CONDITION_CHANGED') return presentation;
  if (/\bBLOCKED\b/i.test(item.title) || /\bto BLOCKED\b/i.test(item.message)) return { ...presentation, label: 'Blocked', tone: 'danger' };
  if (/\bON[ _]TRACK\b/i.test(item.title) || /\bto ON[ _]TRACK\b/i.test(item.message)) return { ...presentation, label: 'On track', tone: 'success', icon: CircleCheck };
  return { ...presentation, label: 'At risk' };
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
  if (colonIndex < 0) return { summary, items: [] as string[], note, instruction, hasMore: false };

  const details = summary.slice(colonIndex + 2).replace(/\.$/, '');
  const hasMore = /,?\s+and more$/i.test(details);
  const cleanedDetails = details.replace(/,?\s+and more$/i, '');
  const items = cleanedDetails.split(/,\s+(?=[A-Z0-9])/).map((value) => value.trim()).filter(Boolean);
  return { summary: `${summary.slice(0, colonIndex)}.`, items, note, instruction, hasMore };
}

function NotificationMessage({ item }: { item: NotificationItem }) {
  if (item.type === 'WORK_LIST_WEEKLY_DIGEST') {
    const [summary = item.message, activity = ''] = item.message.split(': ');
    const metrics = activity.replace(/\.$/, '').split(', ').filter(Boolean);
    return <div className="notification-message compact"><p>{summary}.</p><div className="notification-metrics">{metrics.map((metric) => <span key={metric}>{metric}</span>)}</div></div>;
  }

  if (item.type.startsWith('WORK_LIST_')) {
    const content = extractWorkListMessage(item.message);
    const count = content.summary.match(/^\d+/)?.[0];
    return <div className="notification-message compact"><p>{content.summary}</p><div className="notification-inline-facts">{count && <span><strong>{count}</strong> Work List{count === '1' ? '' : 's'}</span>}{content.instruction && <span>Complete before deadline</span>}{content.note && <span>No worker action</span>}</div></div>;
  }

  const [message = item.message, reason] = item.message.split(/(?:\. )?Reason: /, 2);
  return <div className="notification-message compact"><p>{message}{reason && !message.endsWith('.') ? '.' : ''}</p>{reason && <p className="notification-reason compact"><strong>Reason:</strong> <span>{reason}</span></p>}</div>;
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

function DigestChecklistGroup({ group }: { group: DigestGroup }) {
  const previewLimit = 3;
  const [expanded, setExpanded] = useState(false);
  const resolvedCount = group.items.reduce((total, item) => total + item.resolved_count, 0);
  const itemCount = group.items.reduce((total, item) => total + item.item_count, 0);
  const collapsible = group.items.length > previewLimit;
  const visibleItems = expanded ? group.items : group.items.slice(0, previewLimit);
  const hiddenCount = group.items.length - previewLimit;

  return <article className="digest-checklist-group">
    <header className="digest-group-header"><div><span>{group.recurrence} · {group.periodDate}</span><strong>{group.title}</strong></div><div><span>{group.items.length} location{group.items.length === 1 ? '' : 's'}</span><small>{resolvedCount}/{itemCount} items resolved</small></div></header>
    <div className="digest-location-list">{visibleItems.map((item) => <div className="digest-location-row" key={item.id}><div><strong>{item.location}</strong><small>{item.workers.join(', ') || 'No worker assigned'}</small></div><div className="digest-item-stats"><span className={`digest-status status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span><small>{item.resolved_count}/{item.item_count}</small></div></div>)}</div>
    {collapsible && <button className="digest-location-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? <><ChevronUp /> Show less</> : <><ChevronDown /> Show {hiddenCount} more location{hiddenCount === 1 ? '' : 's'}</>}</button>}
  </article>;
}

function DigestDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [digest, setDigest] = useState<DigestDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setDigest(null);
    setError('');
    void api<DigestDetail>(`/notifications/${id}/digest`).then(setDigest).catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load this digest.'));
  }, [id]);

  if (error) return <div className="digest-detail"><button className="digest-back" onClick={onBack}><ArrowLeft /> Notifications</button><p className="form-error">{error}</p></div>;
  if (!digest) return <div className="digest-detail"><button className="digest-back" onClick={onBack}><ArrowLeft /> Notifications</button><p className="muted">Loading digest…</p></div>;

  const counts = digest.items.reduce<Record<string, number>>((summary, item) => { summary[item.status] = (summary[item.status] ?? 0) + 1; return summary; }, {});
  const groups = Array.from(digest.items.reduce<Map<string, DigestGroup>>((result, item) => {
    const key = `${item.template_id}\u0000${item.recurrence}\u0000${item.period_date}`;
    const group = result.get(key) ?? { templateId: item.template_id, title: item.title, recurrence: item.recurrence, periodDate: item.period_date, items: [] };
    group.items.push(item);
    result.set(key, group);
    return result;
  }, new Map()).values());
  const period = digest.period_start ? digest.period_start === digest.period_end ? digest.period_start : `${digest.period_start} – ${digest.period_end}` : format(new Date(digest.created_at), 'd MMM yyyy');
  return <div className="digest-detail">
    <button className="digest-back" onClick={onBack}><ArrowLeft /> Notifications</button>
    <header className="digest-detail-header"><div><span>Work List digest</span><h3>{digest.title}</h3><p>{period} · {digest.items.length} Work List{digest.items.length === 1 ? '' : 's'}</p></div><Info /></header>
    <div className="digest-summary-strip">{Object.entries(counts).map(([status, count]) => <span key={status}><strong>{count}</strong>{status.replaceAll('_', ' ').toLowerCase()}</span>)}</div>
    {!digest.items.length && <div className="digest-fallback"><p>{digest.message}</p><small>Detailed source records are unavailable for this historical digest.</small></div>}
    {digest.items.length > 0 && <div className="digest-item-list">{groups.map((group) => <DigestChecklistGroup group={group} key={`${group.templateId}-${group.recurrence}-${group.periodDate}`} />)}</div>}
  </div>;
}

function emailStatusLabel(item: NotificationItem) {
  if (item.email_status === 'RETRYING') return `Retrying email · attempt ${item.email_attempts}`;
  const labels: Record<string, string> = { PENDING: 'Email queued', SENDING: 'Sending email', SENT: 'Email sent', FAILED: 'Email failed', DISABLED: 'Email disabled' };
  return labels[item.email_status] ?? `Email ${item.email_status.toLowerCase()}`;
}

export function NotificationsView({ onClose, onChanged, canRetryEmail }: { onClose: () => void; onChanged: () => void; canRetryEmail: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [digestId, setDigestId] = useState(() => new URLSearchParams(window.location.search).get('digest'));
  const load = async () => {
    try { setItems(await api<NotificationItem[]>('/notifications')); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load notifications.'); }
  };
  useEffect(() => { void load(); }, []);
  const update = async (id: string, action: 'read' | 'acknowledge') => {
    await api(`/notifications/${id}/${action}`, { method: 'POST' });
    await load();
    onChanged();
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    await load();
    onChanged();
  };
  const retryEmail = async (id: string) => {
    setRetryingId(id);
    setError('');
    try {
      await api(`/notifications/${id}/retry-email`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not retry email delivery.');
    } finally {
      setRetryingId(null);
    }
  };
  const unreadCount = items.filter((item) => !item.read_status).length;
  const openDigest = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('digest', id);
    window.history.replaceState({}, '', url);
    setDigestId(id);
    void update(id, 'read');
  };
  const closeDigest = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('digest');
    window.history.replaceState({}, '', url);
    setDigestId(null);
  };
  return <div className="sheet-backdrop"><section className="sheet notifications-sheet">
    <header className="sheet-header"><div><span>Updates and reminders</span><h2>{digestId ? 'Digest details' : 'Notifications'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close notifications"><X /></button></header>
    <div className="sheet-content">
      {digestId ? <DigestDetailView id={digestId} onBack={closeDigest} /> : <>
        <div className="notification-toolbar"><div><strong>{unreadCount ? `${unreadCount} unread` : 'You’re all caught up'}</strong><p className="muted">Compact updates with delivery and action status.</p></div><button className="secondary-button" onClick={() => void readAll()} disabled={!unreadCount}><CheckCheck /> Mark all read</button></div>
        {error && <p className="form-error">{error}</p>}
        <div className="notification-list">{items.map((item) => {
          const presentation = presentationFor(item);
          const Icon = presentation.icon;
          return <article className={`notification-card tone-${presentation.tone}${item.read_status ? '' : ' unread'}${presentation.informational ? ' informational' : ''}`} key={item.id}>
            <div className="notification-card-accent" aria-hidden="true" />
            <div className="notification-icon" aria-hidden="true"><Icon /></div>
            <div className="notification-card-main">
              <div className="notification-card-topline"><div><span className="notification-category">{presentation.category}</span>{item.work_order_number && <span className="notification-reference">{item.work_order_number}</span>}{!item.read_status && <span className="notification-new-dot" title="Unread" />}</div><span className="notification-badge">{presentation.label}</span></div>
              <div className="notification-card-content"><h3>{item.title}</h3><NotificationMessage item={item} /></div>
              {item.email_last_error && <p className="notification-delivery-error">Email delivery detail: {item.email_last_error}</p>}
              <footer className="notification-card-footer"><div className="notification-meta"><span>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span><span className={`email-status email-${item.email_status.toLowerCase()}`}><Mail /> {emailStatusLabel(item)}</span></div><div className="notification-actions">{isDigest(item) && <button className="notification-detail-link" onClick={() => openDigest(item.id)}>View digest <ExternalLink /></button>}{canRetryEmail && item.email_status === 'FAILED' && <button className="secondary-button" onClick={() => void retryEmail(item.id)} disabled={retryingId === item.id}>{retryingId === item.id ? 'Retrying…' : 'Retry email'}</button>}{!item.read_status && <button className="secondary-button" onClick={() => void update(item.id, 'read')}><Check /> Mark read</button>}{item.type !== 'WORK_LIST_MISSED_DIGEST' && !item.acknowledged_at && <button className="primary-button" onClick={() => void update(item.id, 'acknowledge')}><MailCheck /> Acknowledge</button>}</div></footer>
            </div>
          </article>;
        })}</div>
        {!items.length && !error && <p className="empty-approval">No notifications yet.</p>}
      </>}
    </div>
  </section></div>;
}
