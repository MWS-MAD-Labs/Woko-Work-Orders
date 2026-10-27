import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccessResult } from 'mws-central-auth/access';
import { buildApp } from './app.js';
import { sql } from './database/client.js';
import { syncEntitlements, type EntitlementRow } from './entitlement-sync.js';
import { useHubAccess, type HubAccess } from './hub-access.js';
import { permissionBundles } from '@woko/domain';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/woko_facilities_test') {
  throw new Error('The Hub integration tests need DATABASE_URL for the dedicated woko_facilities_test database.');
}
if (process.env.AUTH_MODE !== 'hub') throw new Error('These tests run with AUTH_MODE=hub (npm run test:integration does that).');

// A Hub and a Central that answer from memory. The cookie is "hub_at=<person id>|<email>".
const entitlements = new Map<string, AccessResult>();
let central: 'up' | 'down' = 'up';
const fakeHub: HubAccess = {
  claims: async (header) => {
    const match = /hub_at=([^;]+)/.exec(header ?? '');
    if (!match) return null;
    const [sub, email] = decodeURIComponent(match[1]!).split('|');
    return { sub: sub!, email: email!, exp: Math.floor(Date.now() / 1000) + 600 };
  },
  resolve: async (personId) => (central === 'down' ? { status: 'unavailable', personId, error: new Error('down') } : (entitlements.get(personId) ?? { status: 'denied', personId, reason: 'no-access' })),
  homeUrl: () => 'https://hub.example.org/',
  restoreUrl: (returnUrl) => `https://hub.example.org/auth/restore?return=${encodeURIComponent(returnUrl)}`,
};

const allowed = (personId: string, permissions: readonly string[] = permissionBundles.worker): AccessResult => ({
  status: 'allowed', personId, role: 'WORKER', permissions: [...permissions], ignored: [], entitlementId: `e-${personId}`, version: 1,
});
const as = (personId: string, email: string) => ({ cookie: `hub_at=${encodeURIComponent(`${personId}|${email}`)}`, origin: 'http://localhost:5173' });
const app = await buildApp({ logger: false });
useHubAccess(fakeHub);

beforeEach(async () => {
  entitlements.clear();
  central = 'up';
  await sql`delete from users where email like 'hubtest-%@millennia21.id'`;
});
afterAll(async () => {
  await sql`delete from users where email like 'hubtest-%@millennia21.id'`;
  await app.close();
  await sql.end();
});

const storedPermissions = async (email: string) =>
  (await sql<Array<{ permission: string }>>`select up.permission from user_permissions up join users u on u.id = up.user_id where u.email = ${email} order by 1`).map((row) => row.permission);

