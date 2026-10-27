import { createAccessResolver, type AccessResolver, type AccessResult } from 'mws-central-auth/access';
import { CentralDataClient } from 'mws-central-auth/data-client';
import { createHubSession, type HubSessionClaims } from 'mws-central-auth/server';
import { isPermission, permissions, type Permission } from '@woko/domain';
import { config } from './config.js';
import { sql } from './database/client.js';

// Signing in through the Hub (AUTH_MODE=hub): the Hub's shared-session cookie says who the person is, and Central's
// entitlement says what they may do in Woko (Access Standard AS-10, AS-11). The rest of Woko only sees a user with
// permissions, as before.

export interface LocalHubUser {
  id: string;
  email: string;
  fullName: string;
  profilePhotoUrl?: string;
  preferredLocale: 'id' | 'en';
}

export interface HubAccess {
  claims(cookieHeader: string | undefined): Promise<Pick<HubSessionClaims, 'sub' | 'email' | 'exp'> | null>;
  resolve(personId: string): Promise<AccessResult>;
  homeUrl(): string;
  restoreUrl(returnUrl: string): string;
}

export function createHubAccess(): HubAccess {
  const session = createHubSession({ hubBaseUrl: config.HUB_BASE_URL!, ...(config.HUB_ACCESS_COOKIE_NAME ? { cookieName: config.HUB_ACCESS_COOKIE_NAME } : {}) });
  const central = new CentralDataClient({
    baseUrl: config.CENTRAL_API_BASE_URL!.replace(/\/+$/, '').replace(/\/api\/internal$/, ''),
    token: config.CENTRAL_API_TOKEN!,
    organizationId: config.CENTRAL_ORGANIZATION_ID,
  });
  const resolver: AccessResolver = createAccessResolver({
    application: config.CENTRAL_APPLICATION_ID,
    permissions,
    organizationId: config.CENTRAL_ORGANIZATION_ID,
    lookup: (personId) => central.lookupApplicationEntitlement({ person_id: personId, application_id: config.CENTRAL_APPLICATION_ID }),
  });
  return {
    claims: (header) => session.fromCookieHeader(header),
    resolve: (personId) => resolver.resolve(personId),
    homeUrl: () => session.homeUrl(),
    restoreUrl: (returnUrl) => session.restoreUrl(returnUrl),
  };
}

let current: HubAccess | undefined;
export function hubAccess(): HubAccess {
  current ??= createHubAccess();
  return current;
}
// For tests: a Hub and a Central that answer from memory.
export function useHubAccess(replacement: HubAccess | undefined) {
  current = replacement;
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ') || email;
}

type Database = typeof sql;

export class AccountConflictError extends Error {
  constructor(email: string) {
    super(`${email} is already linked to another person in Central.`);
    this.name = 'AccountConflictError';
  }
}

// Finds the local user for a person of the Hub, makes one the first time (Central does not give a name at sign-in; the
// entitlement sync fills it in), and keeps the stored permissions the same as the entitlement's. Those stored rows are
// a copy for the places that need other people's permissions (pick lists, who gets a notification).
export async function provisionHubUser(
  person: { personId: string; email: string },
  granted: readonly string[],
  db: Database = sql,
): Promise<LocalHubUser> {
  const email = person.email.trim().toLowerCase();
  const known = [...new Set(granted)].filter(isPermission).sort();
  return db.begin(async (transaction) => {
    const byPerson = await transaction<Array<{ id: string }>>`select id from users where central_person_id = ${person.personId} for update`;
    let id = byPerson[0]?.id;
    if (!id) {
      const byEmail = await transaction<Array<{ id: string; central_person_id: string | null }>>`select id, central_person_id from users where email = ${email} for update`;
      const found = byEmail[0];
      if (found && found.central_person_id && found.central_person_id !== person.personId) throw new AccountConflictError(email);
      if (found) {
        id = found.id;
        await transaction`update users set central_person_id = ${person.personId}, active = true, updated_at = now() where id = ${id}`;
      } else {
        const created = await transaction<Array<{ id: string }>>`
          insert into users (central_person_id, email, full_name, active) values (${person.personId}, ${email}, ${nameFromEmail(email)}, true)
          returning id
        `;
        id = created[0]!.id;
      }
    }
    await transaction`update users set active = true, last_login_at = now(), updated_at = now() where id = ${id} and (not active or last_login_at is null or last_login_at < now() - interval '1 minute')`;
    const stored = (await transaction<Array<{ permission: string }>>`select permission from user_permissions where user_id = ${id}`).map((row) => row.permission).sort();
    if (stored.join('\n') !== known.join('\n')) {
      await transaction`delete from user_permissions where user_id = ${id}`;
      if (known.length) await transaction`insert into user_permissions (user_id, permission) select ${id}, unnest(${known as Permission[]}::text[])`;
    }
    const rows = await transaction<Array<{ email: string; full_name: string; profile_photo_url: string | null; preferred_locale: 'id' | 'en' }>>`
      select email::text, full_name, profile_photo_url, preferred_locale from users where id = ${id}
    `;
    const user = rows[0]!;
    return { id: id!, email: user.email, fullName: user.full_name, profilePhotoUrl: user.profile_photo_url ?? undefined, preferredLocale: user.preferred_locale };
  }) as Promise<LocalHubUser>;
}
