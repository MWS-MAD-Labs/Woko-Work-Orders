import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, ArrowRight, Camera, Check, CheckCircle2, ChevronDown, ClipboardList, Clock3, ExternalLink, MapPin, X } from 'lucide-react';
import { api, apiResourceUrl, apiWithMeta, ApiError, uploadWithProgress } from './api';
import type { CurrentUser, WorkListItemStatus, WorkListOccurrence } from './types';

const labels: Record<string, string> = { DAILY: 'Daily', WEEKLY: 'Weekly · Saturday', MONTHLY: 'Monthly · Last Saturday', OPEN: 'Open', OVERDUE: 'Overdue', MISSED: 'Missed', SUBMITTED: 'Submitted', SUBMITTED_LATE: 'Submitted late' };
const closedStatuses = new Set(['OVERDUE', 'MISSED', 'SUBMITTED', 'SUBMITTED_LATE']);

function dueLabel(value: string) {
  return new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function WorkerAvatar({ worker }: { worker: { full_name: string; profile_photo_url: string | null } }) {
  const [failed, setFailed] = useState(false);
  const initials = worker.full_name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return <span className={`work-list-worker-avatar${worker.profile_photo_url && !failed ? ' has-photo' : ''}`} title={worker.full_name}>{worker.profile_photo_url && !failed ? <img src={worker.profile_photo_url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}</span>;
}

function completionConflictMessage(error: ApiError): string {
  if (error.code === 'ITEM_UNAVAILABLE') return 'Another worker already updated this checklist item. The shared list was refreshed.';
  if (error.code === 'OCCURRENCE_CLOSED') return 'This Work List passed its deadline or is no longer open. The shared list was refreshed.';
  if (error.code === 'FORBIDDEN' || error.status === 403) return 'This Work List is no longer available to you.';
  return 'The checklist item could not be completed. The shared list was refreshed.';
}

function useDialogFocus(backdropRef: RefObject<HTMLDivElement | null>, dialogRef: RefObject<HTMLElement | null>, initialFocusRef: RefObject<HTMLElement | null>, onCancel: () => void, dismissible = true) {
  const cancelRef = useRef(onCancel);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => { dismissibleRef.current = dismissible; }, [dismissible]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = backdropRef.current;
    const siblings = backdrop ? [...backdrop.parentElement?.children ?? []].filter((element) => element !== backdrop) as HTMLElement[] : [];
    const previousInert = siblings.map((element) => element.inert);
    for (const sibling of siblings) sibling.inert = true;
    initialFocusRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (dismissibleRef.current) cancelRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hidden);
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      siblings.forEach((element, index) => { element.inert = previousInert[index] ?? false; });
      previousFocus?.focus();
    };
  }, [backdropRef, dialogRef, initialFocusRef]);
}

