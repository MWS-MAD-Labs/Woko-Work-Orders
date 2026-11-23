import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHubSessionRefresh } from './hub-session';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Woko Hub session refresh', () => {
  it('refreshes before the current cookie expires, then schedules from the Hub response', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => Response.json({ data: { expires_in: 300 } }));
    vi.stubGlobal('fetch', fetch);
    const stop = startHubSessionRefresh({
      hubRefreshUrl: 'https://hub.example.test/auth/refresh',
      sessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    try {
      await vi.advanceTimersByTimeAsync(59_000);
      expect(fetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetch).toHaveBeenCalledExactlyOnceWith('https://hub.example.test/auth/refresh', expect.objectContaining({
        method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'mws' },
      }));
      await vi.advanceTimersByTimeAsync(244_000);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { stop(); }
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not contact a Hub when refresh is not configured', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    startHubSessionRefresh({ sessionExpiresAt: new Date(Date.now() + 60_000).toISOString() })();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetch).not.toHaveBeenCalled();
  });
});
