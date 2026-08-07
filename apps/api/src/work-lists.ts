import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireManager } from './auth.js';
import { generateWorkListOccurrences, localDateInTimeZone } from './background.js';
import { sql } from './database/client.js';
import { prepareEvidenceUpload } from './evidence.js';
import { deleteDriveFile, downloadDriveFile, uploadDriveFile } from './drive.js';

const id = z.string().uuid();
const itemSchema = z.object({ title: z.string().trim().min(2).max(300), instructions: z.string().trim().max(2_000).default(''), recurrence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), required: z.boolean().default(true) });
const templateSchema = z.object({ title: z.string().trim().min(3).max(200), instructions: z.string().trim().max(4_000).default(''), active: z.boolean().default(true), locationIds: z.array(id).min(1).max(100), workerIds: z.array(id).min(1).max(100), items: z.array(itemSchema).min(1).max(100) });
const resolveSchema = z.object({ status: z.enum(['NOT_APPLICABLE', 'ISSUE_FOUND']), note: z.string().trim().min(3).max(2_000) });
const completionNoteSchema = z.string().trim().max(2_000).default('');


function manager(roles: readonly string[]) { return roles.includes('ADMINISTRATOR') || roles.includes('FACILITIES_MANAGER'); }
async function occurrenceAccess(occurrenceId: string, userId: string, roles: readonly string[]): Promise<'ALLOWED' | 'MISSED' | 'FORBIDDEN' | 'NOT_FOUND'> {
  const rows = await sql<Array<{ status: string; assigned: boolean }>>`select status, ${userId} = any(worker_ids) as assigned from work_list_occurrences where id=${occurrenceId}`;
  const occurrence = rows[0];
  if (!occurrence) return 'NOT_FOUND';
  if (manager(roles)) return 'ALLOWED';
  if (!occurrence.assigned) return 'FORBIDDEN';
  return occurrence.status === 'MISSED' ? 'MISSED' : 'ALLOWED';
}

