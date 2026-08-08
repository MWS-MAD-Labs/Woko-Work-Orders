import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, ArrowRight, Camera, Check, CheckCircle2, ChevronDown, ClipboardList, Clock3, ExternalLink, MapPin, X } from 'lucide-react';
import { api, apiResourceUrl, apiWithMeta, ApiError, uploadWithProgress } from './api';
import type { CurrentUser, WorkListItemStatus, WorkListOccurrence } from './types';
import type { Locale } from './i18n';

const closedStatuses = new Set(['OVERDUE', 'MISSED', 'SUBMITTED', 'SUBMITTED_LATE']);

function workListCopy(locale: Locale) {
  const id = locale === 'id';
  return {
    labels: id
      ? { DAILY: 'Harian', WEEKLY: 'Mingguan · Sabtu', MONTHLY: 'Bulanan · Sabtu terakhir', OPEN: 'Terbuka', OVERDUE: 'Terlambat', MISSED: 'Terlewat', SUBMITTED: 'Dikirim', SUBMITTED_LATE: 'Dikirim terlambat', COMPLETED: 'Selesai', NOT_APPLICABLE: 'Tidak berlaku', ISSUE_FOUND: 'Masalah ditemukan' }
      : { DAILY: 'Daily', WEEKLY: 'Weekly · Saturday', MONTHLY: 'Monthly · Last Saturday', OPEN: 'Open', OVERDUE: 'Overdue', MISSED: 'Missed', SUBMITTED: 'Submitted', SUBMITTED_LATE: 'Submitted late', COMPLETED: 'Completed', NOT_APPLICABLE: 'Not applicable', ISSUE_FOUND: 'Issue found' },
    operationsActivity: id ? 'Aktivitas operasional' : 'Operations activity',
    assignedAreas: id ? 'Area tugas Anda' : 'Your assigned areas',
    title: id ? 'Pekerjaan Rutin' : 'Routine Work',
    managerIntro: id ? 'Tinjau daftar periksa operasional bersama di seluruh lokasi yang ditugaskan.' : 'Review shared operational checklists across every assigned location.',
    workerIntro: id ? 'Selesaikan daftar periksa lokasi yang ditugaskan kepada Anda dan lampirkan bukti setelah pekerjaan selesai.' : 'Complete your assigned location checklists and attach evidence as work is finished.',
    overview: id ? 'Ringkasan Pekerjaan Rutin' : 'Routine Work overview',
    checklistGroups: id ? 'Grup daftar periksa' : 'Checklist groups', openLocations: id ? 'Lokasi terbuka' : 'Open locations', submitted: id ? 'Dikirim' : 'Submitted', missed: id ? 'Terlewat' : 'Missed',
    managerNote: id ? 'Manajer dapat meninjau seluruh aktivitas. Templat dikelola melalui Pengaturan Organisasi.' : 'Managers can review all activity. Templates are managed from Organization Settings.',
    sharedNote: id ? 'Setiap lokasi memiliki satu daftar periksa bersama. Pembaruan oleh satu pekerja yang ditugaskan akan langsung dibagikan kepada semua orang.' : 'Each location has one shared checklist. An update by one assigned worker is immediately shared with everyone.',
    locations: id ? 'lokasi' : 'locations', due: id ? 'Tenggat' : 'Due', open: id ? 'terbuka' : 'open', assignedWorkers: id ? 'Pekerja yang ditugaskan' : 'Assigned workers',
    requiredUpdated: id ? 'tugas wajib diperbarui' : 'required tasks updated', updated: id ? 'diperbarui' : 'updated', required: id ? 'Wajib' : 'Required', optional: id ? 'Opsional' : 'Optional',
    done: id ? 'Selesai' : 'Done', issue: id ? 'Masalah' : 'Issue', moreItems: id ? 'item daftar periksa lainnya' : 'more checklist items',
    viewMissed: id ? 'Lihat daftar periksa yang terlewat' : 'View missed checklist', viewSubmission: id ? 'Lihat kiriman' : 'View submission', openEvidence: id ? 'Buka dan tambahkan bukti' : 'Open and add evidence',
    empty: id ? 'Belum ada pekerjaan rutin yang tersedia.' : 'No Routine Work is available yet.', loading: id ? 'Memuat…' : 'Loading…', loadMore: id ? 'Muat lebih banyak pekerjaan rutin' : 'Load more Routine Work',
    checklist: id ? 'Daftar periksa' : 'Checklist', closesHelp: id ? 'tugas wajib telah diselesaikan · daftar akan ditutup setelah setiap item diselesaikan' : 'required tasks finalized · the list closes after every item is finalized',
    earlierEvidence: id ? 'Bukti penyelesaian sebelumnya' : 'Earlier completion evidence', earlierEvidenceHelp: id ? 'Foto yang diunggah sebelum bukti per item daftar periksa tersedia.' : 'Photos uploaded before checklist-item evidence was introduced.', uploadedBy: id ? 'Diunggah oleh' : 'Uploaded by', completionNote: id ? 'Catatan penyelesaian' : 'Completion note',
    reportIssue: id ? 'Laporkan masalah' : 'Report an issue', notApplicable: id ? 'Tandai tidak berlaku' : 'Mark as not applicable', issueDescription: id ? 'Jelaskan masalahnya agar tim fasilitas dapat menindaklanjuti.' : 'Describe what is wrong so the facilities team can follow up.', naDescription: id ? 'Jelaskan alasan item daftar periksa ini tidak berlaku.' : 'Explain why this checklist item does not apply.', reportIssueAction: id ? 'Laporkan masalah' : 'Report issue', saveReason: id ? 'Simpan alasan' : 'Save reason',
    completionEyebrow: id ? 'Penyelesaian daftar periksa' : 'Checklist completion', completeItem: id ? 'Selesaikan item' : 'Complete item', checklistItem: id ? 'Item daftar periksa' : 'Checklist item', independent: id ? 'Penyelesaian ini tidak bergantung pada item daftar periksa lain di lokasi ini.' : 'This completion is independent from the other checklist items at this location.',
    addPhoto: id ? 'Tambahkan foto penyelesaian *' : 'Add completion photo *', selectAnother: id ? 'Pilih foto lain' : 'Select another photo', photoRequired: id ? 'Foto wajib dilampirkan untuk item ini.' : 'A photo is required for this item.', completionNoteLabel: id ? 'Catatan penyelesaian' : 'Completion note', optionalLower: id ? 'Opsional' : 'Optional', completionPlaceholder: id ? 'Tambahkan konteks atau detail tindak lanjut untuk item ini.' : 'Add context or follow-up details for this item.', cancel: id ? 'Batal' : 'Cancel', completing: id ? 'Menyelesaikan…' : 'Completing…', close: id ? 'Tutup' : 'Close',
    updateEyebrow: id ? 'Pembaruan daftar periksa' : 'Checklist update', description: id ? 'Deskripsi *' : 'Description *', issuePlaceholder: id ? 'Berikan detail yang cukup agar orang lain dapat memahami situasinya.' : 'Add enough detail for someone else to understand the situation.', minimum: id ? 'Minimum 3 karakter.' : 'Minimum 3 characters.', saving: id ? 'Menyimpan…' : 'Saving…',
    loadFailed: id ? 'Pekerjaan rutin tidak dapat dimuat.' : 'Could not load Routine Work.', loadMoreFailed: id ? 'Pekerjaan rutin tambahan tidak dapat dimuat.' : 'Could not load more Routine Work.', loadOneFailed: id ? 'Pekerjaan rutin tidak dapat dimuat.' : 'Could not load Routine Work.', refreshFailed: id ? 'Pekerjaan rutin bersama tidak dapat diperbarui.' : 'The shared Routine Work could not be refreshed.', updateFailed: id ? 'Item daftar periksa tidak dapat diperbarui. Pekerjaan rutin telah dimuat ulang.' : 'Could not update the checklist item. Routine Work was refreshed.', saveFailed: id ? 'Item tidak dapat disimpan. Pekerjaan rutin bersama telah dimuat ulang.' : 'Could not save item. The shared Routine Work was refreshed.', completeFailed: id ? 'Item daftar periksa tidak dapat diselesaikan.' : 'The checklist item could not be completed.',
    staleUpdate: id ? 'Pekerjaan rutin telah dimuat ulang untuk mengantisipasi pembaruan oleh pekerja lain.' : 'Routine Work was refreshed in case another worker updated it.', staleSave: id ? 'Pekerjaan rutin telah dimuat ulang karena mungkin telah diperbarui oleh pekerja lain.' : 'This Routine Work was refreshed because another worker may have updated it.',
    completedRefreshFailed: id ? 'Item telah diselesaikan, tetapi pekerjaan rutin terbaru tidak dapat dimuat. Data akan diperbarui otomatis saat koneksi kembali.' : 'Item completed, but the latest Routine Work could not be loaded. It will refresh automatically when connectivity returns.',
    deadlineMissed: id ? 'Pekerjaan rutin ini telah melewati tenggat dan ditandai sebagai terlewat. Pekerja tidak perlu melakukan tindakan lebih lanjut.' : 'This Routine Work passed its deadline and was marked as missed. No further worker action is required.', unassigned: id ? 'Anda tidak lagi ditugaskan ke pekerjaan rutin ini.' : 'You are no longer assigned to this Routine Work.',
    conflictUnavailable: id ? 'Pekerja lain telah memperbarui item daftar periksa ini. Daftar bersama telah dimuat ulang.' : 'Another worker already updated this checklist item. The shared list was refreshed.', conflictClosed: id ? 'Pekerjaan rutin ini telah melewati tenggat atau tidak lagi terbuka. Daftar bersama telah dimuat ulang.' : 'This Routine Work passed its deadline or is no longer open. The shared list was refreshed.', conflictForbidden: id ? 'Pekerjaan rutin ini tidak lagi tersedia untuk Anda.' : 'This Routine Work is no longer available to you.', conflictDefault: id ? 'Item daftar periksa tidak dapat diselesaikan. Daftar bersama telah dimuat ulang.' : 'The checklist item could not be completed. The shared list was refreshed.',
  };
}

function dueLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function localizedError(caught: unknown, fallback: string, locale: Locale) {
  return locale === 'en' && caught instanceof Error ? caught.message : fallback;
}

function WorkerAvatar({ worker }: { worker: { full_name: string; profile_photo_url: string | null } }) {
  const [failed, setFailed] = useState(false);
  const initials = worker.full_name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return <span className={`work-list-worker-avatar${worker.profile_photo_url && !failed ? ' has-photo' : ''}`} title={worker.full_name}>{worker.profile_photo_url && !failed ? <img src={worker.profile_photo_url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials}</span>;
}

function completionConflictMessage(error: ApiError, locale: Locale): string {
  const copy = workListCopy(locale);
  if (error.code === 'ITEM_UNAVAILABLE') return copy.conflictUnavailable;
  if (error.code === 'OCCURRENCE_CLOSED') return copy.conflictClosed;
  if (error.code === 'FORBIDDEN' || error.status === 403) return copy.conflictForbidden;
  return copy.conflictDefault;
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

export function WorkListsView({ currentUser, locale = 'en' }: { currentUser: CurrentUser; locale?: Locale }) {
  const copy = workListCopy(locale);
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
      if (listRequest.current === controller) setError(localizedError(caught, copy.loadFailed, locale));
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
      setError(localizedError(caught, copy.loadMoreFailed, locale));
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
  }, [locale]);

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
      setError(localizedError(caught, copy.loadOneFailed, locale));
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
      setError(locale === 'en' && caught instanceof Error ? `${caught.message} ${copy.staleUpdate}` : copy.updateFailed);
    } finally {
      setBusyItemId('');
    }
  };

  const openLists = lists.filter((list) => !closedStatuses.has(list.status)).length;
  const submittedLists = lists.filter((list) => list.status === 'SUBMITTED' || list.status === 'SUBMITTED_LATE').length;
  const missedLists = lists.filter((list) => list.status === 'MISSED').length;

  return <div className="work-lists-page">
      <div className="page-header work-lists-page-header"><div><span className="eyebrow">{manager ? copy.operationsActivity : copy.assignedAreas}</span><h1>{copy.title}</h1><p>{manager ? copy.managerIntro : copy.workerIntro}</p></div><ClipboardList aria-hidden="true" /></div>
      <section className="metric-grid work-list-metrics" aria-label={copy.overview}>
        <article><span className="metric-icon navy"><ClipboardList /></span><span><strong>{groups.length}</strong><small>{copy.checklistGroups}</small></span></article>
        <article><span className="metric-icon gold"><Clock3 /></span><span><strong>{openLists}</strong><small>{copy.openLocations}</small></span></article>
        <article><span className="metric-icon sage"><CheckCircle2 /></span><span><strong>{submittedLists}</strong><small>{copy.submitted}</small></span></article>
        <article><span className="metric-icon red"><AlertTriangle /></span><span><strong>{missedLists}</strong><small>{copy.missed}</small></span></article>
      </section>
      <div className="work-lists-content">
        {error && <p className="form-error" role="alert">{error}</p>}
        {manager && <p className="muted work-list-manager-note">{copy.managerNote}</p>}
        <p className="work-list-shared-note"><CheckCircle2 /> {copy.sharedNote}</p>
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
                  <div className="work-list-group-title"><span>{copy.labels[group.recurrence]} · {group.lists.length} {copy.locations}</span><h3>{group.title}</h3><p><Clock3 /> {copy.due} {dueLabel(group.dueAt, locale)} · {openLocations} {copy.open}{missedLocations ? ` · ${missedLocations} ${copy.missed.toLocaleLowerCase(locale === 'id' ? 'id-ID' : 'en-US')}` : ''}</p></div>
                  <ChevronDown />
                </button>
                <div className="work-list-group-workers"><span>{copy.assignedWorkers}</span><div>{group.workers.map((worker) => <WorkerAvatar key={worker.id} worker={worker} />)}<strong>{group.workers.length}</strong></div></div>
                <div className="work-list-group-progress"><span><strong>{resolved}/{required}</strong> {copy.requiredUpdated}</span><span className="work-list-progress-track"><span style={{ width: `${progress}%` }} /></span></div>
              </header>
              {expanded && <div className="work-list-group-locations">{group.lists.map((list) => {
                const closed = closedStatuses.has(list.status);
                const locationProgress = list.required_count ? Math.min(100, Math.round(((list.required_resolved_count ?? 0) / list.required_count) * 100)) : 100;
                return <article className={`work-list-card ${list.status.toLowerCase()}`} key={list.id}>
                  <button className="work-list-card-header" onClick={() => void open(list)}><span className="work-list-card-main"><span className="work-list-card-eyebrow">{copy.labels[list.status]}</span><strong><MapPin /> {list.location_snapshot.name}</strong></span><span className="work-list-card-location-progress">{list.required_resolved_count ?? 0}/{list.required_count ?? 0}<small>{copy.updated}</small></span></button>
                  <div className="work-list-progress location-progress"><span className="work-list-progress-track"><span style={{ width: `${locationProgress}%` }} /></span></div>
                  <div className="work-list-preview">{list.preview_items?.map((item) => <div className={`work-list-preview-item ${item.status ? item.status.toLowerCase() : ''}`} key={item.id}><span className="work-list-item-state">{item.status === 'COMPLETED' ? <Check /> : item.status === 'ISSUE_FOUND' ? <AlertTriangle /> : <span />}</span><button className="work-list-item-title" onClick={() => void open(list)}><strong>{item.title}</strong><small>{item.status ? `${copy.labels[item.status]}${item.resolved_by ? ` · ${item.resolved_by}` : ''}` : item.required ? copy.required : copy.optional}</small></button>{!closed && !item.status && <span className="work-list-quick-actions"><button className="quick-done" disabled={Boolean(busyItemId)} onClick={() => setCompletionRequest({ list, itemId: item.id, itemTitle: item.title })}><Check /> {copy.done}</button><button className="quick-issue" disabled={Boolean(busyItemId)} onClick={() => setIssueRequest({ list, itemId: item.id, itemTitle: item.title })}><AlertTriangle /> {copy.issue}</button></span>}</div>)}{(list.item_count ?? 0) > 3 && <button className="work-list-more-items" onClick={() => void open(list)}>+{(list.item_count ?? 0) - 3} {copy.moreItems} <ArrowRight /></button>}</div>
                  <button className="work-list-open-button" onClick={() => void open(list)}>{list.status === 'MISSED' ? copy.viewMissed : closed ? copy.viewSubmission : copy.openEvidence} <ArrowRight /></button>
                </article>;
              })}</div>}
            </section>;
          })}
        </div>
        {!lists.length && <p className="empty-approval">{copy.empty}</p>}
        {nextOffset !== null && <button className="secondary-button work-list-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? copy.loading : copy.loadMore}</button>}
      </div>
      {selected && <WorkListDetail occurrence={selected} manager={manager} locale={locale} onClose={() => setSelected(null)} onUnavailable={async (caught) => { setSelected(null); await load(); setError(caught.code === 'MISSED' ? copy.deadlineMissed : copy.unassigned); }} onChanged={() => refreshSelected(selected.id)} />}
      {completionRequest && <ItemCompletionDialog occurrence={completionRequest.list} itemId={completionRequest.itemId} itemTitle={completionRequest.itemTitle} locale={locale} onCancel={() => setCompletionRequest(null)} onConflict={async (caught) => { setCompletionRequest(null); await load(); setError(completionConflictMessage(caught, locale)); }} onComplete={async () => { const request = completionRequest; setCompletionRequest(null); try { await refreshSelected(request.list.id, false); } catch { setError(copy.completedRefreshFailed); } }} />}
      {issueRequest && <IssueNoteDialog itemTitle={issueRequest.itemTitle} locale={locale} onCancel={() => setIssueRequest(null)} onSubmit={async (note) => { const request = issueRequest; setIssueRequest(null); await quickUpdate(request.list, request.itemId, 'ISSUE_FOUND', note); }} />}
  </div>;
}

