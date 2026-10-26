import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireManager } from './auth.js';
import { sql } from './database/client.js';

const schoolTimeZone = 'Asia/Jakarta';
const isoDateTime = z.string().datetime({ offset: true });
const idSchema = z.object({ id: z.string().uuid() });

const assetInputSchema = z.object({ name: z.string().trim().min(1).max(160), assetCode: z.string().trim().min(1).max(80), quantity: z.number().int().min(0).max(100000), active: z.boolean() });
const requestSchema = z.object({ purpose: z.string().trim().min(3).max(1000), location: z.string().trim().min(1).max(300), startsAt: isoDateTime, endsAt: isoDateTime, items: z.array(z.object({ assetId: z.string().uuid(), quantity: z.number().int().positive().max(100000) })).min(1).max(100) }).superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.assetId)).size !== value.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Each asset may only be requested once.' });
});
const decisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().min(1).max(2000) });
const returnSchema = z.object({ items: z.array(z.object({ assetId: z.string().uuid(), returnedQuantity: z.number().int().min(0).max(100000), condition: z.enum(['GOOD', 'DAMAGED', 'MISSING']), issueNote: z.string().trim().max(2000).optional() })).min(1).max(100), note: z.string().trim().max(2000).optional() }).superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.assetId)).size !== value.items.length) context.addIssue({ code: 'custom', path: ['items'], message: 'Each asset may only be returned once.' });
  value.items.forEach((item, index) => { if ((item.condition === 'DAMAGED' || item.condition === 'MISSING') && !item.issueNote) context.addIssue({ code: 'custom', path: ['items', index, 'issueNote'], message: 'Describe damaged or missing assets.' }); });
});
const resolveSchema = z.object({ note: z.string().trim().min(1).max(2000) });
type BookingTimeInput = { startsAt: string; endsAt: string; now?: Date };
type RouteResult = { error: string; assetName?: string } | { id: string } | { status: string } | { resolved: number };

function dateInSchoolTimeZone(value: Date): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: schoolTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function bookingWindowEnd(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: schoolTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((item) => item.type === type)!.value);
  const targetMonth = part('month') + 2; const targetYear = part('year') + Math.floor((targetMonth - 1) / 12); const month = ((targetMonth - 1) % 12) + 1;
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(part('day'), new Date(Date.UTC(targetYear, month, 0)).getUTCDate())).padStart(2, '0')}`;
}
export function validateBookingTimes({ startsAt, endsAt, now = new Date() }: BookingTimeInput): { ok: true } | { ok: false; code: 'INVALID_BOOKING_TIME' | 'BOOKING_WINDOW_EXCEEDED' } {
  const start = new Date(startsAt); const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start <= now || end <= start) return { ok: false, code: 'INVALID_BOOKING_TIME' };
  if (dateInSchoolTimeZone(start) > bookingWindowEnd(now) || dateInSchoolTimeZone(end) > bookingWindowEnd(now)) return { ok: false, code: 'BOOKING_WINDOW_EXCEEDED' };
  return { ok: true };
}
function isManager(roles: readonly string[]) { return roles.includes('ADMINISTRATOR') || roles.includes('FACILITIES_MANAGER'); }
function sendError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, requestId: string, status: number, code: string, message: string) { return reply.code(status).send({ error: { code, message, requestId } }); }
function hasError(result: RouteResult): result is Extract<RouteResult, { error: string }> { return 'error' in result; }
function isAssetCodeConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
    && 'constraint_name' in error && error.constraint_name === 'facilities_assets_asset_code_key';
}

const requestSelect = sql`
  select fr.id, fr.purpose, fr.location, fr.starts_at::text, fr.ends_at::text,
    case when fr.status = 'RETURNED' and exists (select 1 from facilities_request_items issue where issue.request_id = fr.id and issue.return_condition in ('DAMAGED', 'MISSING') and issue.issue_resolved_at is null) then 'RETURNED_WITH_ISSUES' else fr.status::text end as status,
    fr.requester_id, requester.full_name as requester_name, fr.approver_id, approver.full_name as approver_name, fr.decision_note, fr.return_note,
    coalesce(items.items, '[]'::json) as items
  from facilities_requests fr join users requester on requester.id = fr.requester_id join users approver on approver.id = fr.approver_id
  left join lateral (select json_agg(json_build_object('asset_id', item.asset_id, 'asset_name', asset.name, 'quantity', item.quantity, 'returned_quantity', item.returned_quantity, 'condition', item.return_condition, 'issue_note', item.issue_note, 'issue_resolved_at', item.issue_resolved_at) order by asset.name) as items from facilities_request_items item join facilities_assets asset on asset.id = item.asset_id where item.request_id = fr.id) items on true
