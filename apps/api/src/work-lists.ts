import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireManager } from './auth.js';
import { sql } from './database/client.js';
import { prepareEvidenceUpload } from './evidence.js';
import { uploadDriveFile } from './drive.js';

const id = z.string().uuid();
const itemSchema = z.object({ title: z.string().trim().min(2).max(300), instructions: z.string().trim().max(2_000).default(''), recurrence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), required: z.boolean().default(true) });
const templateSchema = z.object({ title: z.string().trim().min(3).max(200), instructions: z.string().trim().max(4_000).default(''), active: z.boolean().default(true), locationIds: z.array(id).min(1).max(100), workerIds: z.array(id).min(1).max(100), items: z.array(itemSchema).min(1).max(100) });
const resolveSchema = z.object({ status: z.enum(['COMPLETED', 'NOT_APPLICABLE', 'ISSUE_FOUND']), note: z.string().trim().max(2_000).default(''), expectedVersion: z.number().int().positive() }).superRefine((value, context) => { if (value.status !== 'COMPLETED' && value.note.length < 3) context.addIssue({ code: 'custom', path: ['note'], message: 'Explain items that are not applicable or have an issue.' }); });
const submitSchema = z.object({ note: z.string().trim().min(3).max(2_000), expectedVersion: z.number().int().positive() });

function manager(roles: readonly string[]) { return roles.includes('ADMINISTRATOR') || roles.includes('FACILITIES_MANAGER'); }
async function canAccessOccurrence(occurrenceId: string, userId: string, roles: readonly string[]) {
  if (manager(roles)) return true;
  const rows = await sql`select 1 from work_list_occurrences where id = ${occurrenceId} and ${userId} = any(worker_ids)`;
  return rows.length > 0;
}
async function ensureWorkers(workerIds: string[]) {
  const rows = await sql<Array<{ id: string }>>`select distinct u.id from users u join user_roles ur on ur.user_id = u.id where u.active and ur.role = 'WORKER' and u.id = any(${workerIds}::uuid[])`;
  return rows.length === workerIds.length;
}

