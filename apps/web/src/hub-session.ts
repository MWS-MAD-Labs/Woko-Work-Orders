import { keepFresh } from 'mws-central-auth/client';
import { apiUrl } from './api-base';

// The Hub's access token lives only a few minutes. While the page is open it is renewed at the Hub (keepFresh), and a
// request that still finds it expired renews it once and goes again, so the person never sees "Sign in through the Hub".

interface HubUrls { refresh: string; home: string }

let urls: Promise<HubUrls | null> | undefined;
export function hubUrls(): Promise<HubUrls | null> {
  urls ??= fetch(`${apiUrl}/public-config`, { credentials: 'include' })
    .then((response) => response.json())
    .then((body: { data?: { hub_refresh_url?: string | null; hub_home_url?: string | null } }) =>
      body.data?.hub_refresh_url && body.data.hub_home_url ? { refresh: body.data.hub_refresh_url, home: body.data.hub_home_url } : null)
    .catch(() => { urls = undefined; return null; });
  return urls;
}

let renewing: Promise<boolean> | undefined;
// True when the Hub gave a new token. Callers that arrive while one renewal runs share it.
export function renewHubSession(): Promise<boolean> {
  renewing ??= (async () => {
    const hub = await hubUrls();
    if (!hub) return false;
    try {
      const response = await fetch(hub.refresh, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'mws' } });
      return response.ok;
    } catch {
      return false;
    }
  })().finally(() => { renewing = undefined; });
  return renewing;
}

// Keeps the token fresh while the page is open. Returns the stop function.
export function keepHubSessionFresh(): () => void {
  let stop = () => {};
  let cancelled = false;
  void hubUrls().then((hub) => {
    if (!hub || cancelled) return;
    stop = keepFresh({ refreshUrl: hub.refresh, onEnded: () => window.location.replace(hub.home) });
  });
  return () => { cancelled = true; stop(); };
}
