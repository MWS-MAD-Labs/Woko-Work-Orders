import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateWorkListNotifications, localDateInTimeZone, localTimeInTimeZone, notificationPushBody, notificationTargetUrl, reminderType, shouldGenerateDailyWorkListReminder } from './background.js';

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn<(strings: TemplateStringsArray, ...parameters: unknown[]) => Promise<unknown[]>>(),
}));
vi.mock('./database/client.js', () => ({ sql: sqlMock }));
vi.mock('./config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./config.js')>();
  return { ...original, config: { ...original.config, APP_TIME_ZONE: 'Asia/Jakarta' } };
});

afterEach(() => {
  vi.resetAllMocks();

});

describe('notification reminder scheduling', () => {
  it('groups missed digests by the selected local date without repeating timezone parameters', async () => {

    sqlMock.mockResolvedValue([]);
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { due_date: '2026-09-27', count: 2, examples: ['Daily checks · Office'] },
    ]);

    await generateWorkListNotifications('2026-09-28', new Date('2026-09-28T00:00:00Z'));

    expect(sqlMock).toHaveBeenCalledTimes(3);
    const [strings, ...parameters] = sqlMock.mock.calls[1]!;
    const query = strings.join('?').replace(/\s+/g, ' ').trim();
    expect(query).toContain('select (due_at at time zone ?)::date::text as due_date');
    expect(query).toContain('group by due_date order by due_date');
    expect(parameters).toEqual(['Asia/Jakarta', '2026-09-28', 'Asia/Jakarta', '2026-09-28', 'Asia/Jakarta']);
    expect(sqlMock.mock.calls[2]).toContain('Missed Routine Work · 2026-09-27');
    expect(sqlMock.mock.calls[2]).toContain('work-list-missed-digest:2026-09-27:');
  });

  it('uses the Asia/Jakarta calendar date', () => {
    expect(localDateInTimeZone(new Date('2026-07-17T17:30:00Z'), 'Asia/Jakarta')).toBe('2026-07-18');
  });

  it('uses local clock time for scheduled Routine Work digests', () => {
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

  it('deep-links Routine Work reminders to the Routine Work view', () => {
    expect(notificationTargetUrl('WORK_LIST_DAILY_REMINDER', null)).toBe('/?view=work-lists');
    expect(notificationTargetUrl('ASSIGNMENT', '99999999-9999-4999-8999-999999999999')).toBe('/?workOrder=99999999-9999-4999-8999-999999999999');
    expect(notificationTargetUrl('WORK_LIST_MISSED_DIGEST', null)).toBeUndefined();
  });

  it('catches up the daily Routine Work reminder after the 15:30 slot', () => {
    expect(shouldGenerateDailyWorkListReminder(new Date('2026-08-07T08:29:00Z'), 'Asia/Jakarta')).toBe(false);
    expect(shouldGenerateDailyWorkListReminder(new Date('2026-08-07T08:30:00Z'), 'Asia/Jakarta')).toBe(true);
    expect(shouldGenerateDailyWorkListReminder(new Date('2026-08-07T11:00:00Z'), 'Asia/Jakarta')).toBe(true);
  });

  it('keeps operational Routine Work details out of push previews', () => {
    expect(notificationPushBody('WORK_LIST_DAILY_REMINDER', 'Daily checks · Server room')).toBe('You have unfinished Routine Work.');
    expect(notificationPushBody('ASSIGNMENT', 'Repair classroom door')).toBe('Repair classroom door');
  });
});