function WorkListDetail({ occurrence, manager, locale, onClose, onChanged, onUnavailable }: { occurrence: WorkListOccurrence; manager: boolean; locale: Locale; onClose: () => void; onChanged: () => Promise<WorkListOccurrence>; onUnavailable: (error: ApiError) => Promise<void> | void }) {
  const copy = workListCopy(locale);
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
      setError(localizedError(caught, copy.refreshFailed, locale));
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
      if (available) setError(locale === 'en' && caught instanceof Error ? `${caught.message} ${copy.staleSave}` : copy.saveFailed);
    } finally {
      setBusy(false);
    }
  };
  const closed = closedStatuses.has(current.status);
  const requiredComplete = current.items?.filter((item) => item.required && item.status !== null).length ?? 0;
  const requiredCount = current.items?.filter((item) => item.required).length ?? 0;

  return <div className="drawer-backdrop">
    <section className="drawer work-list-detail">
      <header className="drawer-header"><div><span>{copy.labels[current.recurrence]} · {copy.labels[current.status]}</span><h2>{current.template_snapshot.title}</h2><p><MapPin /> {current.location_snapshot.name}</p></div><button className="icon-button" onClick={onClose} aria-label={copy.close}><X /></button></header>
      <div className="drawer-content work-list-detail-content">
        {current.template_snapshot.instructions && <p className="description">{current.template_snapshot.instructions}</p>}
        {error && <p className="form-error">{error}</p>}
        <section className="checklist-items"><header><div><h3>{copy.checklist}</h3><p>{requiredComplete}/{requiredCount} {copy.closesHelp}</p></div></header>{current.items?.map((item) => <article key={item.id} className={item.status === 'ISSUE_FOUND' ? 'issue' : item.status === 'COMPLETED' ? 'complete' : ''}><span className="detail-item-state">{item.status === 'COMPLETED' ? <Check /> : item.status === 'ISSUE_FOUND' ? <AlertTriangle /> : <span />}</span><div><strong>{item.title}{item.required && <b> *</b>}</strong>{item.instructions && <p>{item.instructions}</p>}{item.status && <small>{copy.labels[item.status]} {item.resolved_by ? `· ${item.resolved_by}` : ''}{item.note ? ` · ${item.note}` : ''}</small>}{item.evidence?.map((file) => <a className="work-list-item-evidence" key={file.id} href={apiResourceUrl(file.drive_url)} target="_blank" rel="noreferrer"><ExternalLink /> {file.file_name}</a>)}</div>{!closed && !item.status && <div className="item-actions"><button disabled={busy} onClick={() => setCompletionRequest({ itemId: item.id, itemTitle: item.title })}><CheckCircle2 /> {copy.done}</button><button disabled={busy} onClick={() => setReasonRequest({ itemId: item.id, itemTitle: item.title, status: 'NOT_APPLICABLE', initialNote: item.note ?? '' })}>{copy.notApplicable}</button><button disabled={busy} onClick={() => setReasonRequest({ itemId: item.id, itemTitle: item.title, status: 'ISSUE_FOUND', initialNote: item.note ?? '' })}><AlertTriangle /> {copy.issue}</button></div>}</article>)}</section>
        {current.evidence?.length ? <section className="work-list-evidence"><header><div><h3>{copy.earlierEvidence}</h3><p>{copy.earlierEvidenceHelp}</p></div></header>{current.evidence.map((file) => <a key={file.id} href={apiResourceUrl(file.drive_url)} target="_blank" rel="noreferrer"><ExternalLink /> <span>{file.file_name}<small>{copy.uploadedBy} {file.uploaded_by}</small></span></a>)}</section> : null}
        {manager && closed && current.overall_note && <section className="work-list-submission-note"><h3>{copy.completionNote}</h3><p>{current.overall_note}</p></section>}
      </div>
      {completionRequest && <ItemCompletionDialog occurrence={current} itemId={completionRequest.itemId} itemTitle={completionRequest.itemTitle} locale={locale} onCancel={() => setCompletionRequest(null)} onConflict={async (caught) => { setCompletionRequest(null); const available = await refresh(); if (available) setError(completionConflictMessage(caught, locale)); }} onComplete={async () => { setCompletionRequest(null); const refreshed = await refresh(); if (!refreshed) setError(copy.completedRefreshFailed); }} />}
      {reasonRequest && <IssueNoteDialog itemTitle={reasonRequest.itemTitle} locale={locale} title={reasonRequest.status === 'ISSUE_FOUND' ? copy.reportIssue : copy.notApplicable} description={reasonRequest.status === 'ISSUE_FOUND' ? copy.issueDescription : copy.naDescription} submitLabel={reasonRequest.status === 'ISSUE_FOUND' ? copy.reportIssueAction : copy.saveReason} initialNote={reasonRequest.initialNote} onCancel={() => setReasonRequest(null)} onSubmit={async (note) => { const request = reasonRequest; setReasonRequest(null); await updateItem(request.itemId, request.status, note); }} />}
    </section>
  </div>;
}

