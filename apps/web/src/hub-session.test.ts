import { afterEach, describe, expect, it, vi } from 'vitest';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('an expired Hub token', () => {
  it('is renewed at the Hub and the request goes again once', async () => {
    const calls: string[] = [];
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/public-config')) return json(200, { data: { hub_refresh_url: 'https://hub.test/auth/refresh', hub_home_url: 'https://hub.test/' } });
      if (url === 'https://hub.test/auth/refresh') return json(200, {});
      if (first) { first = false; return json(401, { error: { code: 'HUB_SESSION_REQUIRED', message: 'Sign in through the Hub.' } }); }
      return json(200, { data: { ok: true } });
    }));
    const { api } = await import('./api');
    await expect(api('/work-orders')).resolves.toEqual({ ok: true });
    expect(calls.filter((url) => url.endsWith('/work-orders'))).toHaveLength(2);
    expect(calls).toContain('https://hub.test/auth/refresh');
  });

  it('is an error when the Hub will not renew it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/public-config')) return json(200, { data: { hub_refresh_url: 'https://hub.test/auth/refresh', hub_home_url: 'https://hub.test/' } });
      if (url === 'https://hub.test/auth/refresh') return json(401, {});
      return json(401, { error: { code: 'HUB_SESSION_REQUIRED', message: 'Sign in through the Hub.' } });
    }));
    const { api } = await import('./api');
    await expect(api('/work-orders')).rejects.toMatchObject({ status: 401, code: 'HUB_SESSION_REQUIRED' });
  });
});