export async function workListRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/work-lists/templates', { preHandler: requireManager }, async () => {
    const templates = await sql`
      select t.id, t.title, t.instructions, t.active, t.version, t.created_at::text, t.updated_at::text,
        coalesce((select json_agg(json_build_object('id', i.id, 'title', i.title, 'instructions', i.instructions, 'recurrence', i.recurrence, 'required', i.required, 'sort_order', i.sort_order) order by i.sort_order) from work_list_template_items i where i.template_id = t.id), '[]'::json) items,
        coalesce((select json_agg(l.location_option_id) from work_list_template_locations l where l.template_id = t.id), '[]'::json) as location_ids,
        coalesce((select json_agg(w.user_id) from work_list_template_workers w where w.template_id = t.id), '[]'::json) as worker_ids
      from work_list_templates t order by t.active desc, t.title`;
    return { data: templates };
  });

  app.post('/work-lists/templates', { preHandler: requireManager }, async (request, reply) => {
    const input = templateSchema.parse(request.body);
    if (!await ensureWorkers(input.workerIds)) return reply.code(422).send({ error: { code: 'INVALID_WORKER', message: 'Every assigned person must be an active Worker.', requestId: request.id } });
    const result = await sql.begin(async (tx) => {
      const created = await tx<Array<{ id: string }>>`insert into work_list_templates (title, instructions, active, created_by, updated_by) values (${input.title}, ${input.instructions}, ${input.active}, ${request.currentUser.id}, ${request.currentUser.id}) returning id`;
      const templateId = created[0]!.id;
      for (const [sortOrder, item] of input.items.entries()) await tx`insert into work_list_template_items (template_id, title, instructions, recurrence, required, sort_order) values (${templateId}, ${item.title}, ${item.instructions}, ${item.recurrence}::work_list_recurrence, ${item.required}, ${sortOrder})`;
      await tx`insert into work_list_template_locations (template_id, location_option_id) select ${templateId}, value::uuid from unnest(${input.locationIds}::text[]) value`;
      await tx`insert into work_list_template_workers (template_id, user_id) select ${templateId}, value::uuid from unnest(${input.workerIds}::text[]) value`;
      await tx`insert into work_list_audit_events (template_id, user_id, event_type, data) values (${templateId}, ${request.currentUser.id}, 'TEMPLATE_CREATED', ${tx.json({ title: input.title })})`;
      return { id: templateId };
    });
    return reply.code(201).send({ data: result });
  });

  app.put('/work-lists/templates/:id', { preHandler: requireManager }, async (request, reply) => {
    const templateId = id.parse((request.params as { id: string }).id); const input = templateSchema.parse(request.body);
    if (!await ensureWorkers(input.workerIds)) return reply.code(422).send({ error: { code: 'INVALID_WORKER', message: 'Every assigned person must be an active Worker.', requestId: request.id } });
    const changed = await sql.begin(async (tx) => {
      const rows = await tx<Array<{ id: string }>>`update work_list_templates set title=${input.title}, instructions=${input.instructions}, active=${input.active}, version=version+1, updated_by=${request.currentUser.id}, updated_at=now() where id=${templateId} returning id`;
      if (!rows[0]) return false;
      await tx`delete from work_list_template_items where template_id=${templateId}`; await tx`delete from work_list_template_locations where template_id=${templateId}`; await tx`delete from work_list_template_workers where template_id=${templateId}`;
      for (const [sortOrder, item] of input.items.entries()) await tx`insert into work_list_template_items (template_id, title, instructions, recurrence, required, sort_order) values (${templateId}, ${item.title}, ${item.instructions}, ${item.recurrence}::work_list_recurrence, ${item.required}, ${sortOrder})`;
      await tx`insert into work_list_template_locations (template_id, location_option_id) select ${templateId}, value::uuid from unnest(${input.locationIds}::text[]) value`;
      await tx`insert into work_list_template_workers (template_id, user_id) select ${templateId}, value::uuid from unnest(${input.workerIds}::text[]) value`;
      await tx`insert into work_list_audit_events (template_id, user_id, event_type, data) values (${templateId}, ${request.currentUser.id}, 'TEMPLATE_UPDATED', ${tx.json({ title: input.title })})`;
      return true;
    });
    if (!changed) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work List template not found.', requestId: request.id } });
    return { data: { updated: true } };
  });

  app.get('/work-lists', async (request) => {
    const rows = await sql`
      select o.id, o.recurrence, o.period_date::text, o.due_at::text, o.status, o.location_snapshot, o.template_snapshot, o.worker_ids, o.overall_note, o.submitted_at::text, o.version,
        coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id and i.status is not null), 0) resolved_count,
        coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id and i.required), 0) required_count
      from work_list_occurrences o where ${manager(request.currentUser.roles) ? sql`true` : sql`${request.currentUser.id} = any(o.worker_ids)`}
      order by case when o.status in ('OPEN','OVERDUE') then 0 else 1 end, o.due_at desc limit 200`;
    return { data: rows };
  });

  app.get('/work-lists/:id', async (request, reply) => {
    const occurrenceId = id.parse((request.params as { id: string }).id);
    if (!await canAccessOccurrence(occurrenceId, request.currentUser.id, request.currentUser.roles)) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'You cannot access this Work List.', requestId: request.id } });
    const occurrences = await sql`select o.*, coalesce((select json_agg(json_build_object('id', i.id, 'title', i.title, 'instructions', i.instructions, 'required', i.required, 'sort_order', i.sort_order, 'status', i.status, 'note', i.note, 'resolved_by', u.full_name, 'resolved_at', i.resolved_at::text) order by i.sort_order) from work_list_occurrence_items i left join users u on u.id=i.resolved_by where i.occurrence_id=o.id), '[]'::json) items, coalesce((select json_agg(json_build_object('id', e.id, 'drive_url', e.drive_url, 'file_name', e.file_name, 'uploaded_by', u.full_name, 'created_at', e.created_at::text)) from work_list_evidence e join users u on u.id=e.uploaded_by where e.occurrence_id=o.id), '[]'::json) evidence from work_list_occurrences o where o.id=${occurrenceId}`;
    if (!occurrences[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work List not found.', requestId: request.id } });
    return { data: occurrences[0] };
  });

  app.patch('/work-lists/:occurrenceId/items/:itemId', async (request, reply) => {
    const occurrenceId = id.parse((request.params as { occurrenceId: string }).occurrenceId); const itemId = id.parse((request.params as { itemId: string }).itemId); const input = resolveSchema.parse(request.body);
    if (!await canAccessOccurrence(occurrenceId, request.currentUser.id, request.currentUser.roles)) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'You cannot update this Work List.', requestId: request.id } });
    const result = await sql.begin(async (tx) => {
      const occurrence = await tx<Array<{ version: number; status: string }>>`select version, status from work_list_occurrences where id=${occurrenceId} for update`;
      if (!occurrence[0]) return { error: 'NOT_FOUND' } as const; if (occurrence[0].version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const; if (occurrence[0].status.includes('SUBMITTED')) return { error: 'ALREADY_SUBMITTED' } as const;
      const changed = await tx`update work_list_occurrence_items set status=${input.status}::work_list_item_status, note=${input.note || null}, resolved_by=${request.currentUser.id}, resolved_at=now() where id=${itemId} and occurrence_id=${occurrenceId}`;
      if (!changed.count) return { error: 'ITEM_NOT_FOUND' } as const;
      await tx`update work_list_occurrences set version=version+1, updated_at=now() where id=${occurrenceId}`;
      await tx`insert into work_list_audit_events (occurrence_id, user_id, event_type, data) values (${occurrenceId}, ${request.currentUser.id}, 'ITEM_RESOLVED', ${tx.json({ itemId, status: input.status })})`;
      return { version: occurrence[0].version + 1 } as const;
    });
    if ('error' in result) return reply.code(result.error === 'NOT_FOUND' || result.error === 'ITEM_NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422).send({ error: { code: result.error, message: 'The Work List item could not be updated.', requestId: request.id } });
    return { data: result };
  });

  app.post('/work-lists/:id/evidence', async (request, reply) => {
    const occurrenceId = id.parse((request.params as { id: string }).id);
    if (!await canAccessOccurrence(occurrenceId, request.currentUser.id, request.currentUser.roles)) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'You cannot upload evidence for this Work List.', requestId: request.id } });
    const upload = await request.file(); if (!upload) return reply.code(400).send({ error: { code: 'FILE_REQUIRED', message: 'Choose a photo to upload.', requestId: request.id } });
    let prepared; try { prepared = await prepareEvidenceUpload({ fileName: upload.filename, mimeType: upload.mimetype, buffer: await upload.toBuffer() }); } catch { return reply.code(422).send({ error: { code: 'INVALID_FILE', message: 'The selected photo is not allowed.', requestId: request.id } }); }
    if (!prepared.mimeType.startsWith('image/')) return reply.code(422).send({ error: { code: 'PHOTO_REQUIRED', message: 'Work List evidence must be a photo.', requestId: request.id } });
    const drive = await uploadDriveFile({ folderId: (await import('./config.js')).config.GOOGLE_WORK_ORDERS_ROOT_FOLDER_ID, fileName: `work-list-${occurrenceId}-${prepared.fileName}`, mimeType: prepared.mimeType, buffer: prepared.buffer });
    const rows = await sql`insert into work_list_evidence (occurrence_id, drive_file_id, drive_url, file_name, original_file_name, mime_type, file_size, uploaded_by) values (${occurrenceId}, ${drive.id}, ${drive.webViewLink}, ${prepared.fileName}, ${prepared.originalFileName}, ${prepared.mimeType}, ${prepared.buffer.length}, ${request.currentUser.id}) returning id, drive_url`;
    return reply.code(201).send({ data: rows[0] });
  });

  app.post('/work-lists/:id/submit', async (request, reply) => {
    const occurrenceId = id.parse((request.params as { id: string }).id); const input = submitSchema.parse(request.body);
    if (!await canAccessOccurrence(occurrenceId, request.currentUser.id, request.currentUser.roles)) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'You cannot submit this Work List.', requestId: request.id } });
    const result = await sql.begin(async (tx) => {
      const rows = await tx<Array<{ version: number; status: string; due_at: string }>>`select version, status, due_at::text from work_list_occurrences where id=${occurrenceId} for update`; const occurrence = rows[0];
      if (!occurrence) return { error: 'NOT_FOUND' } as const; if (occurrence.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      const incomplete = await tx<Array<{ count: number }>>`select count(*)::int as count from work_list_occurrence_items where occurrence_id=${occurrenceId} and required and status is null`;
      const photos = await tx<Array<{ count: number }>>`select count(*)::int as count from work_list_evidence where occurrence_id=${occurrenceId}`;
      if (incomplete[0]!.count) return { error: 'REQUIRED_ITEMS_INCOMPLETE' } as const; if (!photos[0]!.count) return { error: 'PHOTO_REQUIRED' } as const;
      const late = new Date(occurrence.due_at) < new Date(); const status = late ? 'SUBMITTED_LATE' : 'SUBMITTED';
      await tx`update work_list_occurrences set status=${status}::work_list_occurrence_status, overall_note=${input.note}, submitted_at=now(), submitted_by=${request.currentUser.id}, version=version+1, updated_at=now() where id=${occurrenceId}`;
      await tx`insert into work_list_audit_events (occurrence_id, user_id, event_type, data) values (${occurrenceId}, ${request.currentUser.id}, 'SUBMITTED', ${tx.json({ status })})`;
      return { status, version: occurrence.version + 1 } as const;
    });
    if ('error' in result) return reply.code(result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422).send({ error: { code: result.error, message: 'Complete required items and upload at least one photo before submitting.', requestId: request.id } });
    return { data: result };
  });
}
