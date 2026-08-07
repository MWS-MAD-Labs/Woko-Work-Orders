import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Camera, Check, CheckCircle2, ClipboardList, Clock3, ExternalLink, MapPin, X } from 'lucide-react';
import { api, uploadWithProgress } from './api';
import type { CurrentUser, WorkListItemStatus, WorkListOccurrence } from './types';

const labels: Record<string, string> = { DAILY: 'Daily', WEEKLY: 'Weekly · Saturday', MONTHLY: 'Monthly · Last Saturday', OPEN: 'Open', OVERDUE: 'Overdue', SUBMITTED: 'Submitted', SUBMITTED_LATE: 'Submitted late' };
const closedStatuses = new Set(['SUBMITTED', 'SUBMITTED_LATE']);

function dueLabel(value: string) {
  return new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function WorkListsView({ currentUser, onClose }: { currentUser: CurrentUser; onClose: () => void }) {
  const [lists, setLists] = useState<WorkListOccurrence[]>([]);
  const [selected, setSelected] = useState<WorkListOccurrence | null>(null);
  const [error, setError] = useState('');
  const [busyItemId, setBusyItemId] = useState('');
  const [issueRequest, setIssueRequest] = useState<{ list: WorkListOccurrence; itemId: string; itemTitle: string } | null>(null);
  const manager = currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');

  const load = async () => {
    try {
      setError('');
      setLists(await api<WorkListOccurrence[]>('/work-lists'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Work Lists.');
    }
  };

  useEffect(() => { void load(); }, []);

  const open = async (item: WorkListOccurrence) => {
    try {
      setSelected(await api<WorkListOccurrence>(`/work-lists/${item.id}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Work List.');
    }
  };

  const refreshSelected = async (id: string) => {
    const detail = await api<WorkListOccurrence>(`/work-lists/${id}`);
    setSelected(detail);
    await load();
    return detail;
  };

  const quickUpdate = async (list: WorkListOccurrence, itemId: string, status: 'COMPLETED' | 'ISSUE_FOUND', note = '') => {
    setBusyItemId(itemId);
    try {
      const detail = await api<WorkListOccurrence>(`/work-lists/${list.id}`);
      await api(`/work-lists/${list.id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ status, note, expectedVersion: detail.version }) });
      await refreshSelected(list.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the checklist item.');
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
        <div className="work-list-cards">
          {lists.map((list) => {
            const closed = closedStatuses.has(list.status);
            const progress = list.required_count ? Math.round(((list.resolved_count ?? 0) / list.required_count) * 100) : 100;
            return <article className={`work-list-card ${list.status.toLowerCase()}`} key={list.id}>
              <button className="work-list-card-header" onClick={() => void open(list)}>
                <span className="work-list-card-main"><span className="work-list-card-eyebrow">{labels[list.recurrence]} · {labels[list.status]}</span><strong>{list.template_snapshot.title}</strong><small><MapPin /> {list.location_snapshot.name}</small></span>
                <span className="work-list-card-due"><Clock3 /><span>Due</span><strong>{dueLabel(list.due_at)}</strong></span>
              </button>
              <div className="work-list-progress"><span><strong>{list.resolved_count ?? 0}/{list.required_count ?? 0}</strong> required updated</span><span className="work-list-progress-track"><span style={{ width: `${progress}%` }} /></span></div>
              <div className="work-list-preview">
                {list.preview_items?.map((item) => <div className={`work-list-preview-item ${item.status ? item.status.toLowerCase() : ''}`} key={item.id}>
                  <span className="work-list-item-state">{item.status === 'COMPLETED' ? <Check /> : item.status === 'ISSUE_FOUND' ? <AlertTriangle /> : <span />}</span>
                  <button className="work-list-item-title" onClick={() => void open(list)}><strong>{item.title}</strong>{item.required && <small>Required</small>}</button>
                  {!closed && <span className="work-list-quick-actions"><button className="quick-done" disabled={Boolean(busyItemId)} onClick={() => void quickUpdate(list, item.id, 'COMPLETED')}><Check /> Done</button><button className="quick-issue" disabled={Boolean(busyItemId)} onClick={() => setIssueRequest({ list, itemId: item.id, itemTitle: item.title })}><AlertTriangle /> Issue</button></span>}
                </div>)}
                {(list.item_count ?? 0) > 3 && <button className="work-list-more-items" onClick={() => void open(list)}>+{(list.item_count ?? 0) - 3} more checklist items <ArrowRight /></button>}
              </div>
              <button className="work-list-open-button" onClick={() => void open(list)}>{closed ? 'View submission' : 'Open and add evidence'} <ArrowRight /></button>
            </article>;
          })}
        </div>
        {!lists.length && <p className="empty-approval">No Work Lists are available yet.</p>}
      </div>
      {selected && <WorkListDetail occurrence={selected} manager={manager} onClose={() => setSelected(null)} onChanged={() => refreshSelected(selected.id)} />}
      {issueRequest && <IssueNoteDialog itemTitle={issueRequest.itemTitle} onCancel={() => setIssueRequest(null)} onSubmit={async (note) => { const request = issueRequest; setIssueRequest(null); await quickUpdate(request.list, request.itemId, 'ISSUE_FOUND', note); }} />}
    </section>
  </div>;
}

function WorkListDetail({ occurrence, manager, onClose, onChanged }: { occurrence: WorkListOccurrence; manager: boolean; onClose: () => void; onChanged: () => Promise<WorkListOccurrence> }) {
  const [current, setCurrent] = useState(occurrence);
  const [note, setNote] = useState(occurrence.overall_note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasonRequest, setReasonRequest] = useState<{ itemId: string; itemTitle: string; status: 'NOT_APPLICABLE' | 'ISSUE_FOUND'; initialNote: string } | null>(null);

  useEffect(() => { setCurrent(occurrence); setNote(occurrence.overall_note ?? ''); }, [occurrence]);

  const refresh = async () => setCurrent(await onChanged());
  const updateItem = async (itemId: string, status: WorkListItemStatus, note = '') => {
    setBusy(true);
    try {
      await api(`/work-lists/${current.id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ status, note, expectedVersion: current.version }) });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save item.');
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await uploadWithProgress(`/work-lists/${current.id}/evidence`, form, () => undefined);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Photo upload failed.');
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/work-lists/${current.id}/submit`, { method: 'POST', body: JSON.stringify({ note, expectedVersion: current.version }) });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Complete the required tasks and upload a photo before submitting.');
    } finally {
      setBusy(false);
    }
  };
  const closed = closedStatuses.has(current.status);
  const requiredComplete = current.items?.filter((item) => item.required && item.status !== null).length ?? 0;
  const requiredCount = current.items?.filter((item) => item.required).length ?? 0;
  const canSubmit = requiredComplete === requiredCount && Boolean(current.evidence?.length);

  return <div className="drawer-backdrop">
    <section className="drawer work-list-detail">
      <header className="drawer-header"><div><span>{labels[current.recurrence]} · {labels[current.status]}</span><h2>{current.template_snapshot.title}</h2><p><MapPin /> {current.location_snapshot.name}</p></div><button className="icon-button" onClick={onClose}><X /></button></header>
      <div className="drawer-content work-list-detail-content">
        {current.template_snapshot.instructions && <p className="description">{current.template_snapshot.instructions}</p>}
        {error && <p className="form-error">{error}</p>}
        <section className="checklist-items"><header><div><h3>Checklist</h3><p>{requiredComplete}/{requiredCount} required tasks updated</p></div></header>{current.items?.map((item) => <article key={item.id} className={item.status === 'ISSUE_FOUND' ? 'issue' : item.status === 'COMPLETED' ? 'complete' : ''}><span className="detail-item-state">{item.status === 'COMPLETED' ? <Check /> : item.status === 'ISSUE_FOUND' ? <AlertTriangle /> : <span />}</span><div><strong>{item.title}{item.required && <b> *</b>}</strong>{item.instructions && <p>{item.instructions}</p>}{item.status && <small>{item.status.replaceAll('_', ' ')} {item.resolved_by ? `· ${item.resolved_by}` : ''}{item.note ? ` · ${item.note}` : ''}</small>}</div>{!closed && <div className="item-actions"><button disabled={busy} onClick={() => void updateItem(item.id, 'COMPLETED')}><CheckCircle2 /> Done</button><button disabled={busy} onClick={() => setReasonRequest({ itemId: item.id, itemTitle: item.title, status: 'NOT_APPLICABLE', initialNote: item.note ?? '' })}>N/A</button><button disabled={busy} onClick={() => setReasonRequest({ itemId: item.id, itemTitle: item.title, status: 'ISSUE_FOUND', initialNote: item.note ?? '' })}><AlertTriangle /> Issue</button></div>}</article>)}</section>
        <section className="work-list-evidence"><header><div><h3>Completion photo *</h3><p>Upload at least one photo before submitting.</p></div>{!closed && <label className="secondary-button"><Camera /> Add photo<input hidden type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>}</header>{current.evidence?.map((file) => <a key={file.id} href={file.drive_url} target="_blank" rel="noreferrer"><ExternalLink /> <span>{file.file_name}<small>Uploaded by {file.uploaded_by}</small></span></a>)}{!current.evidence?.length && <p className="work-list-no-evidence">No completion photo uploaded yet.</p>}</section>
        {!closed && <label className="form-field work-list-optional-note"><span>Completion note <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context, follow-up details, or a handover note." /></label>}
        {manager && closed && current.overall_note && <section className="work-list-submission-note"><h3>Completion note</h3><p>{current.overall_note}</p></section>}
      </div>
      {!closed && <footer className="drawer-actions work-list-submit-actions"><span>{!requiredComplete || requiredComplete < requiredCount ? 'Complete all required tasks' : !current.evidence?.length ? 'Add a completion photo' : 'Ready to submit'}</span><button className="primary-button" disabled={busy || !canSubmit} onClick={() => void submit()}>Submit Work List</button></footer>}
      {reasonRequest && <IssueNoteDialog itemTitle={reasonRequest.itemTitle} title={reasonRequest.status === 'ISSUE_FOUND' ? 'Report an issue' : 'Mark as not applicable'} description={reasonRequest.status === 'ISSUE_FOUND' ? 'Describe what is wrong so the facilities team can follow up.' : 'Explain why this checklist item does not apply.'} submitLabel={reasonRequest.status === 'ISSUE_FOUND' ? 'Report issue' : 'Save reason'} initialNote={reasonRequest.initialNote} onCancel={() => setReasonRequest(null)} onSubmit={async (note) => { const request = reasonRequest; setReasonRequest(null); await updateItem(request.itemId, request.status, note); }} />}
    </section>
  </div>;
}

function IssueNoteDialog({ itemTitle, title = 'Report an issue', description = 'Describe what is wrong so the facilities team can follow up.', submitLabel = 'Report issue', initialNote = '', onCancel, onSubmit }: { itemTitle: string; title?: string; description?: string; submitLabel?: string; initialNote?: string; onCancel: () => void; onSubmit: (note: string) => Promise<void> | void }) {
  const [note, setNote] = useState(initialNote);
  const [submitting, setSubmitting] = useState(false);
  const valid = note.trim().length >= 3;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try { await onSubmit(note.trim()); } finally { setSubmitting(false); }
  };

  return <div className="work-list-dialog-backdrop" onMouseDown={onCancel}>
    <section className="work-list-dialog" role="dialog" aria-modal="true" aria-labelledby="work-list-issue-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span className="work-list-dialog-icon"><AlertTriangle /></span><div><span>Checklist update</span><h3 id="work-list-issue-title">{title}</h3></div><button className="icon-button" onClick={onCancel} aria-label="Close"><X /></button></header>
      <div className="work-list-dialog-content"><div className="work-list-dialog-item"><small>Checklist item</small><strong>{itemTitle}</strong></div><p>{description}</p><label className="form-field"><span>Description *</span><textarea autoFocus rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add enough detail for someone else to understand the situation." /><small>Minimum 3 characters.</small></label></div>
      <footer><button className="secondary-button" onClick={onCancel} disabled={submitting}>Cancel</button><button className="primary-button issue-submit-button" onClick={() => void submit()} disabled={!valid || submitting}><AlertTriangle /> {submitting ? 'Saving…' : submitLabel}</button></footer>
    </section>
  </div>;
}
