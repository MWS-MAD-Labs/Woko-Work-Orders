import { describe, expect, it } from 'vitest';
import { aggregateReport } from './reports.js';

const base = {
  id: '1', work_order_number: 'FAC-2026-0001', title: 'Repair AC', status: 'ACTIVE' as const,
  priority: 'HIGH', condition: 'ON_TRACK' as const, workflow_stage: 'IN_PROGRESS', due_date: '2026-07-20',
  completion_date: null, category: 'HVAC', work_type: 'INTERNAL' as const, building_id: 'building-1',
  building: 'Main', campus: 'MWS', room_or_area: '101', assignee_id: 'user-1', assignee_name: 'Ari',
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', is_overdue: false,
  is_due_this_week: true, is_due_this_month: true,
};

describe('report aggregation', () => {
  it('calculates workflow metrics and filtered breakdowns', () => {
    const report = aggregateReport([
      base,
      { ...base, id: '2', work_order_number: 'FAC-2026-0002', work_type: 'VENDOR', workflow_stage: 'APPROVAL', condition: 'AT_RISK', is_due_this_week: false },
      { ...base, id: '3', work_order_number: 'FAC-2026-0003', workflow_stage: 'REVIEW', condition: 'BLOCKED', is_overdue: true },
      { ...base, id: '4', work_order_number: 'FAC-2026-0004', status: 'COMPLETED', workflow_stage: 'COMPLETED', completion_date: '2026-07-15', is_due_this_week: false, is_due_this_month: false },
    ], [{ label: '2026/2027', start_date: '2026-07-01', end_date: '2027-06-30' }]);

    expect(report.summary).toMatchObject({ active: 3, overdue: 1, blocked: 1, atRisk: 1, dueThisWeek: 2, dueThisMonth: 3, proposalsAwaitingApproval: 1, completionReviewsAwaitingApproval: 1 });
    expect(report.breakdowns.assignee).toEqual([{ key: 'user-1', label: 'Ari', count: 4 }]);
    expect(report.breakdowns.completedByAcademicYear).toEqual([{ key: '2026/2027', label: '2026/2027', count: 1 }]);
  });
});
