import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { permissionBundles } from '@woko/domain';
import { buildApp } from './app.js';
import { sql } from './database/client.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
if (!integrationDatabaseUrl || new URL(integrationDatabaseUrl).pathname !== '/woko_facilities_test') {
  throw new Error('Facilities integration tests require DATABASE_URL for the dedicated woko_facilities_test database.');
}

const managerId = '30000000-0000-4000-8000-000000000001';
const requesterId = '30000000-0000-4000-8000-000000000002';
const unrelatedAdminId = '30000000-0000-4000-8000-000000000003';
const secondManagerId = '30000000-0000-4000-8000-000000000004';
const nonManagerId = '30000000-0000-4000-8000-000000000005';
const app = await buildApp();

type ApiBody = { data?: any; error?: { code: string } };

function asUser(userId: string) {
  return { 'x-test-user-id': userId };
}

async function body(response: Awaited<ReturnType<typeof app.inject>>) {
  return response.json() as ApiBody;
}

async function createUser(id: string, subject: string, email: string, name: string, bundle: 'administrator' | 'facilitiesManager' | 'personInCharge', active = true) {
  await sql`
    insert into users (id, google_subject_id, email, full_name, active)
    values (${id}, ${subject}, ${email}, ${name}, ${active})
    on conflict (id) do update set active = excluded.active, full_name = excluded.full_name
  `;
  await sql`insert into user_permissions (user_id, permission) select ${id}, unnest(${[...permissionBundles[bundle]]}::text[]) on conflict do nothing`;
}

async function createAsset(quantity = 2) {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/facilities/assets', headers: asUser(managerId),
    payload: { name: 'Projector', assetCode: `PJ-${crypto.randomUUID()}`, quantity, active: true },
  });
  expect(response.statusCode).toBe(201);
  return (await body(response)).data.id as string;
}

function futureBooking(assetId: string, quantity = 1) {
  return {
    purpose: 'Class presentation', location: 'A101',
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    items: [{ assetId, quantity }],
  };
}

