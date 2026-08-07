import { describe, expect, it } from 'vitest';
import { localDateInTimeZone, localTimeInTimeZone, notificationPushBody, notificationTargetUrl, reminderType, shouldGenerateDailyWorkListReminder } from './background.js';

describe('notification reminder scheduling', () => {
  it('uses the Asia/Jakarta calendar date', () => {
    expect(localDateInTimeZone(new Date('2026-07-17T17:30:00Z'), 'Asia/Jakarta')).toBe('2026-07-18');
  });

  it('uses local clock time for scheduled Work List digests', () => {
    expect(localTimeInTimeZone(new Date('2026-07-18T08:30:00Z'), 'Asia/Jakarta')).toEqual({ hour: 15, minute: 30 });
    expect(localTimeInTimeZone(new Date('2026-07-18T00:00:00Z'), 'Asia/Jakarta')).toEqual({ hour: 7, minute: 0 });
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

  it('deep-links Work List reminders to the Work Lists view', () => {
    expect(notificationTargetUrl('WORK_LIST_DAILY_REMINDER', null)).toBe('/?view=work-lists');
    expect(notificationTargetUrl('ASSIGNMENT', '99999999-9999-4999-8999-999999999999')).toBe('/?workOrder=99999999-9999-4999-8999-999999999999');
    expect(notificationTargetUrl('WORK_LIST_MISSED_DIGEST', null)).toBeUndefined();
  });

  it('catches up the daily Work List reminder after the 15:30 slot', () => {
    expect(shouldGenerateDailyWorkListReminder(new Date('2026-08-07T08:29:00Z'), 'Asia/Jakarta')).toBe(false);
    expect(shouldGenerateDailyWorkListReminder(new Date('2026-08-07T08:30:00Z'), 'Asia/Jakarta')).toBe(true);
    expect(shouldGenerateDailyWorkListReminder(new Date('2026-08-07T11:00:00Z'), 'Asia/Jakarta')).toBe(true);
  });

  it('keeps operational Work List details out of push previews', () => {
    expect(notificationPushBody('WORK_LIST_DAILY_REMINDER', 'Daily checks · Server room')).toBe('You have unfinished Work Lists.');
    expect(notificationPushBody('ASSIGNMENT', 'Repair classroom door')).toBe('Repair classroom door');
  });
});