export function WorkListsView({ currentUser, onClose }: { currentUser: CurrentUser; onClose: () => void }) {
  const [lists, setLists] = useState<WorkListOccurrence[]>([]);
  const [selected, setSelected] = useState<WorkListOccurrence | null>(null);
  const [error, setError] = useState('');
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyItemId, setBusyItemId] = useState('');
  const [issueRequest, setIssueRequest] = useState<{ list: WorkListOccurrence; itemId: string; itemTitle: string } | null>(null);
  const [completionRequest, setCompletionRequest] = useState<{ list: WorkListOccurrence; itemId: string; itemTitle: string } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const manager = currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
  const groups = useMemo(() => {
    const grouped = new Map<string, { key: string; title: string; recurrence: WorkListOccurrence['recurrence']; periodDate: string; dueAt: string; workers: NonNullable<WorkListOccurrence['workers']>; lists: WorkListOccurrence[] }>();
    for (const list of lists) {
      const key = `${list.template_id}:${list.template_version}:${list.recurrence}:${list.period_date}`;
      const group = grouped.get(key) ?? { key, title: list.template_snapshot.title, recurrence: list.recurrence, periodDate: list.period_date, dueAt: list.due_at, workers: [], lists: [] };
      group.lists.push(list);
      const workers = new Map(group.workers.map((worker) => [worker.id, worker]));
      for (const worker of list.workers ?? []) workers.set(worker.id, worker);
      group.workers = [...workers.values()].sort((left, right) => left.full_name.localeCompare(right.full_name));
      grouped.set(key, group);
    }
    return [...grouped.values()];
  }, [lists]);

  const load = async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    try {
      const loaded = await apiWithMeta<WorkListOccurrence[], { limit: number; offset: number; hasMore: boolean; nextOffset: number | null }>('/work-lists', { signal: controller.signal });
      if (listRequest.current === controller) { setError(''); setLists(loaded.data); setNextOffset(loaded.meta?.nextOffset ?? null); }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (listRequest.current === controller) setError(caught instanceof Error ? caught.message : 'Could not load Work Lists.');
    }
  };

  const loadMore = async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const loaded = await apiWithMeta<WorkListOccurrence[], { nextOffset: number | null }>(`/work-lists?offset=${nextOffset}`);
      setLists((current) => {
        const byId = new Map(current.map((list) => [list.id, list]));
        for (const list of loaded.data) byId.set(list.id, list);
        return [...byId.values()];
      });
      setNextOffset(loaded.meta?.nextOffset ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load more Work Lists.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshWhenVisible); listRequest.current?.abort(); detailRequest.current?.abort(); };
  }, []);

  const fetchDetail = async (id: string) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    try {
      const detail = await api<WorkListOccurrence>(`/work-lists/${id}`, { signal: controller.signal });
      if (detailRequest.current !== controller) throw new DOMException('Superseded', 'AbortError');
      return detail;
    } finally {
      if (detailRequest.current === controller) detailRequest.current = null;
    }
  };

  const open = async (item: WorkListOccurrence) => {
    try {
      setSelected(await fetchDetail(item.id));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Could not load Work List.');
    }
  };

  const refreshSelected = async (id: string, openDrawer = true) => {
    const detail = await fetchDetail(id);
    if (openDrawer) setSelected(detail);
    await load();
    return detail;
  };

  const quickUpdate = async (list: WorkListOccurrence, itemId: string, status: 'ISSUE_FOUND', note = '') => {
    setBusyItemId(itemId);
    try {
      await api(`/work-lists/${list.id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ status, note }) });
      await refreshSelected(list.id, false);
    } catch (caught) {
      await load();
      setError(caught instanceof Error ? `${caught.message} The Work List was refreshed in case another worker updated it.` : 'Could not update the checklist item. The Work List was refreshed.');
    } finally {
      setBusyItemId('');
    }
  };

  return <div className="sheet-backdrop" onMouseDown={onClose}>
    <section className="sheet work-lists-sheet" onMouseDown={(event) => event.stopPropagation()}>
      <header className="sheet-header"><div><span>{manager ? 'Operations activity' : 'Your assigned areas'}</span><h2><ClipboardList /> Work Lists</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header>
      <div className="sheet-content work-lists-content">
        {error && <p className="form-error" role="alert">{error}</p>}
        {manager && <p className="muted work-list-manager-note">Managers can review all activity. Templates are managed from Organization Settings.</p>}
        <p className="work-list-shared-note"><CheckCircle2 /> Each location has one shared checklist. An update by one assigned worker is immediately shared with everyone.</p>
        <div className="work-list-groups">
          {groups.map((group) => {
            const resolved = group.lists.reduce((total, list) => total + (list.required_resolved_count ?? 0), 0);
            const required = group.lists.reduce((total, list) => total + (list.required_count ?? 0), 0);
            const progress = required ? Math.round((resolved / required) * 100) : 100;
            const openLocations = group.lists.filter((list) => !closedStatuses.has(list.status)).length;
            const missedLocations = group.lists.filter((list) => list.status === 'MISSED').length;
            const expanded = expandedGroups.has(group.key);
            return <section className={`work-list-group${expanded ? ' expanded' : ''}`} key={group.key}>
              <header className="work-list-group-header">
                <button className="work-list-group-toggle" onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })} aria-expanded={expanded}>
                  <div className="work-list-group-title"><span>{labels[group.recurrence]} · {group.lists.length} locations</span><h3>{group.title}</h3><p><Clock3 /> Due {dueLabel(group.dueAt)} · {openLocations} open{missedLocations ? ` · ${missedLocations} missed` : ''}</p></div>
                  <ChevronDown />
                </button>
                <div className="work-list-group-workers"><span>Assigned workers</span><div>{group.workers.map((worker) => <WorkerAvatar key={worker.id} worker={worker} />)}<strong>{group.workers.length}</strong></div></div>
                <div className="work-list-group-progress"><span><strong>{resolved}/{required}</strong> required tasks updated</span><span className="work-list-progress-track"><span style={{ width: `${progress}%` }} /></span></div>
              </header>
              {expanded && <div className="work-list-group-locations">{group.lists.map((list) => {
                const closed = closedStatuses.has(list.status);
                const locationProgress = list.required_count ? Math.min(100, Math.round(((list.required_resolved_count ?? 0) / list.required_count) * 100)) : 100;
                return <article className={`work-list-card ${list.status.toLowerCase()}`} key={list.id}>
                  <button className="work-list-card-header" onClick={() => void open(list)}><span className="work-list-card-main"><span className="work-list-card-eyebrow">{labels[list.status]}</span><strong><MapPin /> {list.location_snapshot.name}</strong></span><span className="work-list-card-location-progress">{list.required_resolved_count ?? 0}/{list.required_count ?? 0}<small>updated</small></span></button>
                  <div className="work-list-progress location-progress"><span className="work-list-progress-track"><span style={{ width: `${locationProgress}%` }} /></span></div>
                  <div className="work-list-preview">{list.preview_items?.map((item) => <div className={`work-list-preview-item ${item.status ? item.status.toLowerCase() : ''}`} key={item.id}><span className="work-list-item-state">{item.status === 'COMPLETED' ? <Check /> : item.status === 'ISSUE_FOUND' ? <AlertTriangle /> : <span />}</span><button className="work-list-item-title" onClick={() => void open(list)}><strong>{item.title}</strong><small>{item.status ? `${item.status.replaceAll('_', ' ')}${item.resolved_by ? ` · ${item.resolved_by}` : ''}` : item.required ? 'Required' : 'Optional'}</small></button>{!closed && !item.status && <span className="work-list-quick-actions"><button className="quick-done" disabled={Boolean(busyItemId)} onClick={() => setCompletionRequest({ list, itemId: item.id, itemTitle: item.title })}><Check /> Done</button><button className="quick-issue" disabled={Boolean(busyItemId)} onClick={() => setIssueRequest({ list, itemId: item.id, itemTitle: item.title })}><AlertTriangle /> Issue</button></span>}</div>)}{(list.item_count ?? 0) > 3 && <button className="work-list-more-items" onClick={() => void open(list)}>+{(list.item_count ?? 0) - 3} more checklist items <ArrowRight /></button>}</div>
                  <button className="work-list-open-button" onClick={() => void open(list)}>{list.status === 'MISSED' ? 'View missed checklist' : closed ? 'View submission' : 'Open and add evidence'} <ArrowRight /></button>
                </article>;
              })}</div>}
            </section>;
          })}
        </div>
        {!lists.length && <p className="empty-approval">No Work Lists are available yet.</p>}
        {nextOffset !== null && <button className="secondary-button work-list-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Load more Work Lists'}</button>}
      </div>
      {selected && <WorkListDetail occurrence={selected} manager={manager} onClose={() => setSelected(null)} onUnavailable={async (caught) => { setSelected(null); await load(); setError(caught.code === 'MISSED' ? 'This Work List passed its deadline and was marked as missed. No further worker action is required.' : 'You are no longer assigned to this Work List.'); }} onChanged={() => refreshSelected(selected.id)} />}
      {completionRequest && <ItemCompletionDialog occurrence={completionRequest.list} itemId={completionRequest.itemId} itemTitle={completionRequest.itemTitle} onCancel={() => setCompletionRequest(null)} onConflict={async (caught) => { setCompletionRequest(null); await load(); setError(completionConflictMessage(caught)); }} onComplete={async () => { const request = completionRequest; setCompletionRequest(null); try { await refreshSelected(request.list.id, false); } catch { setError('Item completed, but the latest Work List could not be loaded. It will refresh automatically when connectivity returns.'); } }} />}
      {issueRequest && <IssueNoteDialog itemTitle={issueRequest.itemTitle} onCancel={() => setIssueRequest(null)} onSubmit={async (note) => { const request = issueRequest; setIssueRequest(null); await quickUpdate(request.list, request.itemId, 'ISSUE_FOUND', note); }} />}
    </section>
  </div>;
}

function WorkListDetail({ occurrence, manager, onClose, onChanged, onUnavailable }: { occurrence: WorkListOccurrence; manager: boolean; onClose: () => void; onChanged: () => Promise<WorkListOccurrence>; onUnavailable: (error: ApiError) => Promise<void> | void }) {
  const [current, setCurrent] = useState(occurrence);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasonRequest, setReasonRequest] = useState<{ itemId: string; itemTitle: string; status: 'NOT_APPLICABLE' | 'ISSUE_FOUND'; initialNote: string } | null>(null);
  const [completionRequest, setCompletionRequest] = useState<{ itemId: string; itemTitle: string } | null>(null);

  useEffect(() => { setCurrent(occurrence); }, [occurrence]);

  const refresh = async () => {
    try {
      setCurrent(await onChanged());
      return true;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return false;
      if (caught instanceof ApiError && caught.status === 403) {
        await onUnavailable(caught);
        return false;
      }
      setError(caught instanceof Error ? caught.message : 'The shared Work List could not be refreshed.');
      return false;
    }
  };
  useEffect(() => {
    if (closedStatuses.has(current.status)) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [current.id, current.status]);
  const updateItem = async (itemId: string, status: WorkListItemStatus, note = '') => {
    setBusy(true);
    try {
      await api(`/work-lists/${current.id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ status, note }) });
      await refresh();
    } catch (caught) {
      const available = await refresh();
      if (available) setError(caught instanceof Error ? `${caught.message} This Work List was refreshed because another worker may have updated it.` : 'Could not save item. The shared Work List was refreshed.');
    } finally {
      setBusy(false);
    }
  };
  const closed = closedStatuses.has(current.status);
  const requiredComplete = current.items?.filter((item) => item.required && item.status !== null).length ?? 0;
  const requiredCount = current.items?.filter((item) => item.required).length ?? 0;

  return <div className="drawer-backdrop">
    <section className="drawer work-list-detail">
      <header className="drawer-header"><div><span>{labels[current.recurrence]} · {labels[current.status]}</span><h2>{current.template_snapshot.title}</h2><p><MapPin /> {current.location_snapshot.name}</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
      <div className="drawer-content work-list-detail-content">
        {current.template_snapshot.instructions && <p className="description">{current.template_snapshot.instructions}</p>}
        {error && <p className="form-error">{error}</p>}
        <section className="checklist-items"><header><div><h3>Checklist</h3><p>{requiredComplete}/{requiredCount} required tasks finalized · the list closes after every item is finalized</p></div></header>{current.items?.map((item) => <article key={item.id} className={item.status === 'ISSUE_FOUND' ? 'issue' : item.status === 'COMPLETED' ? 'complete' : ''}><span className="detail-item-state">{item.status === 'COMPLETED' ? <Check /> : item.status === 'ISSUE_FOUND' ? <AlertTriangle /> : <span />}</span><div><strong>{item.title}{item.required && <b> *</b>}</strong>{item.instructions && <p>{item.instructions}</p>}{item.status && <small>{item.status.replaceAll('_', ' ')} {item.resolved_by ? `· ${item.resolved_by}` : ''}{item.note ? ` · ${item.note}` : ''}</small>}{item.evidence?.map((file) => <a className="work-list-item-evidence" key={file.id} href={apiResourceUrl(file.drive_url)} target="_blank" rel="noreferrer"><ExternalLink /> {file.file_name}</a>)}</div>{!closed && !item.status && <div className="item-actions"><button disabled={busy} onClick={() => setCompletionRequest({ itemId: item.id, itemTitle: item.title })}><CheckCircle2 /> Done</button><button disabled={busy} onClick={() => setReasonRequest({ itemId: item.id, itemTitle: item.title, status: 'NOT_APPLICABLE', initialNote: item.note ?? '' })}>N/A</button><button disabled={busy} onClick={() => setReasonRequest({ itemId: item.id, itemTitle: item.title, status: 'ISSUE_FOUND', initialNote: item.note ?? '' })}><AlertTriangle /> Issue</button></div>}</article>)}</section>
        {current.evidence?.length ? <section className="work-list-evidence"><header><div><h3>Earlier completion evidence</h3><p>Photos uploaded before checklist-item evidence was introduced.</p></div></header>{current.evidence.map((file) => <a key={file.id} href={apiResourceUrl(file.drive_url)} target="_blank" rel="noreferrer"><ExternalLink /> <span>{file.file_name}<small>Uploaded by {file.uploaded_by}</small></span></a>)}</section> : null}
        {manager && closed && current.overall_note && <section className="work-list-submission-note"><h3>Completion note</h3><p>{current.overall_note}</p></section>}
      </div>
      {completionRequest && <ItemCompletionDialog occurrence={current} itemId={completionRequest.itemId} itemTitle={completionRequest.itemTitle} onCancel={() => setCompletionRequest(null)} onConflict={async (caught) => { setCompletionRequest(null); const available = await refresh(); if (available) setError(completionConflictMessage(caught)); }} onComplete={async () => { setCompletionRequest(null); const refreshed = await refresh(); if (!refreshed) setError('Item completed, but the latest Work List could not be loaded. It will refresh automatically when connectivity returns.'); }} />}
      {reasonRequest && <IssueNoteDialog itemTitle={reasonRequest.itemTitle} title={reasonRequest.status === 'ISSUE_FOUND' ? 'Report an issue' : 'Mark as not applicable'} description={reasonRequest.status === 'ISSUE_FOUND' ? 'Describe what is wrong so the facilities team can follow up.' : 'Explain why this checklist item does not apply.'} submitLabel={reasonRequest.status === 'ISSUE_FOUND' ? 'Report issue' : 'Save reason'} initialNote={reasonRequest.initialNote} onCancel={() => setReasonRequest(null)} onSubmit={async (note) => { const request = reasonRequest; setReasonRequest(null); await updateItem(request.itemId, request.status, note); }} />}
    </section>
  </div>;
}