describe('signing in through the Hub', () => {
  it('turns away a request without the Hub cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
  });

  it('makes the user the first time, with the permissions of the entitlement and no role', async () => {
    entitlements.set('person-a', allowed('person-a'));
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: as('person-a', 'hubtest-ayu.putri@millennia21.id') });
    expect(response.statusCode).toBe(200);
    const me = response.json().data;
    expect(me).toMatchObject({ email: 'hubtest-ayu.putri@millennia21.id', fullName: 'Hubtest Ayu Putri', authMode: 'hub' });
    expect(me.permissions).toEqual(expect.arrayContaining([...permissionBundles.worker]));
    expect(me.roles).toBeUndefined();
    const stored = await sql`select central_person_id, active from users where email = 'hubtest-ayu.putri@millennia21.id'`;
    expect(stored[0]).toMatchObject({ central_person_id: 'person-a', active: true });
    expect(await storedPermissions('hubtest-ayu.putri@millennia21.id')).toEqual([...permissionBundles.worker].sort());
  });

  it('links an existing local user by email once, and the entitlement replaces what they had', async () => {
    await sql`insert into users (google_subject_id, email, full_name, active) values ('g-old', 'hubtest-old@millennia21.id', 'Old Name', true)`;
    await sql`insert into user_permissions (user_id, permission) select id, unnest(array['woko.use', 'users.read', 'users.manage']) from users where email = 'hubtest-old@millennia21.id'`;
    entitlements.set('person-old', allowed('person-old'));
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: as('person-old', 'hubtest-old@millennia21.id') });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.fullName).toBe('Old Name');
    expect((await sql`select central_person_id from users where email = 'hubtest-old@millennia21.id'`)[0]!.central_person_id).toBe('person-old');
    expect(await storedPermissions('hubtest-old@millennia21.id')).toEqual([...permissionBundles.worker].sort());
  });

  it('refuses a person already linked to someone else', async () => {
    await sql`insert into users (central_person_id, email, full_name, active) values ('person-other', 'hubtest-clash@millennia21.id', 'Clash', true)`;
    entitlements.set('person-new', allowed('person-new'));
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: as('person-new', 'hubtest-clash@millennia21.id') });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ACCOUNT_CONFLICT');
  });

  it('says why access is refused, and that Central cannot be asked', async () => {
    const get = (id: string) => app.inject({ method: 'GET', url: '/api/v1/me', headers: as(id, `hubtest-${id}@millennia21.id`) });
    entitlements.set('p-no', { status: 'denied', personId: 'p-no', reason: 'no-access' });
    entitlements.set('p-off', { status: 'denied', personId: 'p-off', reason: 'inactive' });
    for (const id of ['p-no', 'p-off']) {
      const response = await get(id);
      expect([response.statusCode, response.json().error.code]).toEqual([403, 'NO_ACCESS']);
    }
    expect((await get('p-no')).json().error.details.reason).toBe('no-access');
    central = 'down';
    const down = await get('p-any');
    expect([down.statusCode, down.json().error.code]).toEqual([503, 'CENTRAL_UNAVAILABLE']);
    expect(await sql`select 1 from users where email like 'hubtest-p-%'`).toHaveLength(0);
  });

  it('follows a change in Central on the next answer', async () => {
    entitlements.set('person-c', allowed('person-c', permissionBundles.worker));
    await app.inject({ method: 'GET', url: '/api/v1/me', headers: as('person-c', 'hubtest-change@millennia21.id') });
    entitlements.set('person-c', allowed('person-c', ['woko.use', 'work-order.create', 'work-order.be-pic']));
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: as('person-c', 'hubtest-change@millennia21.id') });
    expect(response.json().data.permissions).toEqual(['woko.use', 'work-order.create', 'work-order.be-pic']);
    expect(await storedPermissions('hubtest-change@millennia21.id')).toEqual(['woko.use', 'work-order.be-pic', 'work-order.create']);
  });

  it('gates routes by the permissions Central gave', async () => {
    entitlements.set('person-w', allowed('person-w', permissionBundles.worker));
    const worker = as('person-w', 'hubtest-worker@millennia21.id');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: worker })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/work-orders', headers: worker })).statusCode).toBe(200);
  });

  it('makes who may use Woko read only here', async () => {
    entitlements.set('person-admin', allowed('person-admin', permissionBundles.administrator));
    const admin = as('person-admin', 'hubtest-admin@millennia21.id');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: admin })).statusCode).toBe(200);
    const write = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: admin, payload: { email: 'hubtest-new@millennia21.id', fullName: 'New Person', permissions: ['woko.use'] } });
    expect([write.statusCode, write.json().error.code]).toEqual([409, 'MANAGED_BY_CENTRAL']);
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/00000000-0000-4000-8000-000000000000', headers: admin, payload: { active: true, permissions: ['woko.use'] } })).statusCode).toBe(409);
  });

  it('sends the person to the Hub to sign in, and back again, without looping', async () => {
    const toHub = await app.inject({ method: 'GET', url: '/api/v1/auth/login?redirect=%2Fwork' });
    expect(toHub.statusCode).toBe(302);
    expect(String(toHub.headers.location)).toContain('https://hub.example.org/auth/restore?return=');
    expect(decodeURIComponent(String(toHub.headers.location))).toContain('/api/v1/auth/login?redirect=%2Fwork');

    const stillNobody = await app.inject({ method: 'GET', url: '/api/v1/auth/login?redirect=%2Fwork&restored=1' });
    expect(stillNobody.headers.location).toBe('https://hub.example.org/');

    const signedIn = await app.inject({ method: 'GET', url: '/api/v1/auth/login?redirect=%2Fwork', headers: { cookie: as('p', 'hubtest-x@millennia21.id').cookie } });
    expect(signedIn.headers.location).toBe('http://localhost:5173/work');

    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin: 'http://localhost:5173' } });
    expect(out.json().data).toEqual({ loggedOut: true, redirectTo: 'https://hub.example.org/' });
  });
});