function ItemCompletionDialog({ occurrence, itemId, itemTitle, locale, onCancel, onComplete, onConflict }: { occurrence: WorkListOccurrence; itemId: string; itemTitle: string; locale: Locale; onCancel: () => void; onComplete: () => Promise<void> | void; onConflict: (error: ApiError) => Promise<void> | void }) {
  const copy = workListCopy(locale);
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
      setError(localizedError(caught, copy.completeFailed, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return <div ref={backdrop} className="work-list-dialog-backdrop" onMouseDown={() => { if (!submitting) onCancel(); }}>
    <section ref={dialog} tabIndex={-1} className="work-list-dialog item-completion-dialog" role="dialog" aria-modal="true" aria-labelledby="work-list-completion-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span className="work-list-dialog-icon completion"><CheckCircle2 /></span><div><span>{copy.completionEyebrow}</span><h3 id="work-list-completion-title">{copy.completeItem}</h3></div><button className="icon-button" onClick={onCancel} disabled={submitting} aria-label={copy.close}><X /></button></header>
      <div className="work-list-dialog-content"><div className="work-list-dialog-item"><small>{copy.checklistItem}</small><strong>{itemTitle}</strong></div><p>{copy.independent}</p>{error && <p className="form-error" role="alert">{error}</p>}<button ref={photoPicker} type="button" className="work-list-item-photo-picker" onClick={() => fileInput.current?.click()} disabled={submitting}><Camera /><span><strong>{file ? file.name : copy.addPhoto}</strong><small>{file ? copy.selectAnother : copy.photoRequired}</small></span></button><input ref={fileInput} className="sr-only" tabIndex={-1} type="file" accept="image/*" capture="environment" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setProgress(0); }} />{submitting && progress > 0 && <span className="upload-progress"><span style={{ width: `${progress}%` }} /></span>}<label className="form-field"><span>{copy.completionNoteLabel} <small>{copy.optionalLower}</small></span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={copy.completionPlaceholder} /></label></div>
      <footer><button className="secondary-button" onClick={onCancel} disabled={submitting}>{copy.cancel}</button><button className="primary-button" onClick={() => void submit()} disabled={!file || submitting}><Check /> {submitting ? copy.completing : copy.completeItem}</button></footer>
    </section>
  </div>;
}

