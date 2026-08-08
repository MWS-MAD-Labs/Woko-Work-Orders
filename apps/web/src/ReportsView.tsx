import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, Download, FileCheck2, FilterX, ShieldAlert, X } from 'lucide-react';
import { api } from './api';
import { storedLocale, type Locale } from './i18n';

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

const enumLabels: Record<Locale, Record<string, string>> = {
  en: {
    ACTIVE: 'Active', COMPLETED: 'Completed', CANCELLED: 'Cancelled', CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low',
    ON_TRACK: 'On track', AT_RISK: 'At Risk', BLOCKED: 'Blocked', PLANNED: 'Planned', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress',
    FINDING_VENDOR: 'Finding Vendor', PROPOSAL: 'Proposal', APPROVAL: 'Approval', REVIEW: 'Review', INTERNAL: 'Internal', VENDOR: 'Vendor', UNASSIGNED: 'Unassigned',
  },
  id: {
    ACTIVE: 'Aktif', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan', CRITICAL: 'Kritis', HIGH: 'Tinggi', NORMAL: 'Normal', LOW: 'Rendah',
    ON_TRACK: 'Sesuai rencana', AT_RISK: 'Berisiko', BLOCKED: 'Terhambat', PLANNED: 'Direncanakan', SCHEDULED: 'Terjadwal', IN_PROGRESS: 'Sedang dikerjakan',
    FINDING_VENDOR: 'Mencari vendor', PROPOSAL: 'Proposal', APPROVAL: 'Persetujuan', REVIEW: 'Tinjauan', INTERNAL: 'Internal', VENDOR: 'Vendor', UNASSIGNED: 'Belum ditugaskan',
  },
};


function enumLabel(value: string, locale: Locale) {
  return enumLabels[locale][value] ?? value.replaceAll('_', ' ');
}

function queryString(filters: ReportFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const query = params.toString();
  return query ? `?${query}` : '';
}

