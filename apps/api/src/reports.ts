import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireManager } from './auth.js';
import { sql } from './database/client.js';

const reportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  locationId: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(200).optional(),
  assigneeId: z.string().uuid().optional(),
  workType: z.enum(['INTERNAL', 'VENDOR']).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: 'The start date must be on or before the end date.',
  path: ['to'],
});

interface ReportRow {
  id: string;
  work_order_number: string;
  title: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  priority: string;
  condition: 'ON_TRACK' | 'AT_RISK' | 'BLOCKED';
  workflow_stage: string;
  due_date: string;
  completion_date: string | null;
  category: string;
  work_type: 'INTERNAL' | 'VENDOR';
  building_id: string;
  building: string;
  campus: string;
  room_or_area: string;
  assignee_id: string;
  assignee_name: string;
  created_at: string;
  updated_at: string;
  is_overdue: boolean;
  is_due_this_week: boolean;
  is_due_this_month: boolean;
}

interface AcademicYear {
  label: string;
  start_date: string;
  end_date: string;
}

interface BreakdownItem {
  key: string;
  label: string;
  count: number;
}

function increment(map: Map<string, BreakdownItem>, key: string, label: string) {
  const current = map.get(key);
  if (current) current.count += 1;
  else map.set(key, { key, label, count: 1 });
}

function sortedBreakdown(map: Map<string, BreakdownItem>): BreakdownItem[] {
  return [...map.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function aggregateReport(rows: ReportRow[], academicYears: AcademicYear[]) {
  const byAssignee = new Map<string, BreakdownItem>();
  const byCategory = new Map<string, BreakdownItem>();
  const byLocation = new Map<string, BreakdownItem>();
  const byWorkType = new Map<string, BreakdownItem>();
  const completedByAcademicYear = new Map<string, BreakdownItem>();

  for (const row of rows) {
    increment(byAssignee, row.assignee_id, row.assignee_name);
    increment(byCategory, row.category, row.category);
    increment(byLocation, row.building_id, `${row.campus} · ${row.building}`);
    increment(byWorkType, row.work_type, row.work_type === 'INTERNAL' ? 'Internal' : 'Vendor');

    if (row.status === 'COMPLETED' && row.completion_date) {
      const period = academicYears.find((year) => row.completion_date! >= year.start_date && row.completion_date! <= year.end_date);
      const label = period?.label ?? 'Outside configured academic years';
      increment(completedByAcademicYear, label, label);
    }
  }

  return {
    summary: {
      total: rows.length,
      active: rows.filter((row) => row.status === 'ACTIVE').length,
      overdue: rows.filter((row) => row.is_overdue).length,
      blocked: rows.filter((row) => row.status === 'ACTIVE' && row.condition === 'BLOCKED').length,
      atRisk: rows.filter((row) => row.status === 'ACTIVE' && row.condition === 'AT_RISK').length,
      dueThisWeek: rows.filter((row) => row.is_due_this_week).length,
      dueThisMonth: rows.filter((row) => row.is_due_this_month).length,
      proposalsAwaitingApproval: rows.filter((row) => row.status === 'ACTIVE' && row.work_type === 'VENDOR' && row.workflow_stage === 'APPROVAL').length,
      completionReviewsAwaitingApproval: rows.filter((row) => row.status === 'ACTIVE' && row.workflow_stage === 'REVIEW').length,
    },
    breakdowns: {
      assignee: sortedBreakdown(byAssignee),
      category: sortedBreakdown(byCategory),
      location: sortedBreakdown(byLocation),
      workType: sortedBreakdown(byWorkType),
      completedByAcademicYear: sortedBreakdown(completedByAcademicYear),
    },
  };
}

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/reports/work-orders', { preHandler: requireManager }, async (request) => {
    const query = reportQuerySchema.parse(request.query);
    const [rows, academicYears, users, buildings, categories] = await Promise.all([
      sql<ReportRow[]>`
        select wo.id, wo.work_order_number, wo.title, wo.status, wo.priority, wo.condition,
          wo.workflow_stage, wo.due_date::text, wo.completion_date::text, wo.category, wo.work_type,
          b.id as building_id, b.name as building, c.name as campus, wo.room_or_area,
          assignee.id as assignee_id, assignee.full_name as assignee_name,
          wo.created_at::text, wo.updated_at::text,
          (wo.status = 'ACTIVE' and wo.due_date < current_date) as is_overdue,
          (wo.status = 'ACTIVE' and wo.due_date >= date_trunc('week', current_date)::date
            and wo.due_date < (date_trunc('week', current_date) + interval '7 days')::date) as is_due_this_week,
          (wo.status = 'ACTIVE' and wo.due_date >= date_trunc('month', current_date)::date
            and wo.due_date < (date_trunc('month', current_date) + interval '1 month')::date) as is_due_this_month
        from work_orders wo
        join buildings b on b.id = wo.building_id
        join campuses c on c.id = wo.campus_id
        join users assignee on assignee.id = wo.primary_assignee_id
        where true
          ${query.from ? sql`and wo.due_date >= ${query.from}` : sql``}
          ${query.to ? sql`and wo.due_date <= ${query.to}` : sql``}
          ${query.locationId ? sql`and wo.building_id = ${query.locationId}` : sql``}
          ${query.category ? sql`and wo.category = ${query.category}` : sql``}
          ${query.assigneeId ? sql`and exists (select 1 from work_order_assignees wa where wa.work_order_id = wo.id and wa.user_id = ${query.assigneeId})` : sql``}
          ${query.workType ? sql`and wo.work_type = ${query.workType}` : sql``}
        order by wo.due_date, wo.work_order_number
      `,
      sql<AcademicYear[]>`
        select academic_year_label as label, start_date::text, end_date::text
        from academic_periods where type = 'ACADEMIC_YEAR'
        order by start_date
      `,
      sql<Array<{ id: string; name: string }>>`select id, full_name as name from users where active = true order by full_name`,
      sql<Array<{ id: string; name: string }>>`
        select b.id, c.name || ' · ' || b.name as name
        from buildings b join campuses c on c.id = b.campus_id
        where b.active = true and c.active = true order by c.name, b.name
      `,
      sql<Array<{ name: string }>>`select distinct category as name from work_orders order by category`,
    ]);

    return {
      data: {
        ...aggregateReport(rows, academicYears),
        filters: { users, locations: buildings, categories: categories.map((item) => item.name) },
        rows: rows.map(({ is_overdue: _overdue, is_due_this_week: _week, is_due_this_month: _month, ...row }) => row),
      },
    };
  });
}
