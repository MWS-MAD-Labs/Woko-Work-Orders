import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, Download, FileCheck2, FilterX, ShieldAlert, X } from 'lucide-react';
import { api } from './api';

type WorkType = '' | 'INTERNAL' | 'VENDOR';

interface ReportFilters {
  from: string;
  to: string;
  locationId: string;
  category: string;
  assigneeId: string;
  workType: WorkType;
}

interface BreakdownItem { key: string; label: string; count: number }
interface ReportRow {
  id: string;
  work_order_number: string;
  title: string;
  status: string;
  priority: string;
  condition: string;
  workflow_stage: string;
  due_date: string;
  completion_date: string | null;
  category: string;
  work_type: string;
  building_id: string;
  building: string;
  campus: string;
  room_or_area: string;
  assignee_id: string;
  assignee_name: string;
  created_at: string;
  updated_at: string;
}
interface ReportData {
  summary: {
    total: number;
    active: number;
    overdue: number;
    blocked: number;
    atRisk: number;
    dueThisWeek: number;
    dueThisMonth: number;
    proposalsAwaitingApproval: number;
    completionReviewsAwaitingApproval: number;
  };
  breakdowns: {
    assignee: BreakdownItem[];
    category: BreakdownItem[];
    location: BreakdownItem[];
    workType: BreakdownItem[];
    completedByAcademicYear: BreakdownItem[];
  };
  filters: {
    users: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string }>;
    categories: string[];
  };
  rows: ReportRow[];
}

const emptyFilters: ReportFilters = { from: '', to: '', locationId: '', category: '', assigneeId: '', workType: '' };

function queryString(filters: ReportFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const query = params.toString();
  return query ? `?${query}` : '';
}

function downloadCsv(rows: ReportRow[]) {
  const columns: Array<[keyof ReportRow, string]> = [
    ['work_order_number', 'Work order'], ['title', 'Title'], ['status', 'Status'], ['priority', 'Priority'],
    ['condition', 'Condition'], ['workflow_stage', 'Workflow stage'], ['due_date', 'Due date'],
    ['completion_date', 'Completion date'], ['category', 'Category'], ['work_type', 'Work type'],
    ['campus', 'Campus'], ['building', 'Building'], ['room_or_area', 'Room or area'], ['assignee_name', 'Assignee'],
  ];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [columns.map(([, label]) => escape(label)).join(','), ...rows.map((row) => columns.map(([key]) => escape(row[key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `woko-work-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function BarChart({ title, items, empty = 'No work orders match these filters.' }: { title: string; items: BreakdownItem[]; empty?: string }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return <section className="report-chart"><h3>{title}</h3>{items.length ? <div className="report-bars">{items.map((item) => <div className="report-bar-row" key={item.key}><div className="report-bar-label"><span title={item.label}>{item.label}</span><strong>{item.count}</strong></div><div className="report-bar-track"><span style={{ width: `${Math.max(5, item.count / max * 100)}%` }} /></div></div>)}</div> : <p className="report-empty">{empty}</p>}</section>;
}

export function ReportsView({ onClose }: { onClose: () => void }) {
  const [filters, setFilters] = useState<ReportFilters>(emptyFilters);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const filterQuery = useMemo(() => queryString(filters), [filters]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api<ReportData>(`/reports/work-orders${filterQuery}`)
        .then((loaded) => { if (active) setData(loaded); })
        .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load reports.'); })
        .finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filterQuery]);

  const setFilter = (key: keyof ReportFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const summary = data?.summary;

  return <div className="sheet-backdrop reports-backdrop"><section className="sheet reports-sheet" aria-modal="true" role="dialog" aria-labelledby="reports-title">
    <header className="sheet-header"><div><span>Filtered operational analytics</span><h2 id="reports-title">Reports</h2></div><button className="icon-button" onClick={onClose} aria-label="Close reports"><X /></button></header>
    <div className="sheet-content reports-content">
      <section className="report-filters" aria-label="Report filters">
        <label className="form-field"><span>From due date</span><input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} /></label>
        <label className="form-field"><span>To due date</span><input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} /></label>
        <label className="form-field"><span>Location</span><select value={filters.locationId} onChange={(event) => setFilter('locationId', event.target.value)}><option value="">All locations</option>{data?.filters.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Category</span><select value={filters.category} onChange={(event) => setFilter('category', event.target.value)}><option value="">All categories</option>{data?.filters.categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="form-field"><span>Assignee</span><select value={filters.assigneeId} onChange={(event) => setFilter('assigneeId', event.target.value)}><option value="">All assignees</option>{data?.filters.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Work type</span><select value={filters.workType} onChange={(event) => setFilter('workType', event.target.value)}><option value="">All work types</option><option value="INTERNAL">Internal</option><option value="VENDOR">Vendor</option></select></label>
        <button className="secondary-button report-reset" onClick={() => setFilters(emptyFilters)} disabled={!Object.values(filters).some(Boolean)}><FilterX /> Reset</button>
      </section>

      {error && <p className="form-error">{error}</p>}
      {loading && !data && <p className="report-loading">Loading report…</p>}
      {data && <>
        <div className="report-toolbar"><p><strong>{summary?.total ?? 0}</strong> work orders in the current filtered result set</p><button className="primary-button" onClick={() => downloadCsv(data.rows)} disabled={!data.rows.length}><Download /> Export CSV</button></div>
        <section className={`report-metrics ${loading ? 'is-refreshing' : ''}`} aria-label="Work-order metrics">
          <article><BriefcaseBusiness /><strong>{summary?.active}</strong><span>Active</span></article>
          <article><Clock3 /><strong>{summary?.overdue}</strong><span>Overdue</span></article>
          <article><ShieldAlert /><strong>{summary?.blocked}</strong><span>Blocked</span></article>
          <article><AlertTriangle /><strong>{summary?.atRisk}</strong><span>At Risk</span></article>
          <article><CalendarDays /><strong>{summary?.dueThisWeek}</strong><span>Due this week</span></article>
          <article><CalendarDays /><strong>{summary?.dueThisMonth}</strong><span>Due this month</span></article>
          <article className="approval-metric"><FileCheck2 /><strong>{summary?.proposalsAwaitingApproval}</strong><span>Proposals awaiting approval</span></article>
          <article className="approval-metric"><CheckCircle2 /><strong>{summary?.completionReviewsAwaitingApproval}</strong><span>Completion reviews awaiting approval</span></article>
        </section>
        <div className={`report-chart-grid ${loading ? 'is-refreshing' : ''}`}>
          <BarChart title="Work orders by assignee" items={data.breakdowns.assignee} />
          <BarChart title="Work orders by category" items={data.breakdowns.category} />
          <BarChart title="Work orders by location" items={data.breakdowns.location} />
          <BarChart title="Work orders by work type" items={data.breakdowns.workType} />
          <BarChart title="Completed work by academic year" items={data.breakdowns.completedByAcademicYear} empty="No completed work matches these filters." />
        </div>
      </>}
    </div>
  </section></div>;
}
