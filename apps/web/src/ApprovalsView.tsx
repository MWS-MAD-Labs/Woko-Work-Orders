import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, ExternalLink, FileText, History, RotateCcw, X } from 'lucide-react';
import { format } from 'date-fns';
import { api } from './api';
import { ProposalDecisionForm, WorkflowActionForm } from './WorkOrderForms';
import type { ApprovalQueue, CompletionReviewItem, CurrentUser, ProposalApprovalItem, WorkOrder } from './types';

interface CompletionDecision {
  order: WorkOrder;
  action: 'forward' | 'reject';
}

export function ApprovalsView({ currentUser, onClose, onOpenOrder }: { currentUser: CurrentUser; onClose: () => void; onOpenOrder: (order: WorkOrder) => void }) {
  const [queue, setQueue] = useState<ApprovalQueue>({ proposalApprovals: [], completionReviews: [], internalProcurementReviews: [] });
  const [proposalDecision, setProposalDecision] = useState<WorkOrder | null>(null);
  const [completionDecision, setCompletionDecision] = useState<CompletionDecision | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setError('');
      setQueue(await api<ApprovalQueue>('/approvals'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Approvals could not be loaded.');
    }
  };

  useEffect(() => { void load(); }, []);

  const loadOrder = async (id: string) => {
    try {
      setError('');
      return await api<WorkOrder>(`/work-orders/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Work order could not be loaded.');
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

  const openOrder = async (id: string) => {
    const order = await loadOrder(id);
    if (order) onOpenOrder(order);
  };

  return <div className="sheet-backdrop"><section className="sheet approvals-sheet">
    <header className="sheet-header"><div><span>Management queue</span><h2>Approvals</h2></div><button className="icon-button" onClick={onClose} aria-label="Close approvals"><X /></button></header>
    <div className="sheet-content approvals-content">
      <p className="muted">Review vendor proposals and completed work before recording a management decision.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="approval-queue-section" aria-labelledby="proposal-approvals-heading">
        <header><div><span>Required review</span><h3 id="proposal-approvals-heading">Vendor Proposals Awaiting Approval</h3></div><strong>{queue.proposalApprovals.length}</strong></header>
        <div className="approval-list">{queue.proposalApprovals.map((item) => <article className="approval-card" key={item.id}>
          <div className="approval-card-main"><span>{item.work_order_number} · {item.priority}</span><h3>{item.title}</h3><dl><div><dt>Vendor</dt><dd>{item.proposal_data.vendorName}</dd></div><div><dt>Quoted cost</dt><dd>{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.proposal_data.quotedCost)}</dd></div><div><dt>Submitted by</dt><dd>{item.submitted_by_name}</dd></div><div><dt>Submitted</dt><dd>{format(new Date(item.submitted_at), 'd MMM yyyy, HH:mm')}</dd></div></dl></div>
          <div className="approval-card-actions"><button className="secondary-button" onClick={() => void openOrder(item.id)}><ExternalLink /> Open evidence</button><button className="primary-button" disabled={!item.can_decide} title={!item.can_decide ? 'A PIC on this work order cannot decide its proposal.' : undefined} onClick={() => void decideProposal(item)}>Decide</button></div>
          {!item.can_decide && <small className="self-approval-note">A reviewer may decide a proposal they submitted, but a PIC on this work order cannot.</small>}
        </article>)}</div>
        {!queue.proposalApprovals.length && !error && <p className="empty-approval">No vendor proposals are awaiting approval.</p>}
      </section>

      <section className="approval-queue-section" aria-labelledby="internal-procurement-heading">
        <header><div><span>Required review</span><h3 id="internal-procurement-heading">Internal Procurement Proposals Awaiting Facilities Review</h3></div><strong>{queue.internalProcurementReviews.length}</strong></header>
        <div className="approval-list">{queue.internalProcurementReviews.map((item) => <article className="approval-card" key={item.id}>
          <div className="approval-card-main"><span>{item.work_order_number} · {item.priority}</span><h3>{item.title}</h3><p>{item.requirement_note}</p><dl><div><dt>Submitted by</dt><dd>{item.submitted_by_name}</dd></div><div><dt>Submitted</dt><dd>{format(new Date(item.submitted_at), 'd MMM yyyy, HH:mm')}</dd></div></dl><div className="approval-link-list">{item.proposal_documents.map((document) => <a key={document.id} href={document.drive_url} target="_blank" rel="noreferrer"><FileText /><span><strong>{document.file_name}</strong><small>{document.uploaded_by}</small></span><ExternalLink /></a>)}</div></div>
          <div className="approval-card-actions"><button className="primary-button" onClick={() => void openOrder(item.id)}>Review & decide</button></div>
        </article>)}</div>
        {!queue.internalProcurementReviews.length && !error && <p className="empty-approval">No internal procurement proposals are awaiting review.</p>}
      </section>

      <section className="approval-queue-section" aria-labelledby="completion-reviews-heading">
        <header><div><span>Required review</span><h3 id="completion-reviews-heading">Work Awaiting Completion Review</h3></div><strong>{queue.completionReviews.length}</strong></header>
        <div className="approval-list">{queue.completionReviews.map((item) => {
          const photos = item.completion_evidence.filter((evidence) => evidence.mime_type.startsWith('image/'));
          const evidenceLinks = item.completion_evidence.filter((evidence) => !evidence.mime_type.startsWith('image/'));
          return <article className="approval-card completion-review-card" key={item.id}>
            <div className="approval-card-main">
              <span>{item.work_order_number} · {item.priority}</span><h3>{item.title}</h3>
              <dl><div><dt>Assignee</dt><dd>{item.assignee_name}</dd></div><div><dt>Due date</dt><dd>{format(new Date(`${item.due_date}T00:00:00`), 'd MMM yyyy')}</dd></div><div><dt>Submitted by</dt><dd>{item.submitted_by_name}</dd></div><div><dt>Submitted</dt><dd>{format(new Date(item.submitted_at), 'd MMM yyyy, HH:mm')}</dd></div></dl>
              <div className="completion-summary"><strong>Completion summary</strong><p>{item.completion_summary}</p></div>
              <div className="completion-evidence-grid">
                <section><h4><Camera /> Completion photos <span>{photos.length}</span></h4>{photos.length ? <div className="approval-link-list">{photos.map((photo) => <a key={photo.id} href={photo.drive_url} target="_blank" rel="noreferrer"><Camera /><span><strong>{photo.file_name}</strong><small>{photo.uploaded_by}</small></span><ExternalLink /></a>)}</div> : <p className="photo-waiver-status">No completion photo attached. Approval requires a documented photo waiver.</p>}</section>
                <section><h4><FileText /> Evidence links <span>{evidenceLinks.length}</span></h4>{evidenceLinks.length ? <div className="approval-link-list">{evidenceLinks.map((evidence) => <a key={evidence.id} href={evidence.drive_url} target="_blank" rel="noreferrer"><FileText /><span><strong>{evidence.file_name}</strong><small>{evidence.uploaded_by}</small></span><ExternalLink /></a>)}</div> : <p className="muted">No additional evidence links.</p>}</section>
              </div>
              <section className="decision-history"><h4><History /> Decision history <span>{item.decision_history.length}</span></h4>{item.decision_history.length ? <ol>{item.decision_history.map((decision) => <li key={decision.id}><strong>{decision.decision === 'APPROVED' ? 'Approved completion' : 'Rejected to In Progress'}</strong><p>{decision.note}</p>{decision.waiver_reason && <small>Photo waiver: {decision.waiver_reason}</small>}<small>{decision.decided_by} · {format(new Date(decision.decided_at), 'd MMM yyyy, HH:mm')}</small></li>)}</ol> : <p className="muted">No previous completion decisions.</p>}</section>
            </div>
            <div className="approval-card-actions completion-actions"><button className="secondary-button" onClick={() => void openOrder(item.id)}><ExternalLink /> Open work order</button><button className="primary-button" onClick={() => void decideCompletion(item, 'forward')}><CheckCircle2 /> {photos.length ? 'Approve completion' : 'Review waiver & approve'}</button><button className="secondary-button reject-button" onClick={() => void decideCompletion(item, 'reject')}><RotateCcw /> Reject back to In Progress</button></div>
          </article>;
        })}</div>
        {!queue.completionReviews.length && !error && <p className="empty-approval">No work is awaiting completion review.</p>}
      </section>
    </div>
    {proposalDecision && <ProposalDecisionForm order={proposalDecision} onClose={() => setProposalDecision(null)} onChanged={async () => { setProposalDecision(null); await load(); }} />}
    {completionDecision && <WorkflowActionForm order={completionDecision.order} currentUser={currentUser} initialAction={completionDecision.action} onClose={() => setCompletionDecision(null)} onChanged={async () => { setCompletionDecision(null); await load(); }} />}
  </section></div>;
}