function ItemCompletionDialog({ occurrence, itemId, itemTitle, onCancel, onComplete, onConflict }: { occurrence: WorkListOccurrence; itemId: string; itemTitle: string; onCancel: () => void; onComplete: () => Promise<void> | void; onConflict: (error: ApiError) => Promise<void> | void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoPicker = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(backdrop, dialog, photoPicker, onCancel, !submitting);

  const submit = async () => {
    if (!file || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const form = new FormData();
      form.append('note', note);
      form.append('file', file);
      await uploadWithProgress(`/work-lists/${occurrence.id}/items/${itemId}/complete`, form, setProgress);
      await onComplete();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 403 || caught.status === 409)) {
        await onConflict(caught);
        return;
      }
      setError(caught instanceof Error ? caught.message : 'The checklist item could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div ref={backdrop} className="work-list-dialog-backdrop" onMouseDown={() => { if (!submitting) onCancel(); }}>
    <section ref={dialog} tabIndex={-1} className="work-list-dialog item-completion-dialog" role="dialog" aria-modal="true" aria-labelledby="work-list-completion-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span className="work-list-dialog-icon completion"><CheckCircle2 /></span><div><span>Checklist completion</span><h3 id="work-list-completion-title">Complete item</h3></div><button className="icon-button" onClick={onCancel} disabled={submitting} aria-label="Close"><X /></button></header>
      <div className="work-list-dialog-content"><div className="work-list-dialog-item"><small>Checklist item</small><strong>{itemTitle}</strong></div><p>This completion is independent from the other checklist items at this location.</p>{error && <p className="form-error" role="alert">{error}</p>}<button ref={photoPicker} type="button" className="work-list-item-photo-picker" onClick={() => fileInput.current?.click()} disabled={submitting}><Camera /><span><strong>{file ? file.name : 'Add completion photo *'}</strong><small>{file ? 'Select another photo' : 'A photo is required for this item.'}</small></span></button><input ref={fileInput} className="sr-only" tabIndex={-1} type="file" accept="image/*" capture="environment" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setProgress(0); }} />{submitting && progress > 0 && <span className="upload-progress"><span style={{ width: `${progress}%` }} /></span>}<label className="form-field"><span>Completion note <small>Optional</small></span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context or follow-up details for this item." /></label></div>
      <footer><button className="secondary-button" onClick={onCancel} disabled={submitting}>Cancel</button><button className="primary-button" onClick={() => void submit()} disabled={!file || submitting}><Check /> {submitting ? 'Completing…' : 'Complete item'}</button></footer>
    </section>
  </div>;
}