function accessError(access: 'MISSED' | 'FORBIDDEN' | 'NOT_FOUND', requestId: string) {
  if (access === 'NOT_FOUND') return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Work List not found.', requestId } } };
  if (access === 'MISSED') return { status: 403, body: { error: { code: 'MISSED', message: 'This Work List passed its deadline and was marked as missed.', requestId } } };
  return { status: 403, body: { error: { code: 'FORBIDDEN', message: 'You are no longer assigned to this Work List.', requestId } } };
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
    await generateWorkListOccurrences(localDateInTimeZone());
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
      await tx`update work_list_occurrences set worker_ids=${input.workerIds}::uuid[], version=version+1, updated_at=now() where template_id=${templateId} and status in ('OPEN', 'OVERDUE')`;
      await tx`insert into work_list_audit_events (template_id, user_id, event_type, data) values (${templateId}, ${request.currentUser.id}, 'TEMPLATE_UPDATED', ${tx.json({ title: input.title })})`;
      return true;
    });
    if (!changed) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work List template not found.', requestId: request.id } });
    return { data: { updated: true } };
  });

  app.get('/work-lists', async (request) => {
    const localDate = localDateInTimeZone();
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(200) }).parse(request.query);
    const rows = await sql`
      select o.id, o.template_id, o.template_version, o.recurrence, o.period_date::text, o.due_at::text, o.status, o.location_snapshot, o.template_snapshot, o.worker_ids, o.overall_note, o.submitted_at::text, o.version,
        coalesce((select json_agg(json_build_object('id', u.id, 'full_name', u.full_name, 'profile_photo_url', u.profile_photo_url) order by u.full_name) from users u where u.id = any(o.worker_ids)), '[]'::json) workers,
        coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id and i.required and i.status is not null), 0) required_resolved_count,
        coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id and i.required), 0) required_count,
        coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id), 0) item_count,
        coalesce((select json_agg(json_build_object('id', preview.id, 'title', preview.title, 'instructions', preview.instructions, 'required', preview.required, 'sort_order', preview.sort_order, 'status', preview.status, 'note', preview.note, 'resolved_by', preview.resolved_by) order by preview.sort_order) from (select i.id, i.title, i.instructions, i.required, i.sort_order, i.status, i.note, u.full_name as resolved_by from work_list_occurrence_items i left join users u on u.id=i.resolved_by where i.occurrence_id=o.id order by i.sort_order limit 3) preview), '[]'::json) preview_items
      from work_list_occurrences o where ${manager(request.currentUser.roles) ? sql`true` : sql`${request.currentUser.id} = any(o.worker_ids) and o.status not in ('OVERDUE', 'MISSED') and ((o.recurrence='DAILY' and o.period_date=${localDate}::date) or (o.recurrence='WEEKLY' and date_trunc('week', o.period_date::timestamp)=date_trunc('week', ${localDate}::date::timestamp)) or (o.recurrence='MONTHLY' and date_trunc('month', o.period_date::timestamp)=date_trunc('month', ${localDate}::date::timestamp)) )`}
      order by case when o.status='OPEN' then 0 when o.status='MISSED' then 1 else 2 end, o.due_at desc, o.id
      limit ${query.limit + 1} offset ${query.offset}`;
    const hasMore = rows.length > query.limit;
    return { data: rows.slice(0, query.limit), meta: { limit: query.limit, offset: query.offset, hasMore, nextOffset: hasMore ? query.offset + query.limit : null } };
  });

  app.get('/work-lists/:id', async (request, reply) => {
    const occurrenceId = id.parse((request.params as { id: string }).id);
    const access = await occurrenceAccess(occurrenceId, request.currentUser.id, request.currentUser.roles);
    if (access !== 'ALLOWED') { const denied = accessError(access, request.id); return reply.code(denied.status).send(denied.body); }
    const occurrences = await sql`select o.*, coalesce((select json_agg(json_build_object('id', i.id, 'title', i.title, 'instructions', i.instructions, 'required', i.required, 'sort_order', i.sort_order, 'status', i.status, 'note', i.note, 'resolved_by', u.full_name, 'resolved_at', i.resolved_at::text, 'evidence', coalesce((select json_agg(json_build_object('id', e.id, 'drive_url', '/work-lists/evidence/' || e.id, 'file_name', e.file_name, 'uploaded_by', eu.full_name, 'created_at', e.created_at::text) order by e.created_at) from work_list_evidence e join users eu on eu.id=e.uploaded_by where e.occurrence_item_id=i.id), '[]'::json)) order by i.sort_order) from work_list_occurrence_items i left join users u on u.id=i.resolved_by where i.occurrence_id=o.id), '[]'::json) items, coalesce((select json_agg(json_build_object('id', e.id, 'drive_url', '/work-lists/evidence/' || e.id, 'file_name', e.file_name, 'uploaded_by', u.full_name, 'created_at', e.created_at::text)) from work_list_evidence e join users u on u.id=e.uploaded_by where e.occurrence_id=o.id and e.occurrence_item_id is null), '[]'::json) evidence from work_list_occurrences o where o.id=${occurrenceId}`;
    if (!occurrences[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work List not found.', requestId: request.id } });
    return { data: occurrences[0] };
  });

  app.get('/work-lists/evidence/:evidenceId', async (request, reply) => {
    const evidenceId = id.parse((request.params as { evidenceId: string }).evidenceId);
    const rows = await sql<Array<{ occurrence_id: string; drive_file_id: string; file_name: string; mime_type: string }>>`select occurrence_id, drive_file_id, file_name, mime_type from work_list_evidence where id=${evidenceId}`;
    const evidence = rows[0];
    if (!evidence) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work List evidence not found.', requestId: request.id } });
    const access = await occurrenceAccess(evidence.occurrence_id, request.currentUser.id, request.currentUser.roles);
    if (access !== 'ALLOWED') { const denied = accessError(access, request.id); return reply.code(denied.status).send(denied.body); }
    const safeName = evidence.file_name.replaceAll(/[\r\n"]/g, '_');
    reply.header('Content-Type', evidence.mime_type);
    reply.header('Content-Disposition', `inline; filename="${safeName}"`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(await downloadDriveFile(evidence.drive_file_id));
  });

  app.patch('/work-lists/:occurrenceId/items/:itemId', async (request, reply) => {
    const occurrenceId = id.parse((request.params as { occurrenceId: string }).occurrenceId); const itemId = id.parse((request.params as { itemId: string }).itemId); const input = resolveSchema.parse(request.body);
    const access = await occurrenceAccess(occurrenceId, request.currentUser.id, request.currentUser.roles);
    if (access !== 'ALLOWED') { const denied = accessError(access, request.id); return reply.code(denied.status).send(denied.body); }
    const result = await sql.begin(async (tx) => {
      const occurrence = await tx<Array<{ version: number; status: string; due_at: string; worker_ids: string[] }>>`select version, status, due_at::text, worker_ids from work_list_occurrences where id=${occurrenceId} for update`;
      if (!occurrence[0]) return { error: 'NOT_FOUND' } as const;
      if (!manager(request.currentUser.roles) && !occurrence[0].worker_ids.includes(request.currentUser.id)) return { error: 'FORBIDDEN' } as const;
      if (['OPEN', 'OVERDUE'].includes(occurrence[0].status) && new Date(occurrence[0].due_at) < new Date()) {
        await tx`update work_list_occurrences set status='MISSED', version=version+1, updated_at=now() where id=${occurrenceId}`;
        return { error: 'MISSED' } as const;
      }
      if (occurrence[0].status === 'MISSED') return { error: 'MISSED' } as const;
      if (occurrence[0].status !== 'OPEN') return { error: 'ALREADY_SUBMITTED' } as const;

      const changed = await tx`update work_list_occurrence_items set status=${input.status}::work_list_item_status, note=${input.note || null}, resolved_by=${request.currentUser.id}, resolved_at=now() where id=${itemId} and occurrence_id=${occurrenceId} and status is null`;
      if (!changed.count) {
        const existing = await tx`select status from work_list_occurrence_items where id=${itemId} and occurrence_id=${occurrenceId}`;
        return { error: existing[0] ? 'ALREADY_RESOLVED' : 'ITEM_NOT_FOUND' } as const;
      }
      const unfinished = await tx<Array<{ count: number }>>`select count(*)::int as count from work_list_occurrence_items where occurrence_id=${occurrenceId} and status is null`;
      const complete = unfinished[0]!.count === 0;
      await tx`update work_list_occurrences set status=${complete ? 'SUBMITTED' : occurrence[0].status}::work_list_occurrence_status, submitted_at=${complete ? new Date() : null}, submitted_by=${complete ? request.currentUser.id : null}, version=version+1, updated_at=now() where id=${occurrenceId}`;
      await tx`insert into work_list_audit_events (occurrence_id, user_id, event_type, data) values (${occurrenceId}, ${request.currentUser.id}, 'ITEM_RESOLVED', ${tx.json({ itemId, status: input.status, occurrenceCompleted: complete })})`;
      return { version: occurrence[0].version + 1, occurrenceCompleted: complete } as const;
    });
    if ('error' in result) return reply.code(result.error === 'NOT_FOUND' || result.error === 'ITEM_NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : result.error === 'ALREADY_RESOLVED' || result.error === 'MISSED' ? 409 : 422).send({ error: { code: result.error, message: result.error === 'FORBIDDEN' ? 'You are no longer assigned to this Work List.' : result.error === 'ALREADY_RESOLVED' ? 'Another worker already updated this checklist item.' : result.error === 'MISSED' ? 'This Work List passed its deadline and was marked as missed.' : 'The Work List item could not be updated.', requestId: request.id } });
    return { data: result };
  });

  app.post('/work-lists/:occurrenceId/items/:itemId/complete', async (request, reply) => {
    const occurrenceId = id.parse((request.params as { occurrenceId: string }).occurrenceId);
    const itemId = id.parse((request.params as { itemId: string }).itemId);
    const access = await occurrenceAccess(occurrenceId, request.currentUser.id, request.currentUser.roles);
    if (access !== 'ALLOWED') { const denied = accessError(access, request.id); return reply.code(denied.status).send(denied.body); }
    const items = await sql`select 1 from work_list_occurrence_items where id=${itemId} and occurrence_id=${occurrenceId} and status is null`;
    if (!items[0]) return reply.code(409).send({ error: { code: 'ITEM_UNAVAILABLE', message: 'This checklist item has already been updated.', requestId: request.id } });
    let noteValue = '';
    let uploadedFile: { filename: string; mimetype: string; buffer: Buffer } | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname === 'file' && !uploadedFile) uploadedFile = { filename: part.filename, mimetype: part.mimetype, buffer };
      } else if (part.fieldname === 'note') noteValue = String(part.value ?? '');
    }
    if (!uploadedFile) return reply.code(400).send({ error: { code: 'FILE_REQUIRED', message: 'Choose a photo to upload.', requestId: request.id } });
    const note = completionNoteSchema.parse(noteValue);
    let prepared; try { prepared = await prepareEvidenceUpload({ fileName: uploadedFile.filename, mimeType: uploadedFile.mimetype, buffer: uploadedFile.buffer }); } catch { return reply.code(422).send({ error: { code: 'INVALID_FILE', message: 'The selected photo is not allowed.', requestId: request.id } }); }
    if (!prepared.mimeType.startsWith('image/')) return reply.code(422).send({ error: { code: 'PHOTO_REQUIRED', message: 'Checklist evidence must be a photo.', requestId: request.id } });
    const uploads = await sql<Array<{ id: string }>>`insert into work_list_evidence_uploads (occurrence_id, occurrence_item_id, uploaded_by) values (${occurrenceId}, ${itemId}, ${request.currentUser.id}) returning id`;
    const uploadId = uploads[0]!.id;
    let drive;
    try {
      drive = await uploadDriveFile({ folderId: (await import('./config.js')).config.GOOGLE_WORK_ORDERS_ROOT_FOLDER_ID, fileName: `work-list-${occurrenceId}-${itemId}-${prepared.fileName}`, mimeType: prepared.mimeType, buffer: prepared.buffer, appProperties: { workListEvidenceUploadId: uploadId } });
      await sql`update work_list_evidence_uploads set drive_file_id=${drive.id} where id=${uploadId} and status='PENDING'`;
    } catch (error) {
      throw error;
    }
    try {
      const result = await sql.begin(async (tx) => {
        const occurrences = await tx<Array<{ status: string; worker_ids: string[]; due_at: string }>>`select status, worker_ids, due_at::text from work_list_occurrences where id=${occurrenceId} for update`;
        const occurrence = occurrences[0];
        if (!occurrence) return { error: 'NOT_FOUND' } as const;
        if (!manager(request.currentUser.roles) && !occurrence.worker_ids.includes(request.currentUser.id)) return { error: 'FORBIDDEN' } as const;
        if (['OPEN', 'OVERDUE'].includes(occurrence.status) && new Date(occurrence.due_at) < new Date()) {
          await tx`update work_list_occurrences set status='MISSED', version=version+1, updated_at=now() where id=${occurrenceId}`;
          return { error: 'OCCURRENCE_CLOSED' } as const;
        }
        if (occurrence.status !== 'OPEN') return { error: 'OCCURRENCE_CLOSED' } as const;
        const items = await tx`select status from work_list_occurrence_items where id=${itemId} and occurrence_id=${occurrenceId} for update`;
        if (!items[0]) return { error: 'ITEM_NOT_FOUND' } as const;
        if (items[0].status) return { error: 'ITEM_UNAVAILABLE' } as const;
        const rows = await tx<Array<{ id: string }>>`insert into work_list_evidence (occurrence_id, occurrence_item_id, drive_file_id, drive_url, file_name, original_file_name, mime_type, file_size, uploaded_by) values (${occurrenceId}, ${itemId}, ${drive.id}, ${drive.webViewLink}, ${prepared.fileName}, ${prepared.originalFileName}, ${prepared.mimeType}, ${prepared.buffer.length}, ${request.currentUser.id}) returning id`;
        await tx`update work_list_occurrence_items set status='COMPLETED', note=${note || null}, resolved_by=${request.currentUser.id}, resolved_at=now() where id=${itemId}`;
        const unfinished = await tx<Array<{ count: number }>>`select count(*)::int as count from work_list_occurrence_items where occurrence_id=${occurrenceId} and status is null`;
        const complete = unfinished[0]!.count === 0;
        await tx`update work_list_occurrences set status=${complete ? 'SUBMITTED' : 'OPEN'}::work_list_occurrence_status, submitted_at=${complete ? new Date() : null}, submitted_by=${complete ? request.currentUser.id : null}, version=version+1, updated_at=now() where id=${occurrenceId}`;
        await tx`update work_list_evidence_uploads set status='COMPLETED', completed_at=now() where id=${uploadId} and status='PENDING'`;
        await tx`insert into work_list_audit_events (occurrence_id, user_id, event_type, data) values (${occurrenceId}, ${request.currentUser.id}, 'ITEM_RESOLVED', ${tx.json({ itemId, status: 'COMPLETED', occurrenceCompleted: complete })})`;
        return { data: { id: rows[0]!.id, drive_url: `/work-lists/evidence/${rows[0]!.id}`, occurrenceCompleted: complete } } as const;
      });
      if ('error' in result) {
        const deleted = await deleteDriveFile(drive.id).then(() => true).catch(() => false);
        if (deleted) await sql`update work_list_evidence_uploads set status='CANCELLED' where id=${uploadId} and status='PENDING'`;
        return reply.code(result.error === 'NOT_FOUND' || result.error === 'ITEM_NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 409).send({ error: { code: result.error, message: result.error === 'ITEM_UNAVAILABLE' ? 'Another worker already updated this checklist item.' : result.error === 'OCCURRENCE_CLOSED' ? 'This Work List is no longer open.' : 'The evidence could not be attached.', requestId: request.id } });
      }
      return reply.code(201).send(result);
    } catch (error) {
      let uploadStatus: 'PENDING' | 'COMPLETED' | 'CANCELLED';
      let committedEvidence: { id: string; drive_url: string; occurrence_completed: boolean } | undefined;
      try {
        const reconciliation = await sql<Array<{ status: 'PENDING' | 'COMPLETED' | 'CANCELLED'; evidence_id: string | null; drive_url: string | null; occurrence_completed: boolean }>>`
          select upload.status, evidence.id as evidence_id, evidence.drive_url,
            occurrence.status in ('SUBMITTED', 'SUBMITTED_LATE') as occurrence_completed
          from work_list_evidence_uploads upload
          join work_list_occurrences occurrence on occurrence.id=upload.occurrence_id
          left join work_list_evidence evidence on evidence.drive_file_id=upload.drive_file_id
          where upload.id=${uploadId}
        `;
        const reconciled = reconciliation[0];
        if (!reconciled) throw error;
        uploadStatus = reconciled.status;
        if (reconciled.status === 'COMPLETED' && reconciled.evidence_id && reconciled.drive_url) committedEvidence = { id: reconciled.evidence_id, drive_url: reconciled.drive_url, occurrence_completed: reconciled.occurrence_completed };
      } catch {
        throw error;
      }
      if (uploadStatus === 'COMPLETED' && committedEvidence) return reply.code(201).send({ data: { id: committedEvidence.id, drive_url: `/work-lists/evidence/${committedEvidence.id}`, occurrenceCompleted: committedEvidence.occurrence_completed } });
      if (uploadStatus === 'PENDING') {
        const deleted = await deleteDriveFile(drive.id).then(() => true).catch(() => false);
        if (deleted) await sql`update work_list_evidence_uploads set status='CANCELLED' where id=${uploadId} and status='PENDING'`;
      }
      throw error;
    }
  });

  app.post('/work-lists/:occurrenceId/items/:itemId/evidence', async (_request, reply) => reply.code(410).send({ error: { code: 'ATOMIC_COMPLETION_REQUIRED', message: 'Use the checklist-item completion endpoint so evidence and completion are saved together.', requestId: _request.id } }));

  app.post('/work-lists/:id/evidence', async (_request, reply) => reply.code(410).send({ error: { code: 'ITEM_EVIDENCE_REQUIRED', message: 'Upload evidence while completing an individual checklist item.', requestId: _request.id } }));

  app.post('/work-lists/:id/submit', async (_request, reply) => reply.code(410).send({ error: { code: 'ITEM_SUBMISSION_REQUIRED', message: 'Checklist items are finalized individually; location-level submission is no longer available.', requestId: _request.id } }));
}
