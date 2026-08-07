import { useDeferredValue, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, Bell, BriefcaseBusiness, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, Eye, ExternalLink, FileText, Filter, HardHat, Languages, LogIn, LogOut, MapPin, Menu, MessageCircle, Plus, Search, Settings, ShieldAlert, Trash2, UserCheck, X } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS, id } from 'date-fns/locale';
import { ApiError, api, authLoginUrl } from './api';
import { translator, type Locale } from './i18n';
import { ConditionActionForm, CreateWorkOrderForm, DueDateActionForm, EvidencePanel, InternalProcurementPanel, ParticipantsActionForm, ProposalDecisionForm, VendorActionForm, WorkflowActionForm } from './WorkOrderForms';
import type { CurrentUser, ReferenceData, WorkOrder } from './types';
import { OrganizationSettings } from './OrganizationSettings';
import { ApprovalsView } from './ApprovalsView';
import { NotificationsView } from './NotificationsView';
import { subscribeToPushNotifications } from './push';
import { ReportsView } from './ReportsView';
import { WorkListsView } from './WorkListsView';

import { getProgressActionLabel, getProjectPhases, getProjectProgress, getUpdateLabel } from './work-order-progress';
import { formatParticipantChanges } from './participant-change';

type Order = WorkOrder;
const groups = ['OVERDUE', 'THIS_WEEK', 'THIS_MONTH', 'NEXT_MONTH', 'THIS_SEMESTER', 'THIS_ACADEMIC_YEAR', 'FUTURE', 'ARCHIVE'] as const;

function BrandLogo({ variant = 'wordmark' }: { variant?: 'wordmark' | 'icon' }) {
  const src = variant === 'wordmark' ? '/woko-wordmark.svg' : '/icon.svg';
  return <img className={`brand-logo brand-logo-${variant}`} src={src} alt="" aria-hidden="true" />;
}