beforeEach(async () => {
  await sql`truncate facilities_audit_events, facilities_request_items, facilities_requests, facilities_assets, work_order_settings cascade`;
  await sql`delete from user_permissions where user_id = any(${[managerId, requesterId, unrelatedAdminId, secondManagerId, nonManagerId]}::uuid[])`;
  await createUser(managerId, 'facilities-test-manager', 'manager@millennia21.id', 'Assigned Manager', 'facilitiesManager');
  await createUser(requesterId, 'facilities-test-requester', 'requester@millennia21.id', 'Requester', 'personInCharge');
  await createUser(unrelatedAdminId, 'facilities-test-admin', 'admin@millennia21.id', 'Unrelated Admin', 'administrator');
  await createUser(secondManagerId, 'facilities-test-manager-two', 'manager-two@millennia21.id', 'Second Manager', 'facilitiesManager');
  await createUser(nonManagerId, 'facilities-test-worker', 'worker@millennia21.id', 'Worker', 'personInCharge');
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

describe('facilities route integration', () => {
  it('creates bookings with no work-order settings and retains deterministic routing metadata', async () => {
    const assetId = await createAsset();
    const created = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    expect(created.statusCode).toBe(201);
    const assigned = await sql<Array<{ approver_id: string }>>`select approver_id from facilities_requests where id = ${(await body(created)).data.id}`;
    expect(assigned[0]?.approver_id).toBe(managerId);
  });

  it('atomically prevents concurrent overbooking without facilities configuration', async () => {
    const assetId = await createAsset(1);
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) }),
      app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) }),
    ]);
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 422)).toHaveLength(1);
  });

  it('allows consecutive bookings for the same single-unit asset', async () => {
    const assetId = await createAsset(1);
    const first = await app.inject({
      method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId),
      payload: { purpose: 'Morning presentation', location: 'A101', startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), items: [{ assetId, quantity: 1 }] },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId),
      payload: { purpose: 'Afternoon presentation', location: 'A101', startsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), endsAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), items: [{ assetId, quantity: 1 }] },
    });
    expect(second.statusCode).toBe(201);
  });

  it('lets every active global manager or administrator decide while rejecting non-managers and inactive authentication', async () => {
    const assetId = await createAsset();
    const created = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    const requestId = (await body(created)).data.id as string;

    const requesterList = await app.inject({ method: 'GET', url: '/api/v1/facilities/requests', headers: asUser(requesterId) });
    expect((await body(requesterList)).data).toHaveLength(1);
    const unrelatedList = await app.inject({ method: 'GET', url: '/api/v1/facilities/requests', headers: asUser(unrelatedAdminId) });
    expect((await body(unrelatedList)).data).toHaveLength(1);

    const forbidden = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/decision`, headers: asUser(nonManagerId), payload: { decision: 'APPROVED', note: 'Not a manager' } });
    expect(forbidden.statusCode).toBe(403);
    const approved = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/decision`, headers: asUser(secondManagerId), payload: { decision: 'APPROVED', note: 'Approved by another global manager' } });
    expect(approved.statusCode).toBe(200);
    expect((await body(approved)).data.status).toBe('APPROVED');
    await sql`update users set active = false where id = ${managerId}`;
    const inactive = await app.inject({ method: 'GET', url: '/api/v1/facilities/requests', headers: asUser(managerId) });
    expect(inactive.statusCode).toBe(401);
  });

  it('allows an administrator to decide even when routing metadata user no longer has a manager role', async () => {
    const assetId = await createAsset();
    const created = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    const requestId = (await body(created)).data.id as string;
    await sql`delete from user_permissions where user_id = ${managerId} and permission in ('facilities:manage', 'facilities:default-approver')`;
    const approved = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/decision`, headers: asUser(unrelatedAdminId), payload: { decision: 'APPROVED', note: 'Global administrator review' } });
    expect(approved.statusCode).toBe(200);
  });

  it('records cancellation in the immutable audit history', async () => {
    const assetId = await createAsset();
    const created = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    const requestId = (await body(created)).data.id as string;
    const cancelled = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/cancel`, headers: asUser(requesterId) });
    expect(cancelled.statusCode).toBe(200);
    expect((await body(cancelled)).data.status).toBe('CANCELLED');
    const audit = await sql<Array<{ event_type: string }>>`select event_type from facilities_audit_events where request_id = ${requestId} order by created_at`;
    expect(audit.map((event) => event.event_type)).toContain('FACILITIES_REQUEST_CANCELLED');
  });

  it('returns issue-bearing requests with the same status exposed by listings and releases holds on resolution', async () => {
    const assetId = await createAsset(2);
    const request = await sql<Array<{ id: string }>>`
      insert into facilities_requests (purpose, location, starts_at, ends_at, status, requester_id, approver_id, decided_at)
      values ('Class presentation', 'A101', now() - interval '3 hours', now() - interval '1 hour', 'APPROVED', ${requesterId}, ${managerId}, now()) returning id
    `;
    await sql`insert into facilities_request_items (request_id, asset_id, quantity) values (${request[0]!.id}, ${assetId}, 2)`;
    const returned = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${request[0]!.id}/return`, headers: asUser(managerId), payload: { items: [{ assetId, returnedQuantity: 1, condition: 'DAMAGED', issueNote: 'Lens cracked' }] } });
    expect(returned.statusCode).toBe(200);
    expect((await body(returned)).data.status).toBe('RETURNED_WITH_ISSUES');

    const blocked = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    expect((await body(blocked)).error?.code).toBe('ASSET_UNAVAILABLE');
    const resolved = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${request[0]!.id}/resolve`, headers: asUser(managerId), payload: { note: 'Repaired and returned to inventory' } });
    expect(resolved.statusCode).toBe(200);
    const available = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    expect(available.statusCode).toBe(201);
  });

  it('blocks new bookings while an overdue approved request remains unreturned', async () => {
    const assetId = await createAsset(1);
    const overdue = await sql<Array<{ id: string }>>`
      insert into facilities_requests (purpose, location, starts_at, ends_at, status, requester_id, approver_id, decided_at)
      values ('Past event', 'A101', now() - interval '4 hours', now() - interval '2 hours', 'APPROVED', ${requesterId}, ${managerId}, now() - interval '5 hours') returning id
    `;
    await sql`insert into facilities_request_items (request_id, asset_id, quantity) values (${overdue[0]!.id}, ${assetId}, 1)`;
    const blocked = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    expect(blocked.statusCode).toBe(422);
    expect((await body(blocked)).error?.code).toBe('ASSET_UNAVAILABLE');
  });

  it('rejects approval after a booking has started', async () => {
    const assetId = await createAsset();
    const expired = await sql<Array<{ id: string }>>`
      insert into facilities_requests (purpose, location, starts_at, ends_at, status, requester_id, approver_id)
      values ('Past event', 'A101', now() - interval '2 hours', now() - interval '1 hour', 'PENDING', ${requesterId}, ${managerId}) returning id
    `;
    await sql`insert into facilities_request_items (request_id, asset_id, quantity) values (${expired[0]!.id}, ${assetId}, 1)`;
    const decision = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${expired[0]!.id}/decision`, headers: asUser(managerId), payload: { decision: 'APPROVED', note: 'Too late' } });
    expect(decision.statusCode).toBe(422);
    expect((await body(decision)).error?.code).toBe('BOOKING_EXPIRED');
  });

  it('prevents stock reduction or deactivation while requests commit the asset', async () => {
    const assetId = await createAsset(2);
    const created = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId, 2) });
    expect(created.statusCode).toBe(201);
    const asset = await app.inject({ method: 'PUT', url: `/api/v1/facilities/assets/${assetId}`, headers: asUser(managerId), payload: { name: 'Projector', assetCode: 'PJ-committed', quantity: 1, active: true } });
    expect(asset.statusCode).toBe(422);
    expect((await body(asset)).error?.code).toBe('ASSET_COMMITMENT_CONFLICT');
  });

  it('allows stock to remain at the peak quantity of non-overlapping requests', async () => {
    const assetId = await createAsset(1);
    const first = await app.inject({
      method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId),
      payload: { purpose: 'Morning presentation', location: 'A101', startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), items: [{ assetId, quantity: 1 }] },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId),
      payload: { purpose: 'Afternoon presentation', location: 'A101', startsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), endsAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), items: [{ assetId, quantity: 1 }] },
    });
    expect(second.statusCode).toBe(201);
    const asset = await app.inject({ method: 'PUT', url: `/api/v1/facilities/assets/${assetId}`, headers: asUser(managerId), payload: { name: 'Projector', assetCode: 'PJ-peak', quantity: 1, active: true } });
    expect(asset.statusCode).toBe(200);
  });

  it('returns a friendly conflict for a duplicate asset code', async () => {
    await createAsset();
    const duplicate = await app.inject({
      method: 'POST', url: '/api/v1/facilities/assets', headers: asUser(managerId),
      payload: { name: 'Second projector', assetCode: 'PJ-duplicate', quantity: 1, active: true },
    });
    expect(duplicate.statusCode).toBe(201);
    const conflict = await app.inject({
      method: 'POST', url: '/api/v1/facilities/assets', headers: asUser(managerId),
      payload: { name: 'Duplicate projector', assetCode: 'PJ-duplicate', quantity: 1, active: true },
    });
    expect(conflict.statusCode).toBe(409);
    expect((await body(conflict)).error?.code).toBe('ASSET_CODE_CONFLICT');
  });

  it('returns a friendly conflict when updating an asset to an existing code', async () => {
    const firstId = await createAsset();
    const second = await app.inject({ method: 'POST', url: '/api/v1/facilities/assets', headers: asUser(managerId), payload: { name: 'Second projector', assetCode: 'PJ-update-conflict', quantity: 1, active: true } });
    const conflict = await app.inject({ method: 'PUT', url: `/api/v1/facilities/assets/${firstId}`, headers: asUser(managerId), payload: { name: 'Projector', assetCode: 'PJ-update-conflict', quantity: 2, active: true } });
    expect(second.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect((await body(conflict)).error?.code).toBe('ASSET_CODE_CONFLICT');
  });

  it('records rejection as a terminal lifecycle state', async () => {
    const assetId = await createAsset();
    const created = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    const requestId = (await body(created)).data.id as string;
    const rejected = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/decision`, headers: asUser(managerId), payload: { decision: 'REJECTED', note: 'Not available for this event' } });
    expect((await body(rejected)).data.status).toBe('REJECTED');
    const cancelled = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/cancel`, headers: asUser(requesterId) });
    expect((await body(cancelled)).error?.code).toBe('INVALID_REQUEST_STATE');
  });

  it('rejects an early return before the booking has ended', async () => {
    const assetId = await createAsset();
    const created = await app.inject({ method: 'POST', url: '/api/v1/facilities/requests', headers: asUser(requesterId), payload: futureBooking(assetId) });
    const requestId = (await body(created)).data.id as string;
    await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/decision`, headers: asUser(managerId), payload: { decision: 'APPROVED', note: 'Approved' } });
    const returned = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${requestId}/return`, headers: asUser(managerId), payload: { items: [{ assetId, returnedQuantity: 1, condition: 'GOOD' }] } });
    expect(returned.statusCode).toBe(422);
    expect((await body(returned)).error?.code).toBe('INVALID_REQUEST_STATE');
  });

  it('requires all borrowed units for good returns and requires notes for issue returns', async () => {
    const assetId = await createAsset(2);
    const request = await sql<Array<{ id: string }>>`
      insert into facilities_requests (purpose, location, starts_at, ends_at, status, requester_id, approver_id, decided_at)
      values ('Meeting', 'Board room', now() - interval '3 hours', now() - interval '1 hour', 'APPROVED', ${requesterId}, ${managerId}, now()) returning id
    `;
    await sql`insert into facilities_request_items (request_id, asset_id, quantity) values (${request[0]!.id}, ${assetId}, 2)`;
    const partialGood = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${request[0]!.id}/return`, headers: asUser(managerId), payload: { items: [{ assetId, returnedQuantity: 1, condition: 'GOOD' }] } });
    expect((await body(partialGood)).error?.code).toBe('INVALID_RETURN_ITEMS');
    const missingNote = await app.inject({ method: 'POST', url: `/api/v1/facilities/requests/${request[0]!.id}/return`, headers: asUser(managerId), payload: { items: [{ assetId, returnedQuantity: 1, condition: 'MISSING' }] } });
    expect(missingNote.statusCode).toBe(400);
  });
});

