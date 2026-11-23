import { keepFresh } from 'mws-central-auth/client';
import type { CurrentUser } from './types';

export function startHubSessionRefresh(user: Pick<CurrentUser, 'hubRefreshUrl' | 'sessionExpiresAt'>): () => void {
  if (!user.hubRefreshUrl) return () => {};
  return keepFresh({
    refreshUrl: user.hubRefreshUrl,
    initialExpiresIn: (Date.parse(user.sessionExpiresAt) - Date.now()) / 1000,
    // Keep the current page and any drafts open. A decision that gets a 401
    // offers sign-in without replaying the write.
    onEnded: () => {},
  });
}