function IssueNoteDialog({ itemTitle, title = 'Report an issue', description = 'Describe what is wrong so the facilities team can follow up.', submitLabel = 'Report issue', initialNote = '', onCancel, onSubmit }: { itemTitle: string; title?: string; description?: string; submitLabel?: string; initialNote?: string; onCancel: () => void; onSubmit: (note: string) => Promise<void> | void }) {
  const [note, setNote] = useState(initialNote);
  const [submitting, setSubmitting] = useState(false);
  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  useDialogFocus(backdrop, dialog, noteInput, onCancel, !submitting);
  const valid = note.trim().length >= 3;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try { await onSubmit(note.trim()); } finally { setSubmitting(false); }
  };

  return <div ref={backdrop} className="work-list-dialog-backdrop" onMouseDown={() => { if (!submitting) onCancel(); }}>
    <section ref={dialog} tabIndex={-1} className="work-list-dialog" role="dialog" aria-modal="true" aria-labelledby="work-list-issue-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span className="work-list-dialog-icon"><AlertTriangle /></span><div><span>Checklist update</span><h3 id="work-list-issue-title">{title}</h3></div><button className="icon-button" onClick={onCancel} disabled={submitting} aria-label="Close"><X /></button></header>
      <div className="work-list-dialog-content"><div className="work-list-dialog-item"><small>Checklist item</small><strong>{itemTitle}</strong></div><p>{description}</p><label className="form-field"><span>Description *</span><textarea ref={noteInput} rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add enough detail for someone else to understand the situation." /><small>Minimum 3 characters.</small></label></div>
      <footer><button className="secondary-button" onClick={onCancel} disabled={submitting}>Cancel</button><button className="primary-button issue-submit-button" onClick={() => void submit()} disabled={!valid || submitting}><AlertTriangle /> {submitting ? 'Saving…' : submitLabel}</button></footer>
    </section>
  </div>;
}