function csvDate(value: string | null, locale: Locale) {
  if (!value) return '';
  if (locale === 'en') return value;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function downloadCsv(rows: ReportRow[], locale: Locale) {
  const columns: Array<[keyof ReportRow, string, ((row: ReportRow) => string)?]> = locale === 'id' ? [
    ['work_order_number', 'Pekerjaan'], ['title', 'Judul'], ['status', 'Status', (row) => enumLabel(row.status, locale)], ['priority', 'Prioritas', (row) => enumLabel(row.priority, locale)],
    ['condition', 'Kondisi', (row) => enumLabel(row.condition, locale)], ['workflow_stage', 'Tahap alur kerja', (row) => enumLabel(row.workflow_stage, locale)], ['due_date', 'Tanggal tenggat', (row) => csvDate(row.due_date, locale)],
    ['completion_date', 'Tanggal penyelesaian', (row) => csvDate(row.completion_date, locale)], ['category', 'Kategori'], ['work_type', 'Jenis pekerjaan', (row) => enumLabel(row.work_type, locale)],
    ['campus', 'Kampus'], ['building', 'Gedung'], ['room_or_area', 'Ruangan atau area'], ['assignee_name', 'Penanggung jawab'],
  ] : [
    ['work_order_number', 'Work order'], ['title', 'Title'], ['status', 'Status', (row) => enumLabel(row.status, locale)], ['priority', 'Priority', (row) => enumLabel(row.priority, locale)],
    ['condition', 'Condition', (row) => enumLabel(row.condition, locale)], ['workflow_stage', 'Workflow stage', (row) => enumLabel(row.workflow_stage, locale)], ['due_date', 'Due date', (row) => csvDate(row.due_date, locale)],
    ['completion_date', 'Completion date', (row) => csvDate(row.completion_date, locale)], ['category', 'Category'], ['work_type', 'Work type', (row) => enumLabel(row.work_type, locale)],
    ['campus', 'Campus'], ['building', 'Building'], ['room_or_area', 'Room or area'], ['assignee_name', 'Assignee'],
  ];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [columns.map(([, label]) => escape(label)).join(','), ...rows.map((row) => columns.map(([key, , formatValue]) => escape(formatValue ? formatValue(row) : row[key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${locale === 'id' ? 'woko-pekerjaan' : 'woko-work-orders'}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function BarChart({ title, items, locale, enumValues = false, empty }: { title: string; items: BreakdownItem[]; locale: Locale; enumValues?: boolean; empty?: string }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  const emptyLabel = empty ?? (locale === 'id' ? 'Tidak ada pekerjaan yang sesuai dengan filter ini.' : 'No work orders match these filters.');
  return <section className="report-chart"><h3>{title}</h3>{items.length ? <div className="report-bars">{items.map((item) => {
    const label = enumValues ? enumLabel(item.key || item.label, locale) : item.label;
    return <div className="report-bar-row" key={item.key}><div className="report-bar-label"><span title={label}>{label}</span><strong>{item.count}</strong></div><div className="report-bar-track"><span style={{ width: `${Math.max(5, item.count / max * 100)}%` }} /></div></div>;
  })}</div> : <p className="report-empty">{emptyLabel}</p>}</section>;
}

export function ReportsView({ locale = storedLocale(), onClose }: { locale?: Locale; onClose: () => void }) {
  const [filters, setFilters] = useState<ReportFilters>(emptyFilters);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const filterQuery = useMemo(() => queryString(filters), [filters]);
  const isId = locale === 'id';

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api<ReportData>(`/reports/work-orders${filterQuery}`)
        .then((loaded) => { if (active) setData(loaded); })
        .catch((caught) => { if (active) setError(isId ? 'Laporan tidak dapat dimuat.' : caught instanceof Error ? caught.message : 'Could not load reports.'); })
        .finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filterQuery, locale]);

  const setFilter = (key: keyof ReportFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const summary = data?.summary;

  return <div className="sheet-backdrop reports-backdrop"><section className="sheet reports-sheet" aria-modal="true" role="dialog" aria-labelledby="reports-title">
    <header className="sheet-header"><div><span>{isId ? 'Analitik operasional terfilter' : 'Filtered operational analytics'}</span><h2 id="reports-title">{isId ? 'Laporan' : 'Reports'}</h2></div><button className="icon-button" onClick={onClose} aria-label={isId ? 'Tutup laporan' : 'Close reports'}><X /></button></header>
    <div className="sheet-content reports-content">
      <section className="report-filters" aria-label={isId ? 'Filter laporan' : 'Report filters'}>
        <label className="form-field"><span>{isId ? 'Dari tanggal tenggat' : 'From due date'}</span><input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} /></label>
        <label className="form-field"><span>{isId ? 'Sampai tanggal tenggat' : 'To due date'}</span><input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} /></label>
        <label className="form-field"><span>{isId ? 'Lokasi' : 'Location'}</span><select value={filters.locationId} onChange={(event) => setFilter('locationId', event.target.value)}><option value="">{isId ? 'Semua lokasi' : 'All locations'}</option>{data?.filters.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>{isId ? 'Kategori' : 'Category'}</span><select value={filters.category} onChange={(event) => setFilter('category', event.target.value)}><option value="">{isId ? 'Semua kategori' : 'All categories'}</option>{data?.filters.categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="form-field"><span>{isId ? 'Penanggung jawab' : 'Assignee'}</span><select value={filters.assigneeId} onChange={(event) => setFilter('assigneeId', event.target.value)}><option value="">{isId ? 'Semua penanggung jawab' : 'All assignees'}</option>{data?.filters.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>{isId ? 'Jenis pekerjaan' : 'Work type'}</span><select value={filters.workType} onChange={(event) => setFilter('workType', event.target.value)}><option value="">{isId ? 'Semua jenis pekerjaan' : 'All work types'}</option><option value="INTERNAL">{enumLabel('INTERNAL', locale)}</option><option value="VENDOR">{enumLabel('VENDOR', locale)}</option></select></label>
        <button className="secondary-button report-reset" onClick={() => setFilters(emptyFilters)} disabled={!Object.values(filters).some(Boolean)}><FilterX /> {isId ? 'Atur ulang' : 'Reset'}</button>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && !data && <p className="report-loading">{isId ? 'Memuat laporan…' : 'Loading report…'}</p>}
      {data && <>
        <div className="report-toolbar"><p><strong>{summary?.total ?? 0}</strong> {isId ? 'pekerjaan dalam hasil filter saat ini' : 'work orders in the current filtered result set'}</p><button className="primary-button" onClick={() => downloadCsv(data.rows, locale)} disabled={!data.rows.length}><Download /> {isId ? 'Ekspor CSV' : 'Export CSV'}</button></div>
        <section className={`report-metrics ${loading ? 'is-refreshing' : ''}`} aria-label={isId ? 'Metrik pekerjaan' : 'Work-order metrics'}>
          <article><BriefcaseBusiness /><strong>{summary?.active}</strong><span>{isId ? 'Aktif' : 'Active'}</span></article>
          <article><Clock3 /><strong>{summary?.overdue}</strong><span>{isId ? 'Terlambat' : 'Overdue'}</span></article>
          <article><ShieldAlert /><strong>{summary?.blocked}</strong><span>{isId ? 'Terhambat' : 'Blocked'}</span></article>
          <article><AlertTriangle /><strong>{summary?.atRisk}</strong><span>{isId ? 'Berisiko' : 'At Risk'}</span></article>
          <article><CalendarDays /><strong>{summary?.dueThisWeek}</strong><span>{isId ? 'Jatuh tempo minggu ini' : 'Due this week'}</span></article>
          <article><CalendarDays /><strong>{summary?.dueThisMonth}</strong><span>{isId ? 'Jatuh tempo bulan ini' : 'Due this month'}</span></article>
          <article className="approval-metric"><FileCheck2 /><strong>{summary?.proposalsAwaitingApproval}</strong><span>{isId ? 'Proposal menunggu persetujuan' : 'Proposals awaiting approval'}</span></article>
          <article className="approval-metric"><CheckCircle2 /><strong>{summary?.completionReviewsAwaitingApproval}</strong><span>{isId ? 'Tinjauan penyelesaian menunggu persetujuan' : 'Completion reviews awaiting approval'}</span></article>
        </section>
        <div className={`report-chart-grid ${loading ? 'is-refreshing' : ''}`}>
          <BarChart title={isId ? 'Pekerjaan menurut penanggung jawab' : 'Work orders by assignee'} items={data.breakdowns.assignee} locale={locale} />
          <BarChart title={isId ? 'Pekerjaan menurut kategori' : 'Work orders by category'} items={data.breakdowns.category} locale={locale} />
          <BarChart title={isId ? 'Pekerjaan menurut lokasi' : 'Work orders by location'} items={data.breakdowns.location} locale={locale} />
          <BarChart title={isId ? 'Pekerjaan menurut jenis' : 'Work orders by work type'} items={data.breakdowns.workType} locale={locale} enumValues />
          <BarChart title={isId ? 'Pekerjaan selesai menurut tahun akademik' : 'Completed work by academic year'} items={data.breakdowns.completedByAcademicYear} locale={locale} empty={isId ? 'Tidak ada pekerjaan selesai yang sesuai dengan filter ini.' : 'No completed work matches these filters.'} />
        </div>
      </>}
    </div>
  </section></div>;
}