function IssueNoteDialog({ itemTitle, locale, title, description, submitLabel, initialNote = '', onCancel, onSubmit }: { itemTitle: string; locale: Locale; title?: string; description?: string; submitLabel?: string; initialNote?: string; onCancel: () => void; onSubmit: (note: string) => Promise<void> | void }) {
  const copy = workListCopy(locale);
  const dialogTitle = title ?? copy.reportIssue;
  const dialogDescription = description ?? copy.issueDescription;
  const dialogSubmitLabel = submitLabel ?? copy.reportIssueAction;
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
      <header><span className="work-list-dialog-icon"><AlertTriangle /></span><div><span>{copy.updateEyebrow}</span><h3 id="work-list-issue-title">{dialogTitle}</h3></div><button className="icon-button" onClick={onCancel} disabled={submitting} aria-label={copy.close}><X /></button></header>
      <div className="work-list-dialog-content"><div className="work-list-dialog-item"><small>{copy.checklistItem}</small><strong>{itemTitle}</strong></div><p>{dialogDescription}</p><label className="form-field"><span>{copy.description}</span><textarea ref={noteInput} rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder={copy.issuePlaceholder} /><small>{copy.minimum}</small></label></div>
      <footer><button className="secondary-button" onClick={onCancel} disabled={submitting}>{copy.cancel}</button><button className="primary-button issue-submit-button" onClick={() => void submit()} disabled={!valid || submitting}><AlertTriangle /> {submitting ? copy.saving : dialogSubmitLabel}</button></footer>
    </section>
  </div>;
}
