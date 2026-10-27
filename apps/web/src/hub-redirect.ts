// The API answers this when the request carries no usable Hub session. The app then goes to the Hub to restore it
// instead of showing a sign-in button.
export const HUB_SESSION_REQUIRED = 'HUB_SESSION_REQUIRED';

const KEY = 'woko-hub-redirect-at';
const WINDOW_MS = 10_000;

// True once per ten seconds. If the Hub brings the person back with no session (a loop), the second answer is false and
// the sign-in screen is shown instead.
export function claimHubRedirect(storage: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()): boolean {
  try {
    const last = Number(storage.getItem(KEY));
    if (Number.isFinite(last) && last > 0 && now - last < WINDOW_MS) return false;
    storage.setItem(KEY, String(now));
  } catch {
    // Storage blocked: the sign-in screen is the safe answer, a loop is not.
    return false;
  }
  return true;
}
