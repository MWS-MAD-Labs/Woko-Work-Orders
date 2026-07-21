import { describe, expect, it } from 'vitest';
import { localDateInTimeZone, reminderType } from './background.js';

describe('notification reminder scheduling', () => {
  it('uses the Asia/Jakarta calendar date', () => {
    expect(localDateInTimeZone(new Date('2026-07-17T17:30:00Z'), 'Asia/Jakarta')).toBe('2026-07-18');
  });

  it('generates fixed due-date reminders', () => {
    expect(reminderType(7, 'NORMAL')).toBe('DUE_IN_SEVEN_DAYS');
    expect(reminderType(2, 'NORMAL')).toBe('DUE_IN_TWO_DAYS');
    expect(reminderType(0, 'NORMAL')).toBe('DUE_TODAY');
    expect(reminderType(-1, 'NORMAL')).toBe('FIRST_DAY_OVERDUE');
  });

  it('reminds critical overdue work daily and standard work every three days', () => {
    expect(reminderType(-2, 'CRITICAL')).toBe('CRITICAL_OVERDUE_REMINDER');
    expect(reminderType(-4, 'HIGH')).toBe('OVERDUE_REMINDER');
    expect(reminderType(-2, 'HIGH')).toBeUndefined();
    expect(reminderType(-7, 'NORMAL')).toBe('OVERDUE_REMINDER');
  });
});
