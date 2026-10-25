import { describe, expect, it } from 'vitest';
import { bookingWindowEnd, validateBookingTimes } from './facilities-requests.js';

describe('facilities booking window', () => {
  it('clamps a two-calendar-month limit to the last day of a shorter month', () => {
    expect(bookingWindowEnd(new Date('2026-12-31T12:00:00Z'))).toBe('2027-02-28');
  });

  it('rejects a request whose end is after the permitted two-calendar-month window', () => {
    expect(validateBookingTimes({
      startsAt: '2026-01-31T09:00:00+07:00',
      endsAt: '2026-04-01T10:00:00+07:00',
      now: new Date('2026-01-31T00:00:00Z'),
    })).toEqual({ ok: false, code: 'BOOKING_WINDOW_EXCEEDED' });
  });

  it('requires an end after a future start', () => {
    expect(validateBookingTimes({
      startsAt: '2026-02-01T10:00:00+07:00',
      endsAt: '2026-02-01T09:00:00+07:00',
      now: new Date('2026-01-31T00:00:00Z'),
    })).toEqual({ ok: false, code: 'INVALID_BOOKING_TIME' });
  });
});