describe('permission gates', () => {
  const nobodyId = '30000000-0000-4000-8000-000000000006';
  const readerId = '30000000-0000-4000-8000-000000000007';

  async function userWith(id: string, email: string, list: string[]) {
    await sql`insert into users (id, google_subject_id, email, full_name, active) values (${id}, ${`gate-${id}`}, ${email}, ${email}, true) on conflict (id) do nothing`;
    await sql`delete from user_permissions where user_id = ${id}`;
    if (list.length) await sql`insert into user_permissions (user_id, permission) select ${id}, unnest(${list}::text[])`;
  }

  it('refuses a person with no permissions on every gated route', async () => {
    await userWith(nobodyId, 'nobody@millennia21.id', []);
    const calls: Array<[string, string]> = [['GET', '/facilities/assets'], ['GET', '/work-orders'], ['GET', '/work-lists'], ['GET', '/admin/users'], ['GET', '/admin/locations'], ['GET', '/approvals'], ['GET', '/reports/work-orders']];
    for (const [method, url] of calls) {
      const response = await app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: asUser(nobodyId) });
      expect([url, response.statusCode]).toEqual([url, 403]);
    }
    const create = await app.inject({ method: 'POST', url: '/api/v1/work-orders', headers: asUser(nobodyId), payload: {} });
    expect(create.statusCode).toBe(403);
  });

  it('answers a person with no permissions with 403 whether or not the work order exists', async () => {
    await userWith(nobodyId, 'nobody@millennia21.id', []);
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const [method, url] of [['GET', `/work-orders/${unknown}`], ['PATCH', `/work-orders/${unknown}/priority`], ['POST', `/work-orders/${unknown}/condition`]] as const) {
      const response = await app.inject({ method, url: `/api/v1${url}`, headers: asUser(nobodyId), payload: method === 'GET' ? undefined : {} });
      expect([url, response.statusCode]).toEqual([url, 403]);
    }
  });

  it('lets one permission open exactly its own routes', async () => {
    await userWith(readerId, 'reader@millennia21.id', ['work-order:read-all']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/work-orders', headers: asUser(readerId) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: asUser(readerId) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/approvals', headers: asUser(readerId) })).statusCode).toBe(403);
  });

  it('carries the permissions in /me and no role', async () => {
    const me = await body(await app.inject({ method: 'GET', url: '/api/v1/me', headers: asUser(unrelatedAdminId) }));
    expect(me.data.permissions).toContain('users:manage');
    expect(me.data.roles).toBeUndefined();
  });

  it('registers a person with permissions, refuses unknown ones, and keeps the administrator from locking themselves out', async () => {
    const register = (permissions: string[]) => app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: asUser(unrelatedAdminId), payload: { email: `new-${permissions.length}@millennia21.id`, fullName: 'New Person', permissions } });
    expect((await register(['work-order:be-pic', 'not-a-permission'])).statusCode).toBeGreaterThanOrEqual(400);
    expect((await register([])).statusCode).toBeGreaterThanOrEqual(400);
    const created = await register(['work-order:be-pic', 'work-order:create']);
    expect(created.statusCode).toBe(201);
    const stored = await sql<Array<{ permission: string }>>`select permission from user_permissions where user_id = ${(await body(created)).data.id} order by permission`;
    expect(stored.map((row) => row.permission)).toEqual(['work-order:be-pic', 'work-order:create']);

    const lockout = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${unrelatedAdminId}`, headers: asUser(unrelatedAdminId), payload: { active: true, permissions: ['work-order:create'] } });
    expect(lockout.statusCode).toBe(422);
    await sql`delete from users where email like 'new-%@millennia21.id'`;
  });
});
