import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, ExternalLink, FileText, History, RotateCcw, X } from 'lucide-react';
import { format } from 'date-fns';
import { enUS, id } from 'date-fns/locale';
import { api } from './api';
import { ProposalDecisionForm, WorkflowActionForm } from './WorkOrderForms';
import type { Locale } from './i18n';
import type { ApprovalQueue, CompletionReviewItem, CurrentUser, ProposalApprovalItem, WorkOrder } from './types';

interface CompletionDecision {
  order: WorkOrder;
  action: 'forward' | 'reject';
}

const priorityLabels: Record<Locale, Record<string, string>> = {
  id: { CRITICAL: 'Kritis', HIGH: 'Tinggi', NORMAL: 'Normal', LOW: 'Rendah' },
  en: { CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' },
};

export function ApprovalsView({ currentUser, locale, onClose, onOpenOrder }: { currentUser: CurrentUser; locale: Locale; onClose: () => void; onOpenOrder: (order: WorkOrder) => void }) {
  const [queue, setQueue] = useState<ApprovalQueue>({ proposalApprovals: [], completionReviews: [], internalProcurementReviews: [] });
  const [proposalDecision, setProposalDecision] = useState<WorkOrder | null>(null);
  const [completionDecision, setCompletionDecision] = useState<CompletionDecision | null>(null);
  const [error, setError] = useState('');
  const isId = locale === 'id';
  const dateLocale = isId ? id : enUS;
  const copy = isId ? {
    queue: 'Antrean manajemen', approvals: 'Persetujuan', close: 'Tutup persetujuan', intro: 'Tinjau proposal vendor dan pekerjaan yang telah diselesaikan sebelum mencatat keputusan manajemen.',
    loadError: 'Persetujuan tidak dapat dimuat.', orderLoadError: 'Pekerjaan tidak dapat dimuat.', requiredReview: 'Perlu ditinjau', vendorApprovals: 'Proposal Vendor Menunggu Persetujuan',
    vendor: 'Vendor', quotedCost: 'Biaya penawaran', submittedBy: 'Diajukan oleh', submitted: 'Diajukan', openEvidence: 'Buka bukti', decide: 'Putuskan',
    cannotDecideTitle: 'PIC pada pekerjaan ini tidak dapat memutuskan proposalnya.', selfApproval: 'Peninjau boleh memutuskan proposal yang diajukannya sendiri, tetapi PIC pada pekerjaan ini tidak boleh.', noVendor: 'Tidak ada proposal vendor yang menunggu persetujuan.',
    procurementApprovals: 'Proposal Pengadaan Internal Menunggu Tinjauan Fasilitas', reviewDecide: 'Tinjau & putuskan', noProcurement: 'Tidak ada proposal pengadaan internal yang menunggu tinjauan.',
    completionReviews: 'Pekerjaan Menunggu Tinjauan Penyelesaian', assignee: 'Penanggung jawab', dueDate: 'Tanggal tenggat', completionSummary: 'Ringkasan penyelesaian',
    completionPhotos: 'Foto penyelesaian', noPhoto: 'Tidak ada foto penyelesaian yang dilampirkan. Persetujuan memerlukan pengecualian foto yang terdokumentasi.', evidenceLinks: 'Tautan bukti', noEvidence: 'Tidak ada tautan bukti tambahan.',
    decisionHistory: 'Riwayat keputusan', approvedCompletion: 'Penyelesaian disetujui', rejectedProgress: 'Dikembalikan ke Sedang Dikerjakan', photoWaiver: 'Pengecualian foto', noDecisions: 'Belum ada keputusan penyelesaian sebelumnya.',
    openOrder: 'Buka pekerjaan', approveCompletion: 'Setujui penyelesaian', reviewWaiver: 'Tinjau pengecualian & setujui', rejectProgress: 'Kembalikan ke Sedang Dikerjakan', noCompletion: 'Tidak ada pekerjaan yang menunggu tinjauan penyelesaian.',
  } : {
    queue: 'Management queue', approvals: 'Approvals', close: 'Close approvals', intro: 'Review vendor proposals and completed work before recording a management decision.',
    loadError: 'Approvals could not be loaded.', orderLoadError: 'Work order could not be loaded.', requiredReview: 'Required review', vendorApprovals: 'Vendor Proposals Awaiting Approval',
    vendor: 'Vendor', quotedCost: 'Quoted cost', submittedBy: 'Submitted by', submitted: 'Submitted', openEvidence: 'Open evidence', decide: 'Decide',
    cannotDecideTitle: 'A PIC on this work order cannot decide its proposal.', selfApproval: 'A reviewer may decide a proposal they submitted, but a PIC on this work order cannot.', noVendor: 'No vendor proposals are awaiting approval.',
    procurementApprovals: 'Internal Procurement Proposals Awaiting Facilities Review', reviewDecide: 'Review & decide', noProcurement: 'No internal procurement proposals are awaiting review.',
    completionReviews: 'Work Awaiting Completion Review', assignee: 'Assignee', dueDate: 'Due date', completionSummary: 'Completion summary',
    completionPhotos: 'Completion photos', noPhoto: 'No completion photo attached. Approval requires a documented photo waiver.', evidenceLinks: 'Evidence links', noEvidence: 'No additional evidence links.',
    decisionHistory: 'Decision history', approvedCompletion: 'Approved completion', rejectedProgress: 'Rejected to In Progress', photoWaiver: 'Photo waiver', noDecisions: 'No previous completion decisions.',
    openOrder: 'Open work order', approveCompletion: 'Approve completion', reviewWaiver: 'Review waiver & approve', rejectProgress: 'Reject back to In Progress', noCompletion: 'No work is awaiting completion review.',
  };
  const dateTime = (value: string) => format(new Date(value), 'd MMM yyyy, HH:mm', { locale: dateLocale });
  const date = (value: string) => format(new Date(`${value}T00:00:00`), 'd MMM yyyy', { locale: dateLocale });
  const priority = (value: string) => priorityLabels[locale][value] ?? value.replaceAll('_', ' ');

  const load = async () => {
    try {
      setError('');
      setQueue(await api<ApprovalQueue>('/approvals'));
    } catch (caught) {
      setError(isId ? copy.loadError : caught instanceof Error ? caught.message : copy.loadError);
    }
  };

  useEffect(() => { void load(); }, []);

  const loadOrder = async (orderId: string) => {
    try {
      setError('');
      return await api<WorkOrder>(`/work-orders/${orderId}`);
    } catch (caught) {
      setError(isId ? copy.orderLoadError : caught instanceof Error ? caught.message : copy.orderLoadError);
      return null;
    }
  };

  const decideProposal = async (item: ProposalApprovalItem) => {
    const order = await loadOrder(item.id);
    if (order) setProposalDecision(order);
  };

  const decideCompletion = async (item: CompletionReviewItem, action: 'forward' | 'reject') => {
    const order = await loadOrder(item.id);
    if (order) setCompletionDecision({ order, action });
  };

  const openOrder = async (orderId: string) => {
    const order = await loadOrder(orderId);
    if (order) onOpenOrder(order);
  };

  return <div className="sheet-backdrop"><section className="sheet approvals-sheet">
    <header className="sheet-header"><div><span>{copy.queue}</span><h2>{copy.approvals}</h2></div><button className="icon-button" onClick={onClose} aria-label={copy.close}><X /></button></header>
    <div className="sheet-content approvals-content">
      <p className="muted">{copy.intro}</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="approval-queue-section" aria-labelledby="proposal-approvals-heading">
        <header><div><span>{copy.requiredReview}</span><h3 id="proposal-approvals-heading">{copy.vendorApprovals}</h3></div><strong>{queue.proposalApprovals.length}</strong></header>
        <div className="approval-list">{queue.proposalApprovals.map((item) => <article className="approval-card" key={item.id}>
          <div className="approval-card-main"><span>{item.work_order_number} · {priority(item.priority)}</span><h3>{item.title}</h3><dl><div><dt>{copy.vendor}</dt><dd>{item.proposal_data.vendorName}</dd></div><div><dt>{copy.quotedCost}</dt><dd>{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.proposal_data.quotedCost)}</dd></div><div><dt>{copy.submittedBy}</dt><dd>{item.submitted_by_name}</dd></div><div><dt>{copy.submitted}</dt><dd>{dateTime(item.submitted_at)}</dd></div></dl></div>
          <div className="approval-card-actions"><button className="secondary-button" onClick={() => void openOrder(item.id)}><ExternalLink /> {copy.openEvidence}</button><button className="primary-button" disabled={!item.can_decide} title={!item.can_decide ? copy.cannotDecideTitle : undefined} onClick={() => void decideProposal(item)}>{copy.decide}</button></div>
          {!item.can_decide && <small className="self-approval-note">{copy.selfApproval}</small>}
        </article>)}</div>
        {!queue.proposalApprovals.length && !error && <p className="empty-approval">{copy.noVendor}</p>}
      </section>

      <section className="approval-queue-section" aria-labelledby="internal-procurement-heading">
        <header><div><span>{copy.requiredReview}</span><h3 id="internal-procurement-heading">{copy.procurementApprovals}</h3></div><strong>{queue.internalProcurementReviews.length}</strong></header>
        <div className="approval-list">{queue.internalProcurementReviews.map((item) => <article className="approval-card" key={item.id}>
          <div className="approval-card-main"><span>{item.work_order_number} · {priority(item.priority)}</span><h3>{item.title}</h3><p>{item.requirement_note}</p><dl><div><dt>{copy.submittedBy}</dt><dd>{item.submitted_by_name}</dd></div><div><dt>{copy.submitted}</dt><dd>{dateTime(item.submitted_at)}</dd></div></dl><div className="approval-link-list">{item.proposal_documents.map((document) => <a key={document.id} href={document.drive_url} target="_blank" rel="noreferrer"><FileText /><span><strong>{document.file_name}</strong><small>{document.uploaded_by}</small></span><ExternalLink /></a>)}</div></div>
          <div className="approval-card-actions"><button className="primary-button" onClick={() => void openOrder(item.id)}>{copy.reviewDecide}</button></div>
        </article>)}</div>
        {!queue.internalProcurementReviews.length && !error && <p className="empty-approval">{copy.noProcurement}</p>}
      </section>

      <section className="approval-queue-section" aria-labelledby="completion-reviews-heading">
        <header><div><span>{copy.requiredReview}</span><h3 id="completion-reviews-heading">{copy.completionReviews}</h3></div><strong>{queue.completionReviews.length}</strong></header>
        <div className="approval-list">{queue.completionReviews.map((item) => {
          const photos = item.completion_evidence.filter((evidence) => evidence.mime_type.startsWith('image/'));
          const evidenceLinks = item.completion_evidence.filter((evidence) => !evidence.mime_type.startsWith('image/'));
          return <article className="approval-card completion-review-card" key={item.id}>
            <div className="approval-card-main">
              <span>{item.work_order_number} · {priority(item.priority)}</span><h3>{item.title}</h3>
              <dl><div><dt>{copy.assignee}</dt><dd>{item.assignee_name}</dd></div><div><dt>{copy.dueDate}</dt><dd>{date(item.due_date)}</dd></div><div><dt>{copy.submittedBy}</dt><dd>{item.submitted_by_name}</dd></div><div><dt>{copy.submitted}</dt><dd>{dateTime(item.submitted_at)}</dd></div></dl>
              <div className="completion-summary"><strong>{copy.completionSummary}</strong><p>{item.completion_summary}</p></div>
              <div className="completion-evidence-grid">
                <section><h4><Camera /> {copy.completionPhotos} <span>{photos.length}</span></h4>{photos.length ? <div className="approval-link-list">{photos.map((photo) => <a key={photo.id} href={photo.drive_url} target="_blank" rel="noreferrer"><Camera /><span><strong>{photo.file_name}</strong><small>{photo.uploaded_by}</small></span><ExternalLink /></a>)}</div> : <p className="photo-waiver-status">{copy.noPhoto}</p>}</section>
                <section><h4><FileText /> {copy.evidenceLinks} <span>{evidenceLinks.length}</span></h4>{evidenceLinks.length ? <div className="approval-link-list">{evidenceLinks.map((evidence) => <a key={evidence.id} href={evidence.drive_url} target="_blank" rel="noreferrer"><FileText /><span><strong>{evidence.file_name}</strong><small>{evidence.uploaded_by}</small></span><ExternalLink /></a>)}</div> : <p className="muted">{copy.noEvidence}</p>}</section>
              </div>
              <section className="decision-history"><h4><History /> {copy.decisionHistory} <span>{item.decision_history.length}</span></h4>{item.decision_history.length ? <ol>{item.decision_history.map((decision) => <li key={decision.id}><strong>{decision.decision === 'APPROVED' ? copy.approvedCompletion : copy.rejectedProgress}</strong><p>{decision.note}</p>{decision.waiver_reason && <small>{copy.photoWaiver}: {decision.waiver_reason}</small>}<small>{decision.decided_by} · {dateTime(decision.decided_at)}</small></li>)}</ol> : <p className="muted">{copy.noDecisions}</p>}</section>
            </div>
            <div className="approval-card-actions completion-actions"><button className="secondary-button" onClick={() => void openOrder(item.id)}><ExternalLink /> {copy.openOrder}</button><button className="primary-button" onClick={() => void decideCompletion(item, 'forward')}><CheckCircle2 /> {photos.length ? copy.approveCompletion : copy.reviewWaiver}</button><button className="secondary-button reject-button" onClick={() => void decideCompletion(item, 'reject')}><RotateCcw /> {copy.rejectProgress}</button></div>
          </article>;
        })}</div>
        {!queue.completionReviews.length && !error && <p className="empty-approval">{copy.noCompletion}</p>}
      </section>
    </div>
    {proposalDecision && <ProposalDecisionForm order={proposalDecision} locale={locale} onClose={() => setProposalDecision(null)} onChanged={async () => { setProposalDecision(null); await load(); }} />}
    {completionDecision && <WorkflowActionForm order={completionDecision.order} currentUser={currentUser} locale={locale} initialAction={completionDecision.action} onClose={() => setCompletionDecision(null)} onChanged={async () => { setCompletionDecision(null); await load(); }} />}
  </section></div>;
}