describe('keeping the users the same as the entitlements in Central', () => {
  const row = (personId: string, email: string, permissions: readonly string[], extra: Partial<EntitlementRow> = {}): EntitlementRow => ({
    person_id: personId, is_active: true, permissions, person: { full_name: `Name ${personId}`, email }, ...extra,
  });
  const run = (rows: EntitlementRow[], mode: 'dry-run' | 'apply' = 'apply', more: { deactivateUnlinked?: boolean } = {}) =>
    syncEntitlements({ source: { listAllApplicationEntitlements: async () => rows }, mode, ...more });

  it('makes, links, renames and updates, and reports it', async () => {
    await sql`insert into users (google_subject_id, email, full_name, active) values ('g-1', 'hubtest-link@millennia21.id', 'Old', true)`;
    const report = await run([
      row('s-1', 'hubtest-new1@millennia21.id', permissionBundles.worker),
      row('s-2', 'hubtest-link@millennia21.id', permissionBundles.overseer),
    ]);
    expect(report).toMatchObject({ entitlementsSeen: 2, created: 1, linked: 1, renamed: 1, permissionsChanged: 2 });
    expect((await sql`select full_name, central_person_id from users where email = 'hubtest-link@millennia21.id'`)[0]).toMatchObject({ full_name: 'Name s-2', central_person_id: 's-2' });
    expect(await storedPermissions('hubtest-new1@millennia21.id')).toEqual([...permissionBundles.worker].sort());
    const again = await run([row('s-1', 'hubtest-new1@millennia21.id', permissionBundles.worker), row('s-2', 'hubtest-link@millennia21.id', permissionBundles.overseer)]);
    expect(again).toMatchObject({ created: 0, linked: 0, renamed: 0, permissionsChanged: 0, deactivated: 0 });
  });

  it('switches off a person who lost access, keeps the user, and ignores permissions it does not know', async () => {
    await run([row('s-3', 'hubtest-gone@millennia21.id', ['woko.use', 'not.a.permission'])]);
    expect(await storedPermissions('hubtest-gone@millennia21.id')).toEqual(['woko.use']);
    const report = await run([row('s-4', 'hubtest-stay@millennia21.id', permissionBundles.worker)]);
    expect(report).toMatchObject({ deactivated: expect.any(Number) });
    expect((await sql`select active from users where email = 'hubtest-gone@millennia21.id'`)[0]!.active).toBe(false);
    expect(await storedPermissions('hubtest-gone@millennia21.id')).toEqual([]);
    await run([row('s-3', 'hubtest-gone@millennia21.id', permissionBundles.worker), row('s-4', 'hubtest-stay@millennia21.id', permissionBundles.worker)]);
    expect((await sql`select active from users where email = 'hubtest-gone@millennia21.id'`)[0]!.active).toBe(true);
  });

  it('does not touch anything in a dry run, and refuses an empty answer when people are linked', async () => {
    const preview = await run([row('s-5', 'hubtest-dry@millennia21.id', permissionBundles.worker)], 'dry-run');
    expect(preview).toMatchObject({ mode: 'dry-run', created: 1 });
    expect(await sql`select 1 from users where email = 'hubtest-dry@millennia21.id'`).toHaveLength(0);
    await run([row('s-6', 'hubtest-kept@millennia21.id', permissionBundles.worker)]);
    await expect(run([])).rejects.toThrow(/nobody with access/);
    expect((await sql`select active from users where email = 'hubtest-kept@millennia21.id'`)[0]!.active).toBe(true);
  });

  it('leaves users that were never linked alone unless asked, and counts them', async () => {
    const wereActive = (await sql<Array<{ id: string }>>`select id from users where active`).map((user) => user.id);
    await sql`insert into users (google_subject_id, email, full_name, active) values ('g-2', 'hubtest-legacy@millennia21.id', 'Legacy', true)`;
    const report = await run([row('s-7', 'hubtest-someone@millennia21.id', permissionBundles.worker)]);
    expect(report!.unlinkedLocalUsers).toBeGreaterThanOrEqual(1);
    expect((await sql`select active from users where email = 'hubtest-legacy@millennia21.id'`)[0]!.active).toBe(true);
    await run([row('s-7', 'hubtest-someone@millennia21.id', permissionBundles.worker)], 'apply', { deactivateUnlinked: true });
    expect((await sql`select active from users where email = 'hubtest-legacy@millennia21.id'`)[0]!.active).toBe(false);
    // the shared test database holds other suites' users, which that run switched off too
    await sql`update users set active = true where id = any(${wereActive}::uuid[])`;
  });
});