function Avatar({ name, photoUrl, title = name }: { name: string; photoUrl?: string | null; title?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = name.split(' ').map((part) => part[0]).slice(0, 2).join('');
  return <span className={`avatar${photoUrl && !imageFailed ? ' has-photo' : ''}`} aria-label={title} title={title}>{photoUrl && !imageFailed ? <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : initials}</span>;
}

function CardParticipants({ order, locale }: { order: Order; locale: Locale }) {
  const labels = locale === 'id' ? { pic: 'PIC', worker: 'Pekerja', reviewer: 'Peninjau', overseer: 'Pengawas' } : { pic: 'PIC', worker: 'Worker', reviewer: 'Reviewer', overseer: 'Overseer' };
  const roles = [
    { key: 'pic', label: labels.pic, icon: <UserCheck />, people: order.assignees },
    { key: 'worker', label: labels.worker, icon: <HardHat />, people: order.workers },
    { key: 'reviewer', label: labels.reviewer, icon: <ClipboardCheck />, people: order.reviewer_id && order.reviewer_name ? [{ id: order.reviewer_id, full_name: order.reviewer_name, profile_photo_url: order.reviewer_photo_url }] : [] },
    { key: 'overseer', label: labels.overseer, icon: <Eye />, people: order.overseers },
  ].filter((role) => role.people.length > 0);
  return <span className="card-participants" aria-label={roles.flatMap((role) => role.people.map((person) => `${person.full_name}, ${role.label}`)).join('; ')}>{roles.map((role) => <span className="card-participant-role" key={role.key} title={role.label}><span className="card-role-icon" aria-hidden="true">{role.icon}</span><span className="card-role-avatars" style={{ '--role-count': role.people.length } as React.CSSProperties}>{role.people.map((person) => <Avatar key={person.id} name={person.full_name} photoUrl={person.profile_photo_url} title={`${person.full_name} · ${role.label}`} />)}</span></span>)}</span>;
}

function ParticipantRole({ icon, label, people, emptyLabel = '—' }: { icon: React.ReactNode; label: string; people: Array<{ id: string; full_name: string; profile_photo_url?: string | null }>; emptyLabel?: string }) {
  return <div className="participant-role"><span className="participant-role-label">{icon}{label}</span>{people.length ? <div className="participant-list">{people.map((person) => <span key={person.id}><Avatar name={person.full_name} photoUrl={person.profile_photo_url} /> <strong>{person.full_name}</strong></span>)}</div> : <strong>{emptyLabel}</strong>}</div>;
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function WorkOrderCard({ order, locale, onOpen }: { order: Order; locale: Locale; onOpen: () => void }) {
  const dateLocale = locale === 'id' ? id : enUS;
  const t = translator(locale);
  const progress = getProjectProgress(order, locale);
  return (
    <button className="work-card" onClick={onOpen} aria-label={`${order.work_order_number}: ${order.title}`}>
      <span className={`priority-line priority-${String(order.priority).toLowerCase()}`} />
      <span className="card-body">
        <span className="card-topline"><span>{order.work_order_number}</span><span>{formatDistanceToNow(new Date(order.updated_at), { addSuffix: true, locale: dateLocale })}</span></span>
        <strong>{order.title}</strong>
        <span className="card-location"><MapPin size={15} /> {order.building} · {order.room_or_area}</span>
        <span className="card-progress-heading"><span>{progress.label}</span>{progress.sublabel && <strong>{progress.sublabel}</strong>}</span>
        <span className="card-progress-track" aria-label={progress.sublabel ? `${progress.label}: ${progress.sublabel}` : progress.label}><span style={{ width: `${progress.percent}%` }} /></span>
        <span className="card-statuses">
          {order.condition === 'BLOCKED' && <StatusPill tone="red"><ShieldAlert size={13} /> {t('blockedStatus')}</StatusPill>}
          {order.condition === 'AT_RISK' && <StatusPill tone="gold"><AlertTriangle size={13} /> {t('needsAttention')}</StatusPill>}
          {order.deadlineGroup === 'OVERDUE' && <StatusPill tone="red"><Clock3 size={13} /> {t('overdueStatus')}</StatusPill>}
          {order.workflow_stage === 'APPROVAL' && <StatusPill tone="gold"><ClipboardCheck size={13} /> {t('approvalNeeded')}</StatusPill>}
          {order.workflow_stage === 'REVIEW' && <StatusPill tone="navy"><ClipboardCheck size={13} /> {t('finalCheck')}</StatusPill>}
        </span>
        <span className="card-footer"><CardParticipants order={order} locale={locale} /><span className="card-due-date"><Clock3 size={13} /> {format(new Date(`${order.due_date}T00:00:00`), 'd MMM yyyy', { locale: dateLocale })}</span></span>
      </span>
    </button>
  );
}

function LoginScreen({ error }: { error?: string }) {
  return <main className="login-page"><section className="login-card"><BrandLogo variant="icon" /><span className="eyebrow">Work Order</span><h1>Sign in to Woko</h1><p>Use your registered <strong>@millennia21.id</strong> Google Workspace account.</p>{error && <p className="form-error">Sign-in failed: {error.replaceAll('_', ' ').toLowerCase()}.</p>}<a className="primary-button" href={authLoginUrl(`${window.location.pathname}${window.location.search}`)}><LogIn /> Continue with Google</a></section></main>;
}

function StartupErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="login-page"><section className="login-card"><BrandLogo variant="icon" /><span className="eyebrow">Work Order</span><h1>Woko could not load</h1><p>Your sign-in session may still be valid, but the application API returned an error.</p><p className="form-error">{message}</p><button className="primary-button" onClick={onRetry}>Try again</button></section></main>;
}

function ProgressDiscussion({ orderId, update, locale, canComment, onChanged }: { orderId: string; update: NonNullable<WorkOrder['updates']>[number]; locale: Locale; canComment: boolean; onChanged: () => Promise<void> }) {
  const t = translator(locale);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!body.trim()) return; setSubmitting(true); setError('');
    try { await api(`/work-orders/${orderId}/progress/${update.id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }); setBody(''); await onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Comment could not be added.'); }
    finally { setSubmitting(false); }
  };
  if (!canComment) return null;
  const comments = update.comments ?? [];
  return <div className="progress-discussion"><button type="button" className="comment-toggle" onClick={() => setOpen((value) => !value)}><MessageCircle /> {t('comment')} {comments.length > 0 && <span>{comments.length}</span>}</button>{open && <div className="comment-thread">{comments.length ? comments.map((comment) => <article key={comment.id}><strong>{comment.author}</strong><p>{comment.body}</p><small>{formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: locale === 'id' ? id : enUS })}</small></article>) : <p className="muted">{t('noComments')}</p>}<form onSubmit={submit}><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('writeComment')} maxLength={2000} required /><button className="secondary-button" disabled={submitting || !body.trim()}>{t('send')}</button></form>{error && <p className="form-error">{error}</p>}</div>}</div>;
}

function DetailDrawer({ order, locale, currentUser, references, onClose, onChanged, onDelete }: { order: Order; locale: Locale; currentUser: CurrentUser; references: ReferenceData; onClose: () => void; onChanged: () => Promise<void>; onDelete: (order: Order) => Promise<void> }) {
  const t = translator(locale);
  const dateLocale = locale === 'id' ? id : enUS;
  const [action, setAction] = useState<'workflow' | 'vendor' | 'proposal-decision' | 'condition' | 'due-date' | 'participants' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const isManager = currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
  const isPic = order.assignees.some((person) => person.id === currentUser.id);
  const isWorker = order.workers.some((person) => person.id === currentUser.id);
  const workerCanProgress = currentUser.roles.includes('WORKER') && isWorker && order.status === 'ACTIVE' && order.work_type === 'INTERNAL' && ['SCHEDULED', 'IN_PROGRESS'].includes(order.workflow_stage);
  const canProgress = order.status === 'ACTIVE' && (isManager || isPic || workerCanProgress);
  const canChangeCondition = order.status === 'ACTIVE' && (isManager || isPic);
  const canManageParticipants = isManager || order.assignees.some((person) => person.id === currentUser.id) || order.reviewer_id === currentUser.id;
  const canComment = isManager || isPic || isWorker || order.reviewer_id === currentUser.id || order.overseers.some((person) => person.id === currentUser.id);
  const canReopen = order.status === 'COMPLETED' && isManager;
  const hasUnresolvedInternalProcurement = order.work_type === 'INTERNAL' && Boolean(order.procurement && !['NOT_REQUIRED', 'APPROVED'].includes(order.procurement.status));
  const isStructuredVendorStage = order.work_type === 'VENDOR' && ['PLANNED', 'FINDING_VENDOR', 'PROPOSAL'].includes(order.workflow_stage);
  const isProposalApproval = order.work_type === 'VENDOR' && order.workflow_stage === 'APPROVAL';
  const canDecideProposal = isManager && !order.assignees.some((person) => person.id === currentUser.id);
  const audits = order.audits;
  const progress = getProjectProgress(order, locale);
  const projectPhases = [...getProjectPhases(locale, order.work_type)];
  if (progress.sublabel && order.work_type === 'INTERNAL') projectPhases[1] = progress.label ?? projectPhases[1] ?? (locale === 'id' ? 'Pengadaan' : 'Procuring');
  const progressActionLabel = getProgressActionLabel(order, isManager, locale);
  const deleteWorkOrder = async () => {
    setDeleting(true);
    setDeleteError('');
    try { await onDelete(order); }
    catch (caught) { setDeleteError(caught instanceof Error ? caught.message : (locale === 'id' ? 'Pekerjaan tidak dapat dihapus.' : 'The work order could not be deleted.')); }
    finally { setDeleting(false); }
  };
  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="drawer-header"><div><span>{order.work_order_number}</span><h2 id="drawer-title">{order.title}</h2></div><button className="icon-button" onClick={onClose} aria-label={t('close')}><X /></button></header>
      <div className="drawer-content">
        <div className="detail-status"><StatusPill tone="navy">{progress.label}</StatusPill><StatusPill tone={order.priority === 'CRITICAL' ? 'red' : 'gold'}>{order.priority}</StatusPill>{order.condition === 'BLOCKED' && <StatusPill tone="red"><ShieldAlert size={13} /> {t('blockedStatus')}</StatusPill>}{order.condition === 'AT_RISK' && <StatusPill tone="gold"><AlertTriangle size={13} /> {t('needsAttention')}</StatusPill>}{order.condition === 'ON_TRACK' && <StatusPill tone="sage"><CheckCircle2 size={13} /> {t('onTrackStatus')}</StatusPill>}{order.deadlineGroup === 'OVERDUE' && <StatusPill tone="red"><Clock3 size={13} /> {t('overdueStatus')}</StatusPill>}</div>
        <section className="project-progress-summary" aria-label={`${t('projectProgress')}: ${progress.label}`}>
          <header><div><span>{t('projectProgress')}</span><strong>{progress.label}</strong>{progress.sublabel && <small>{progress.sublabel}</small>}</div></header>
          <div className="project-progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
          <ol>{projectPhases.map((phase, index) => <li key={phase} className={index < progress.phaseIndex ? 'complete' : index === progress.phaseIndex ? 'current' : ''}><span>{index < progress.phaseIndex ? <CheckCircle2 /> : index + 1}</span><small>{phase}</small></li>)}</ol>
          <p>{progress.detail}</p>
        </section>
        <p className="description">{order.description}</p>
        <section className="participants-section">
          <header><div><h3>{t('peopleInvolved')}</h3><p>{canManageParticipants ? t('editParticipants') : t('participantManagerOnly')}</p></div>{canManageParticipants && <button className="secondary-button" onClick={() => setAction('participants')}>{t('managePeople')}</button>}</header>
          <div className="participant-role-grid">
            <ParticipantRole icon={<UserCheck />} label={t('pic')} people={order.assignees} />
            {order.work_type === 'INTERNAL' && <ParticipantRole icon={<HardHat />} label={locale === 'id' ? 'Pekerja' : 'Workers'} people={order.workers} />}
            <ParticipantRole icon={<ClipboardCheck />} label={t('reviewer')} people={order.reviewer_id && order.reviewer_name ? [{ id: order.reviewer_id, full_name: order.reviewer_name, profile_photo_url: order.reviewer_photo_url }] : []} emptyLabel={t('defaultManager')} />
            <ParticipantRole icon={<Eye />} label={t('overseers')} people={order.overseers} />
          </div>
        </section>
        <dl className="detail-grid">
          <div><dt>{t('due')}</dt><dd>{format(new Date(`${order.due_date}T00:00:00`), 'd MMMM yyyy', { locale: dateLocale })}</dd></div>
          <div><dt>{t('location')}</dt><dd>{order.building}, {order.room_or_area}</dd></div>
          <div><dt>{t('workType')}</dt><dd>{order.work_type}</dd></div>
        </dl>
        <InternalProcurementPanel order={order as WorkOrder} currentUser={currentUser} onChanged={onChanged} />
        <EvidencePanel order={order as WorkOrder} currentUser={currentUser} onChanged={onChanged} />
        <section className="timeline-section"><h3>{t('timeline')}</h3><p className="timeline-help">{t('commentAccess')}</p>{order.updates?.length ? order.updates.map((update) => {
          const participantChanges = update.update_type === 'PARTICIPANTS_CHANGED' ? formatParticipantChanges(update.structured_data, references.users, locale) : [];
          const structuredAttachmentIds = Array.isArray(update.structured_data.attachmentIds) ? update.structured_data.attachmentIds.filter((value): value is string => typeof value === 'string') : [];
          const legacyAttachmentId = typeof update.structured_data.attachmentId === 'string' ? update.structured_data.attachmentId : null;
          const attachmentIds = [...new Set([...structuredAttachmentIds, ...(legacyAttachmentId ? [legacyAttachmentId] : [])])];
          const updateAttachments = (order.attachments ?? []).filter((attachment) => attachmentIds.includes(attachment.id));
          return <article className="timeline-item" key={update.id}><span className="timeline-dot" /><div><strong>{getUpdateLabel(update.update_type, locale)}</strong>{update.update_type !== 'FILE_EVIDENCE_ADDED' && <p>{update.note}</p>}{participantChanges.length > 0 && <ul className="participant-change-list">{participantChanges.map((change) => <li key={change}>{change}</li>)}</ul>}{updateAttachments.length > 0 && <div className="timeline-attachment-list">{updateAttachments.map((attachment) => <a key={attachment.id} href={attachment.drive_url} target="_blank" rel="noreferrer"><FileText /> <span><strong>{attachment.original_file_name ?? attachment.file_name}</strong><small>{attachment.evidence_type} · {attachment.uploaded_by}</small></span><ExternalLink /></a>)}</div>}<small>{update.author} · {formatDistanceToNow(new Date(update.created_at), { addSuffix: true, locale: dateLocale })}</small><ProgressDiscussion orderId={order.id} update={update} locale={locale} canComment={canComment} onChanged={onChanged} /></div></article>;
        }) : <p className="muted">{t('noUpdates')}</p>}</section>
        {isManager && <details className="audit-details"><summary>Technical audit history ({audits?.length ?? 0})</summary>{audits?.length ? audits.map((audit: any) => <article className="timeline-item" key={audit.id}><span className="timeline-dot" /><div><strong>{String(audit.event_type).replaceAll('_', ' ')}</strong>{audit.reason && <p>{audit.reason}</p>}<small>{audit.author ?? 'System'} · {formatDistanceToNow(new Date(audit.created_at), { addSuffix: true, locale: dateLocale })}</small></div></article>) : <p className="muted">No audit events recorded.</p>}</details>}
      </div>
      <footer className="drawer-actions">{currentUser.roles.includes('ADMINISTRATOR') && <button className="secondary-button delete-work-order-button" onClick={() => { setDeleteError(''); setConfirmingDelete(true); }}><Trash2 /> {locale === 'id' ? 'Hapus pekerjaan' : 'Delete work order'}</button>}{canChangeCondition && <button className="secondary-button" onClick={() => setAction('condition')}>{locale === 'id' ? 'Laporkan masalah' : 'Report issue'}</button>}{isManager && <button className="secondary-button" onClick={() => setAction('due-date')}>{locale === 'id' ? 'Ubah tanggal tenggat' : 'Change due date'}</button>}{isStructuredVendorStage && canProgress && <button className="primary-button" onClick={() => setAction('vendor')}>{progressActionLabel}</button>}{isProposalApproval && canDecideProposal && <button className="primary-button" onClick={() => setAction('proposal-decision')}>{progressActionLabel}</button>}{!isStructuredVendorStage && !isProposalApproval && !hasUnresolvedInternalProcurement && (canProgress || canReopen) && <button className="primary-button" onClick={() => setAction('workflow')}>{progressActionLabel}</button>}</footer>
      {action === 'workflow' && <WorkflowActionForm order={order as WorkOrder} currentUser={currentUser} locale={locale} onClose={() => setAction(null)} onChanged={async () => { setAction(null); await onChanged(); }} />}
      {action === 'vendor' && <VendorActionForm order={order} onClose={() => setAction(null)} onChanged={async () => { setAction(null); await onChanged(); }} />}
      {action === 'proposal-decision' && <ProposalDecisionForm order={order} locale={locale} onClose={() => setAction(null)} onChanged={async () => { setAction(null); await onChanged(); }} />}
      {action === 'condition' && <ConditionActionForm order={order as WorkOrder} locale={locale} onClose={() => setAction(null)} onChanged={async () => { setAction(null); await onChanged(); }} />}
      {action === 'due-date' && <DueDateActionForm order={order as WorkOrder} locale={locale} onClose={() => setAction(null)} onChanged={async () => { setAction(null); await onChanged(); }} />}
      {action === 'participants' && <ParticipantsActionForm order={order} references={references} locale={locale} onClose={() => setAction(null)} onChanged={async () => { setAction(null); await onChanged(); }} />}
      {confirmingDelete && <section className="action-panel delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-work-order-title"><header><div><span>{locale === 'id' ? 'Tindakan administrator' : 'Administrator action'}</span><h3 id="delete-work-order-title">{locale === 'id' ? 'Hapus pekerjaan ini?' : 'Delete this work order?'}</h3></div><button className="icon-button" onClick={() => setConfirmingDelete(false)} disabled={deleting} aria-label={t('close')}><X /></button></header><p>{locale === 'id' ? `${order.work_order_number} akan disembunyikan dari daftar, laporan, persetujuan, dan notifikasi. Riwayatnya tetap disimpan untuk audit.` : `${order.work_order_number} will be hidden from lists, reports, approvals, and notifications. Its history will remain stored for audit.`}</p>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}<footer><button className="secondary-button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>{locale === 'id' ? 'Batal' : 'Cancel'}</button><button className="primary-button destructive-button" onClick={() => void deleteWorkOrder()} disabled={deleting}><Trash2 /> {deleting ? (locale === 'id' ? 'Menghapus...' : 'Deleting...') : (locale === 'id' ? 'Ya, hapus pekerjaan' : 'Yes, delete work order')}</button></footer></section>}
    </section>
  </div>;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem('woko-locale') as Locale) || 'id');
  const [orders, setOrders] = useState<Order[]>([]);
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'error'>('loading');
  const [startupError, setStartupError] = useState('');
  const [query, setQuery] = useState('');
  const [workView, setWorkView] = useState<'all' | 'mine'>('all');
  const [selected, setSelected] = useState<Order | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [references, setReferences] = useState<ReferenceData | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showOrganizationSettings, setShowOrganizationSettings] = useState(false);
  const [showApprovals, setShowApprovals] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showWorkLists, setShowWorkLists] = useState(false);

  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [pushStatus, setPushStatus] = useState<'idle' | 'subscribing' | 'subscribed' | 'unsupported' | 'unavailable' | 'denied' | 'failed'>('idle');
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const t = translator(locale);

  const loadReferences = async () => setReferences(await api<ReferenceData>('/reference-data'));

  const loadOrders = async () => {
    try {
      const loaded = await api<Order[]>('/work-orders');
      setOrders(loaded);
      if (selected) {
        const detail = await api<Order>(`/work-orders/${selected.id}`);
        setSelected(detail);
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setAuthState('unauthenticated');
    }
  };

  useEffect(() => {
    Promise.all([api<CurrentUser>('/me'), api<ReferenceData>('/reference-data'), api<Order[]>('/work-orders'), api<{ count: number }>('/notifications/unread-count')])
      .then(async ([user, loadedReferences, loadedOrders, unread]) => {
        const savedLocale = localStorage.getItem('woko-locale') as Locale | null;
        const effectiveLocale = savedLocale ?? user.preferredLocale;
        if (savedLocale && savedLocale !== user.preferredLocale) await api('/me/preferences', { method: 'PATCH', body: JSON.stringify({ locale: savedLocale }) });
        localStorage.setItem('woko-locale', effectiveLocale); setLocale(effectiveLocale);
        setCurrentUser({ ...user, preferredLocale: effectiveLocale }); setReferences(loadedReferences); setOrders(loadedOrders); setUnreadNotifications(unread.count); setAuthState('authenticated');
        const startupParams = new URLSearchParams(window.location.search);
        if (startupParams.get('view') === 'work-lists') setShowWorkLists(true);
        if (startupParams.get('digest')) setShowNotifications(true);
        const workOrderId = startupParams.get('workOrder');
        if (workOrderId) {
          try { setSelected(await api<Order>(`/work-orders/${workOrderId}`)); } catch { /* Keep the work-order list available when a deep link is stale. */ }
        }
      })
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 401) setAuthState('unauthenticated');
        else { setStartupError(caught instanceof Error ? caught.message : 'The application could not be loaded.'); setAuthState('error'); }
      });
  }, []);

  const openOrder = async (order: Order) => {
    setSelected(order);

    try { setSelected(await api<Order>(`/work-orders/${order.id}`)); } catch { /* Keep list data visible. */ }
  };

  const deleteOrder = async (order: Order) => {
    await api(`/work-orders/${order.id}`, { method: 'DELETE' });
    setOrders((current) => current.filter((item) => item.id !== order.id));
    setSelected(null);
  };

  const changeLocale = async () => {
    const next = locale === 'id' ? 'en' : 'id';
    localStorage.setItem('woko-locale', next);
    setLocale(next);
    setCurrentUser((user) => user ? { ...user, preferredLocale: next } : user);
    await api('/me/preferences', { method: 'PATCH', body: JSON.stringify({ locale: next }) }).catch(() => undefined);
  };

  const enablePushNotifications = async () => {
    setPushStatus('subscribing');
    try { setPushStatus(await subscribeToPushNotifications()); } catch { setPushStatus('failed'); }
  };

  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); setCurrentUser(null); setAuthState('unauthenticated'); };
  const loginError = new URLSearchParams(window.location.search).get('error') ?? undefined;
  if (authState === 'loading') return <main className="login-page"><section className="login-card loading-card"><span className="loading-logo"><BrandLogo variant="icon" /><span className="loading-orbit" /></span><p>Checking your session…</p></section></main>;
  if (authState === 'error') return <StartupErrorScreen message={startupError} onRetry={() => window.location.reload()} />;
  if (authState === 'unauthenticated' || !currentUser) return <LoginScreen error={loginError} />;

  const managerAccess = currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
  const visibleOrders = managerAccess && workView === 'mine'
    ? orders.filter((order) => order.assignee_id === currentUser.id || order.assignees?.some((person) => person.id === currentUser.id) || order.workers?.some((person) => person.id === currentUser.id) || order.reviewer_id === currentUser.id || order.overseers?.some((person) => person.id === currentUser.id))
    : orders;
  const filtered = visibleOrders.filter((order) => `${order.work_order_number} ${order.title} ${order.building} ${order.room_or_area}`.toLowerCase().includes(deferredQuery));
  const canCreate = managerAccess || currentUser.roles.includes('PERSON_IN_CHARGE');
  const counts = {
    active: filtered.filter((order) => order.status === 'ACTIVE').length,
    overdue: filtered.filter((order) => order.deadlineGroup === 'OVERDUE').length,
    blocked: filtered.filter((order) => order.condition === 'BLOCKED').length,
    review: filtered.filter((order) => order.workflow_stage === 'REVIEW' || order.workflow_stage === 'APPROVAL').length,
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top" aria-label={`${t('productName')} · ${t('appSubtitle')}`}><BrandLogo /></a>
      <nav aria-label="Primary"><button className="nav-item nav-button active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><BriefcaseBusiness /> {t('workOrders')}</button><button className="nav-item nav-button" onClick={() => setShowWorkLists(true)}><ClipboardCheck /> Work Lists</button>{managerAccess && <button className="nav-item nav-button" onClick={() => setShowApprovals(true)}><CheckCircle2 /> {t('approvals')}<span className="nav-count">{orders.filter((order) => order.workflow_stage === 'APPROVAL' || order.workflow_stage === 'REVIEW').length}</span></button>}<button className="nav-item nav-button" onClick={() => setShowNotifications(true)}><Bell /> {t('notifications')}{unreadNotifications > 0 && <span className="nav-count">{unreadNotifications}</span>}</button>{managerAccess && <button className="nav-item nav-button" onClick={() => setShowReports(true)}><BarChart3 /> {t('reports')}</button>}{managerAccess && <button className="nav-item nav-button" onClick={() => setShowOrganizationSettings(true)}><Settings /> {t('organizationSettings')}</button>}<button className="nav-item nav-button" onClick={() => void logout()}><LogOut /> {t('signOut')}</button></nav>
      <div className="sidebar-footer"><button className="quiet-language-button" onClick={changeLocale} title={t('language')}><Languages /> {locale === 'id' ? 'English' : 'Bahasa Indonesia'}</button><div className="sidebar-user"><Avatar name={currentUser.fullName} photoUrl={currentUser.profilePhotoUrl} /><strong>{currentUser.fullName}</strong></div></div>
    </aside>

    <main id="top">
      <header className="mobile-header"><button className="icon-button mobile-language-button" aria-label={t('language')} onClick={changeLocale}><Languages /></button><a className="brand compact" href="#top" aria-label={`${t('productName')} · ${t('appSubtitle')}`}><BrandLogo /></a><button className="icon-button notification-button" aria-label={t('notifications')} onClick={() => setShowNotifications(true)}><Bell />{unreadNotifications > 0 && <span>{unreadNotifications}</span>}</button></header>
      <div className="page-content">
        <div className="page-header"><div><span className="eyebrow">{t('appSubtitle')}</span><h1>{t('workOrders')}</h1><p>{t('overview')}</p></div><div className="header-actions">{canCreate && <button className="primary-button" onClick={() => setShowCreate(true)} disabled={!references}><Plus /> {t('create')}</button>}</div></div>

        {pushStatus !== 'subscribed' && <section className="push-notification-prompt" aria-label={t('enablePushNotifications')}><div><strong>{t('enablePushNotifications')}</strong><p>{pushStatus === 'denied' ? t('pushNotificationsDenied') : pushStatus === 'unavailable' ? t('pushNotificationsUnavailable') : pushStatus === 'unsupported' ? t('pushNotificationsUnsupported') : pushStatus === 'failed' ? t('pushNotificationsFailed') : t('pushNotificationsDescription')}</p></div>{pushStatus !== 'denied' && pushStatus !== 'unavailable' && pushStatus !== 'unsupported' && <button className="secondary-button" onClick={() => void enablePushNotifications()} disabled={pushStatus === 'subscribing'}>{pushStatus === 'subscribing' ? t('enablingPushNotifications') : t('enable')}</button>}</section>}

        <section className="metric-grid" aria-label={t('overview')}>
          <article><span className="metric-icon navy"><BriefcaseBusiness /></span><span><strong>{counts.active}</strong><small>{t('active')}</small></span></article>
          <article><span className="metric-icon red"><Clock3 /></span><span><strong>{counts.overdue}</strong><small>{t('overdue')}</small></span></article>
          <article><span className="metric-icon gold"><ShieldAlert /></span><span><strong>{counts.blocked}</strong><small>{t('blocked')}</small></span></article>
          <article><span className="metric-icon sage"><ClipboardCheck /></span><span><strong>{counts.review}</strong><small>{t('review')}</small></span></article>
        </section>

        {managerAccess && <div className="work-scope-control" aria-label="Work-order scope"><button className={workView === 'all' ? 'active' : ''} onClick={() => setWorkView('all')}>{t('allWork')}</button><button className={workView === 'mine' ? 'active' : ''} onClick={() => setWorkView('mine')}>{t('myWork')}</button></div>}
        <div className="toolbar"><label className="search-field"><Search /><span className="sr-only">{t('search')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} /></label><button className="filter-button"><Filter /> <span>{t('filter')}</span></button></div>

        <div className="work-sections" id="work">
          {!filtered.length && <p className="empty-work">{t('noWork')}</p>}
          {groups.map((group) => {
            const groupOrders = filtered.filter((order) => order.deadlineGroup === group);
            if (!groupOrders.length) return null;
            return <section className="work-section" key={group}><header><span className={`section-indicator section-${group.toLowerCase()}`} /><h2>{t(group)}</h2><span className="section-count">{groupOrders.length}</span><button className="icon-button small" aria-label={`Collapse ${t(group)}`}><ChevronDown /></button></header><div className="card-grid">{groupOrders.map((order) => <WorkOrderCard key={order.id} order={order} locale={locale} onOpen={() => openOrder(order)} />)}</div></section>;
          })}
        </div>
      </div>
    </main>

    {canCreate && <button className="fab" aria-label={t('create')} onClick={() => setShowCreate(true)} disabled={!references}><Plus /></button>}
    <nav className="bottom-nav" aria-label="Mobile navigation"><button className="active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><BriefcaseBusiness /><span>{t('workOrders')}</span></button><button onClick={() => setShowWorkLists(true)}><ClipboardCheck /><span>Work Lists</span></button><button onClick={() => setShowNotifications(true)}><Bell /><span>{t('notifications')}</span></button>{managerAccess && <button onClick={() => setShowApprovals(true)}><CheckCircle2 /><span>{t('approvals')}</span></button>}{managerAccess && <button onClick={() => setShowReports(true)}><BarChart3 /><span>{t('reports')}</span></button>}</nav>
    {selected && references && <DetailDrawer order={selected} locale={locale} currentUser={currentUser} references={references} onClose={() => setSelected(null)} onChanged={loadOrders} onDelete={deleteOrder} />}
    {showOrganizationSettings && managerAccess && references && <OrganizationSettings references={references} administrator={currentUser.roles.includes('ADMINISTRATOR')} onClose={() => setShowOrganizationSettings(false)} onChanged={loadReferences} />}
    {showApprovals && currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER') && <ApprovalsView currentUser={currentUser} locale={locale} onClose={() => setShowApprovals(false)} onOpenOrder={(order) => { setShowApprovals(false); setSelected(order); }} />}
    {showNotifications && <NotificationsView onClose={() => { const url = new URL(window.location.href); url.searchParams.delete('digest'); window.history.replaceState({}, '', url); setShowNotifications(false); }} onChanged={() => void api<{ count: number }>('/notifications/unread-count').then((value) => setUnreadNotifications(value.count))} canRetryEmail={currentUser.roles.includes('ADMINISTRATOR')} />}
    {showReports && <ReportsView onClose={() => setShowReports(false)} />}
    {showWorkLists && <WorkListsView currentUser={currentUser} onClose={() => setShowWorkLists(false)} />}

    {showCreate && references && <div className="sheet-backdrop" onMouseDown={() => setShowCreate(false)}><div onMouseDown={(event) => event.stopPropagation()}><CreateWorkOrderForm references={references} currentUser={currentUser} locale={locale} onClose={() => setShowCreate(false)} onCreated={async (id) => { setShowCreate(false); await loadOrders(); setSelected(await api<Order>(`/work-orders/${id}`)); }} /></div></div>}
  </div>;
}