`;

export async function facilitiesRequestRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.get('/facilities/assets', async () => ({ data: await sql`select id, name, asset_code, quantity, active from facilities_assets order by name` }));

  app.post('/facilities/assets', { preHandler: requireManager }, async (request, reply) => {
    const input = assetInputSchema.parse(request.body);
    try {
      const created = await sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string; name: string; asset_code: string; quantity: number; active: boolean }>>`insert into facilities_assets (name, asset_code, quantity, active, created_by, updated_by) values (${input.name}, ${input.assetCode}, ${input.quantity}, ${input.active}, ${request.currentUser.id}, ${request.currentUser.id}) returning id, name, asset_code, quantity, active`;
        const row = rows[0]!; await tx`insert into facilities_audit_events (asset_id, user_id, event_type, new_data, correlation_id) values (${row.id}, ${request.currentUser.id}, 'FACILITIES_ASSET_CREATED', ${tx.json(row)}, ${request.id})`; return row;
      });
      return reply.code(201).send({ data: created });
    } catch (error) {
      if (isAssetCodeConflict(error)) return sendError(reply, request.id, 409, 'ASSET_CODE_CONFLICT', 'An asset with this code already exists.');
      throw error;
    }
  });
  app.put('/facilities/assets/:id', { preHandler: requireManager }, async (request, reply) => {
    const { id } = idSchema.parse(request.params); const input = assetInputSchema.parse(request.body);
    let result: RouteResult;
    try {
      result = await sql.begin(async (tx): Promise<RouteResult> => {
      const rows = await tx<Array<{ id: string; name: string; asset_code: string; quantity: number; active: boolean }>>`select id, name, asset_code, quantity, active from facilities_assets where id = ${id} for update`;
      const previous = rows[0]; if (!previous) return { error: 'NOT_FOUND' };
      const committed = await tx<Array<{ quantity: number }>>`
        select coalesce(max(concurrent.quantity), 0)::int quantity from (
          select sum(other_item.quantity)::int quantity
          from facilities_request_items anchor_item
          join facilities_requests anchor_request on anchor_request.id = anchor_item.request_id
          join facilities_request_items other_item on other_item.asset_id = anchor_item.asset_id
          join facilities_requests other_request on other_request.id = other_item.request_id
          where anchor_item.asset_id = ${id}
            and anchor_request.status in ('PENDING', 'APPROVED') and anchor_request.ends_at > now()
            and other_request.status in ('PENDING', 'APPROVED') and other_request.ends_at > now()
            and other_request.starts_at <= anchor_request.starts_at and other_request.ends_at > anchor_request.starts_at
          group by anchor_request.starts_at
        ) concurrent
      `;
      const overdue = await tx<Array<{ quantity: number }>>`select coalesce(sum(item.quantity), 0)::int quantity from facilities_request_items item join facilities_requests request on request.id=item.request_id where item.asset_id=${id} and request.status='APPROVED' and request.ends_at <= now() and request.returned_at is null`;
      const held = await tx<Array<{ quantity: number }>>`select coalesce(sum(item.quantity), 0)::int quantity from facilities_request_items item join facilities_requests request on request.id=item.request_id where item.asset_id=${id} and request.status='RETURNED' and item.return_condition in ('DAMAGED','MISSING') and item.issue_resolved_at is null`;
      const protectedQuantity = committed[0]!.quantity + overdue[0]!.quantity + held[0]!.quantity;
      if (input.quantity < protectedQuantity || (!input.active && protectedQuantity > 0)) return { error: 'ASSET_COMMITMENT_CONFLICT' };
      const updatedRows = await tx<Array<{ id: string; name: string; asset_code: string; quantity: number; active: boolean }>>`update facilities_assets set name=${input.name}, asset_code=${input.assetCode}, quantity=${input.quantity}, active=${input.active}, updated_by=${request.currentUser.id}, updated_at=now() where id=${id} returning id, name, asset_code, quantity, active`;
      const updated = updatedRows[0]!; await tx`insert into facilities_audit_events (asset_id, user_id, event_type, previous_data, new_data, correlation_id) values (${id}, ${request.currentUser.id}, 'FACILITIES_ASSET_UPDATED', ${tx.json(previous)}, ${tx.json(updated)}, ${request.id})`; return { id: updated.id };
      });
    } catch (error) {
      if (isAssetCodeConflict(error)) return sendError(reply, request.id, 409, 'ASSET_CODE_CONFLICT', 'An asset with this code already exists.');
      throw error;
    }
    if (hasError(result)) return sendError(reply, request.id, result.error === 'NOT_FOUND' ? 404 : 422, result.error, result.error === 'NOT_FOUND' ? 'Asset not found.' : 'Asset stock is committed to requests or unresolved returns.');
    const rows = await sql`select id, name, asset_code, quantity, active from facilities_assets where id=${id}`; return { data: rows[0] };
  });
  app.get('/facilities/requests', async (request) => ({ data: isManager(request.currentUser.roles) ? await sql`${requestSelect} order by fr.starts_at desc` : await sql`${requestSelect} where fr.requester_id=${request.currentUser.id} order by fr.starts_at desc` }));
  app.post('/facilities/requests', async (request, reply) => {
    const input = requestSchema.parse(request.body); const check = validateBookingTimes(input);
    if (!check.ok) return sendError(reply, request.id, 422, check.code, check.code === 'INVALID_BOOKING_TIME' ? 'Choose a future start and an end after it.' : 'Bookings may end no later than two calendar months from today.');
    const result = await sql.begin(async (tx): Promise<RouteResult> => {
      const managers = await tx<Array<{ id: string }>>`select u.id from users u where u.active and exists (select 1 from user_roles role where role.user_id = u.id and role.role in ('ADMINISTRATOR', 'FACILITIES_MANAGER')) order by case when exists (select 1 from user_roles role where role.user_id = u.id and role.role = 'FACILITIES_MANAGER') then 0 else 1 end, u.id limit 1 for share`;
      const manager = managers[0]; if (!manager) return { error: 'NO_ACTIVE_MANAGER' };
      const assets = await tx<Array<{ id: string; name: string; quantity: number }>>`select id,name,quantity from facilities_assets where id=any(${input.items.map((item) => item.assetId)}::uuid[]) and active=true order by id for update`;
      if (assets.length !== input.items.length) return { error: 'INVALID_ASSET' };
      for (const item of input.items) {
        const asset = assets.find((candidate) => candidate.id === item.assetId)!;
        const committed = await tx<Array<{ quantity: number }>>`select coalesce(sum(i.quantity),0)::int quantity from facilities_request_items i join facilities_requests r on r.id=i.request_id where i.asset_id=${item.assetId} and (r.status='PENDING' or (r.status='APPROVED' and (r.ends_at > now() or r.returned_at is null))) and (r.status='APPROVED' and r.ends_at <= now() or (r.starts_at < ${input.endsAt}::timestamptz and r.ends_at > ${input.startsAt}::timestamptz))`;
        const held = await tx<Array<{ quantity: number }>>`select coalesce(sum(i.quantity),0)::int quantity from facilities_request_items i join facilities_requests r on r.id=i.request_id where i.asset_id=${item.assetId} and r.status='RETURNED' and i.return_condition in ('DAMAGED','MISSING') and i.issue_resolved_at is null`;
        if (item.quantity + committed[0]!.quantity + held[0]!.quantity > asset.quantity) return { error: 'ASSET_UNAVAILABLE', assetName: asset.name };
      }
      const created = await tx<Array<{ id: string }>>`insert into facilities_requests (purpose,location,starts_at,ends_at,status,requester_id,approver_id) values (${input.purpose},${input.location},${input.startsAt},${input.endsAt},'PENDING',${request.currentUser.id},${manager.id}) returning id`;
      const row = created[0]!; for (const item of input.items) await tx`insert into facilities_request_items (request_id,asset_id,quantity) values (${row.id},${item.assetId},${item.quantity})`;
      await tx`insert into facilities_audit_events (request_id,user_id,event_type,new_data,correlation_id) values (${row.id},${request.currentUser.id},'FACILITIES_REQUEST_CREATED',${tx.json(input)},${request.id})`; return { id: row.id };
    });
    if (hasError(result)) return sendError(reply, request.id, 422, result.error, result.error === 'NO_ACTIVE_MANAGER' ? 'An active Facilities Manager or Administrator is required before requests can be submitted.' : result.error === 'INVALID_ASSET' ? 'Select active assets only.' : `${result.assetName!} is not available for the requested time.`);
    return reply.code(201).send({ data: result });
  });
  app.post('/facilities/requests/:id/decision', { preHandler: requireManager }, async (request, reply) => {
    const { id } = idSchema.parse(request.params); const input = decisionSchema.parse(request.body);
    const result = await sql.begin(async (tx): Promise<RouteResult> => {
      const rows = await tx<Array<{ status: string; starts_at: string }>>`select status,starts_at::text from facilities_requests where id=${id} for update`; const facilityRequest=rows[0];
      if (!facilityRequest) return { error:'NOT_FOUND' }; if (facilityRequest.status !== 'PENDING') return { error:'INVALID_REQUEST_STATE' }; if (input.decision === 'APPROVED' && new Date(facilityRequest.starts_at) <= new Date()) return { error:'BOOKING_EXPIRED' };
      const status=input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED'; await tx`update facilities_requests set status=${status},decision_note=${input.note},decided_at=now(),updated_at=now() where id=${id}`; await tx`insert into facilities_audit_events (request_id,user_id,event_type,new_data,correlation_id) values (${id},${request.currentUser.id},'FACILITIES_REQUEST_DECIDED',${tx.json(input)},${request.id})`; return { status };
    });
    if (hasError(result)) return sendError(reply,request.id,result.error === 'NOT_FOUND'?404:422,result.error,result.error === 'BOOKING_EXPIRED'?'Expired bookings cannot be approved.':'This request cannot be decided now.'); return { data:result };
  });
  app.post('/facilities/requests/:id/cancel', async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const result = await sql.begin(async (tx): Promise<RouteResult> => {
      const rows = await tx<Array<{ status: string; requester_id: string }>>`select status, requester_id from facilities_requests where id = ${id} for update`;
      const item = rows[0];
      if (!item) return { error: 'NOT_FOUND' };
      if (item.requester_id !== request.currentUser.id) return { error: 'CANCEL_FORBIDDEN' };
      if (item.status !== 'PENDING') return { error: 'INVALID_REQUEST_STATE' };
      await tx`update facilities_requests set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = ${id}`;
      await tx`insert into facilities_audit_events (request_id, user_id, event_type, new_data, correlation_id) values (${id}, ${request.currentUser.id}, 'FACILITIES_REQUEST_CANCELLED', ${tx.json({ status: 'CANCELLED' })}, ${request.id})`;
      return { status: 'CANCELLED' };
    });
    if (hasError(result)) return sendError(reply, request.id, result.error === 'NOT_FOUND' ? 404 : result.error === 'CANCEL_FORBIDDEN' ? 403 : 422, result.error, result.error === 'CANCEL_FORBIDDEN' ? 'Only the requester may cancel this request.' : 'Only pending requests may be cancelled.');
    return { data: result };
  });
  app.post('/facilities/requests/:id/return', { preHandler: requireManager }, async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const input = returnSchema.parse(request.body);
    const result = await sql.begin(async (tx): Promise<RouteResult> => {
      const rows = await tx<Array<{ status: string; ends_at: string }>>`select status, ends_at::text from facilities_requests where id = ${id} for update`;
      const item = rows[0];
      if (!item) return { error: 'NOT_FOUND' };

      if (item.status !== 'APPROVED' || new Date(item.ends_at) > new Date()) return { error: 'INVALID_REQUEST_STATE' };
      const booked = await tx<Array<{ asset_id: string; quantity: number }>>`select asset_id, quantity from facilities_request_items where request_id = ${id} for update`;
      if (booked.length !== input.items.length || input.items.some((returnItem) => {
        const bookedItem = booked.find((candidate) => candidate.asset_id === returnItem.assetId);
        return !bookedItem || returnItem.returnedQuantity > bookedItem.quantity || (returnItem.condition === 'GOOD' && returnItem.returnedQuantity !== bookedItem.quantity);
      })) return { error: 'INVALID_RETURN_ITEMS' };
      for (const returnItem of input.items) await tx`update facilities_request_items set returned_quantity = ${returnItem.returnedQuantity}, return_condition = ${returnItem.condition}, issue_note = ${returnItem.issueNote ?? null}, inspected_by = ${request.currentUser.id}, inspected_at = now() where request_id = ${id} and asset_id = ${returnItem.assetId}`;
      const hasIssues = input.items.some((returnItem) => returnItem.condition === 'DAMAGED' || returnItem.condition === 'MISSING');
      await tx`update facilities_requests set status = 'RETURNED', return_note = ${input.note ?? null}, returned_at = now(), updated_at = now() where id = ${id}`;
      await tx`insert into facilities_audit_events (request_id, user_id, event_type, new_data, correlation_id) values (${id}, ${request.currentUser.id}, 'FACILITIES_RETURN_INSPECTED', ${tx.json(input)}, ${request.id})`;
      return { status: hasIssues ? 'RETURNED_WITH_ISSUES' : 'RETURNED' };
    });
    if (hasError(result)) return sendError(reply, request.id, result.error === 'NOT_FOUND' ? 404 : 422, result.error, 'Returns must include every booked asset after its booking ends; good returns require all units.');
    return { data: result };
  });
  app.post('/facilities/requests/:id/resolve', { preHandler: requireManager }, async (request,reply)=>{const {id}=idSchema.parse(request.params);const input=resolveSchema.parse(request.body);const result=await sql.begin(async(tx):Promise<RouteResult>=>{const rows=await tx<Array<{status:string}>>`select status from facilities_requests where id=${id} for update`;const item=rows[0];if(!item)return{error:'NOT_FOUND'};if(item.status!=='RETURNED')return{error:'INVALID_REQUEST_STATE'};const resolved=await tx`update facilities_request_items set issue_resolved_at=now(),issue_resolved_by=${request.currentUser.id},issue_resolution_note=${input.note} where request_id=${id} and return_condition in ('DAMAGED','MISSING') and issue_resolved_at is null`;if(!resolved.count)return{error:'NO_UNRESOLVED_ISSUES'};await tx`insert into facilities_audit_events (request_id,user_id,event_type,new_data,correlation_id) values (${id},${request.currentUser.id},'FACILITIES_RETURN_ISSUES_RESOLVED',${tx.json(input)},${request.id})`;return{resolved:resolved.count};});if(hasError(result))return sendError(reply,request.id,result.error==='NOT_FOUND'?404:422,result.error,'There are no unresolved return issues for this request.');return{data:result};});
}
