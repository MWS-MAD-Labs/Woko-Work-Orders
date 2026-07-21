import { addMonths, endOfMonth, endOfWeek, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import type { WorkOrderStatus } from './types.js';

export type DeadlineGroup =
  | 'OVERDUE'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'NEXT_MONTH'
  | 'THIS_SEMESTER'
  | 'THIS_ACADEMIC_YEAR'
  | 'FUTURE'
  | 'ARCHIVE';

interface DeadlineInput {
  dueDate: string;
  status: WorkOrderStatus;
  today: Date;
  semesterEnd?: string;
  academicYearEnd?: string;
}

export function getDeadlineGroup(input: DeadlineInput): DeadlineGroup {
  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') return 'ARCHIVE';

  const today = startOfDay(input.today);
  const due = startOfDay(parseISO(input.dueDate));
  if (isBefore(due, today)) return 'OVERDUE';

  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  if (!isAfter(due, weekEnd)) return 'THIS_WEEK';

  const monthEnd = endOfMonth(today);
  if (!isAfter(due, monthEnd)) return 'THIS_MONTH';

  const nextMonthEnd = endOfMonth(addMonths(today, 1));
  if (!isAfter(due, nextMonthEnd)) return 'NEXT_MONTH';

  if (input.semesterEnd && !isAfter(due, startOfDay(parseISO(input.semesterEnd)))) return 'THIS_SEMESTER';
  if (input.academicYearEnd && !isAfter(due, startOfDay(parseISO(input.academicYearEnd)))) return 'THIS_ACADEMIC_YEAR';
  return 'FUTURE';
}

export function isOverdue(dueDate: string, status: WorkOrderStatus, today: Date): boolean {
  return getDeadlineGroup({ dueDate, status, today }) === 'OVERDUE';
}
