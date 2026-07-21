import type { FastifyInstance } from 'fastify';
import { changeConditionSchema, changeDueDateSchema, createWorkOrderSchema, evidenceRules, evidenceTypes, formatWorkOrderNumber, getDeadlineGroup, linkDriveEvidenceSchema, proposalDecisionSchema, proposalDecisionTargets, proposalSubmissionSchema, transferDriveEvidenceSchema, validateTransition, vendorSearchSchema, type EvidenceType, type Role, type TaskCondition, type WorkflowStage, type WorkType } from '@woko/domain';
import { z } from 'zod';
import { authenticate, requireManager } from './auth.js';
import { sql } from './database/client.js';
import { deleteDriveFile, extractDriveFileId, linkExistingDriveFile, provisionWorkOrderFolder, rollbackUserDriveTransfer, transferUserDriveFile, uploadDriveFile, type DriveSubfolderMap } from './drive.js';
import { isCompletionPhoto, prepareEvidenceUpload, validateLinkedDriveFile } from './evidence.js';

const participantsSchema = z.object({
  assigneeIds: z.array(z.string().uuid()).min(1).max(20),
  reviewerId: z.string().uuid().nullable(),
  overseerIds: z.array(z.string().uuid()).max(50),
  reason: z.string().trim().min(3).max(1000),
  expectedVersion: z.number().int().positive(),
}).superRefine((value, context) => {
  if (new Set(value.assigneeIds).size !== value.assigneeIds.length || new Set(value.overseerIds).size !== value.overseerIds.length) {
    context.addIssue({ code: 'custom', message: 'People may only be selected once.' });
  }
  if (value.reviewerId && value.assigneeIds.includes(value.reviewerId)) {
    context.addIssue({ code: 'custom', path: ['reviewerId'], message: 'Reviewer must be different from every person in charge.' });
  }
  const core = new Set([...value.assigneeIds, ...(value.reviewerId ? [value.reviewerId] : [])]);
  if (value.overseerIds.some((id) => core.has(id))) {
    context.addIssue({ code: 'custom', path: ['overseerIds'], message: 'Overseers must be different from the PIC and reviewer.' });
  }
});

const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

const progressUpdateSchema = z.object({
  note: z.string().trim().min(3).max(2000),
  expectedVersion: z.number().int().positive(),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
});

const prioritySchema = z.object({
  priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']),
  reason: z.string().trim().min(3).max(1000),
  expectedVersion: z.number().int().positive(),
});

const transitionSchema = z.object({
  toStage: z.enum(['PLANNED', 'FINDING_VENDOR', 'PROPOSAL', 'APPROVAL', 'SCHEDULED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED']),
  note: z.string().trim().min(3).max(2000),
  reason: z.string().trim().max(1000).optional(),
  expectedVersion: z.number().int().positive(),

  completionEvidenceWaiverReason: z.string().trim().max(1000).optional(),
  plannedStartDate: z.string().date().optional(),
  completionSummary: z.string().trim().max(2000).optional(),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
});

interface WorkOrderRow {
  id: string;
  work_order_number: string;
  title: string;
  description: string;
  category: string;
  work_type: WorkType;
  priority: string;
  condition: string;
  workflow_stage: WorkflowStage;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  due_date: string;
  planned_start_date: string | null;
  room_or_area: string;
  floor: string | null;
  building: string;
  campus: string;
  assignee_id: string;
  assignee_name: string;
  assignee_email: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  assignees: Array<{ id: string; full_name: string; email: string }>;
  overseers: Array<{ id: string; full_name: string; email: string }>;
  drive_folder_url: string | null;
  drive_provisioning_status: 'PROVISIONING' | 'COMPLETE' | 'FAILED';
  drive_provisioning_error: string | null;
  drive_subfolders: Partial<DriveSubfolderMap>;
  version: number;
  created_at: string;
  updated_at: string;
}

function isManager(roles: readonly Role[]): boolean {
  return roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
}

export function canDecideProposal(approverId: string, picIds: readonly string[]): boolean {
  return !picIds.includes(approverId);
}

export function canRecordMidProgress(status: string, stage: WorkflowStage): boolean {
  return status === 'ACTIVE' && stage === 'IN_PROGRESS';
}

async function isWorkOrderPic(workOrderId: string, userId: string): Promise<boolean> {
  const rows = await sql`select 1 from work_order_assignees where work_order_id = ${workOrderId} and user_id = ${userId} limit 1`;
  return rows.length > 0;
}

function participantsHaveEligibleRoles(participants: Array<{ id: string; roles: Role[] }>, input: { assigneeIds: string[]; reviewerId?: string | null; overseerIds: string[] }): boolean {
  const rolesByUser = new Map(participants.map((participant) => [participant.id, participant.roles]));
  const picsValid = input.assigneeIds.every((id) => rolesByUser.get(id)?.includes('PERSON_IN_CHARGE') === true);
  const reviewerValid = !input.reviewerId || rolesByUser.get(input.reviewerId)?.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER') === true;
  const overseersValid = input.overseerIds.every((id) => rolesByUser.get(id)?.includes('OVERSEER') === true);
  return picsValid && reviewerValid && overseersValid;
}

async function canDiscussProgress(workOrderId: string, userId: string, roles: readonly Role[]): Promise<boolean> {
  if (isManager(roles)) return true;
  const rows = await sql`
    select 1 from work_orders wo where wo.id = ${workOrderId} and wo.reviewer_id = ${userId}
    union all select 1 from work_order_assignees where work_order_id = ${workOrderId} and user_id = ${userId}
    union all select 1 from work_order_overseers where work_order_id = ${workOrderId} and user_id = ${userId}
    limit 1
  `;
  return rows.length > 0;
}

function provisioningErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2000) : 'Unknown Google Drive provisioning error.';
}

async function provisionAndRecord(workOrderId: string, number: string, title: string, actorId: string, correlationId: string) {
  try {
    const provisioned = await provisionWorkOrderFolder(number, title);
    await sql.begin(async (transaction) => {
      await transaction`
        update work_orders set drive_folder_id = ${provisioned.folderId}, drive_folder_url = ${provisioned.folderUrl},
          drive_subfolders = ${transaction.json(provisioned.subfolders)}, drive_provisioning_status = 'COMPLETE',
          drive_provisioning_error = null, drive_provisioning_attempted_at = now(), updated_at = now()
        where id = ${workOrderId}
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, new_data, correlation_id)
        values (${workOrderId}, ${actorId}, 'DRIVE_FOLDER_PROVISIONED', ${transaction.json({ folderId: provisioned.folderId, subfolders: provisioned.subfolders })}, ${correlationId})
      `;
    });
    return { status: 'COMPLETE' as const, ...provisioned };
  } catch (error) {
    const message = provisioningErrorMessage(error);
    await sql.begin(async (transaction) => {
      await transaction`
        update work_orders set drive_provisioning_status = 'FAILED', drive_provisioning_error = ${message},
          drive_provisioning_attempted_at = now(), updated_at = now() where id = ${workOrderId}
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, new_data, reason, correlation_id)
        values (${workOrderId}, ${actorId}, 'DRIVE_FOLDER_PROVISIONING_FAILED', ${transaction.json({ status: 'FAILED' })}, ${message}, ${correlationId})
      `;
    });
    return { status: 'FAILED' as const, error: message };
  }
}

const selectWorkOrders = sql`
  select wo.id, wo.work_order_number, wo.title, wo.description, wo.category,
    wo.work_type, wo.priority, wo.condition, wo.workflow_stage, wo.status,
    wo.due_date::text, wo.planned_start_date::text, wo.room_or_area, wo.floor,
    b.name as building, c.name as campus,
    a.id as assignee_id, a.full_name as assignee_name, a.email::text as assignee_email,
    r.id as reviewer_id, r.full_name as reviewer_name,
    coalesce(assignees.items, '[]'::json) as assignees,
    coalesce(overseers.items, '[]'::json) as overseers,
    wo.drive_folder_url, wo.drive_provisioning_status,
    wo.drive_provisioning_error, wo.drive_subfolders,
    wo.version, wo.created_at::text, wo.updated_at::text
  from work_orders wo
  join buildings b on b.id = wo.building_id
  join campuses c on c.id = wo.campus_id
  join users a on a.id = wo.primary_assignee_id
  left join users r on r.id = wo.reviewer_id
  left join lateral (
    select json_agg(json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email::text) order by (u.id = wo.primary_assignee_id) desc, u.full_name) as items
    from work_order_assignees wa join users u on u.id = wa.user_id
    where wa.work_order_id = wo.id
  ) assignees on true
  left join lateral (
    select json_agg(json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email::text) order by u.full_name) as items
    from work_order_overseers wov join users u on u.id = wov.user_id
    where wov.work_order_id = wo.id
  ) overseers on true
`;

export async function workOrderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/me', async (request) => ({ data: request.currentUser }));

  app.get('/reference-data', async () => {
    const [users, campuses, buildings, locationOptions, workOptions, periods] = await Promise.all([
      sql`
        select u.id, u.full_name, u.email::text,
          coalesce(array_agg(ur.role) filter (where ur.role is not null), '{}') as roles
        from users u left join user_roles ur on ur.user_id = u.id
        where u.active = true group by u.id order by u.full_name
      `,
      sql`select id, name from campuses where active = true order by name`,
      sql`select id, campus_id, name from buildings where active = true and removed_at is null order by name`,
      sql`
        select lo.id, lo.building_id, lo.parent_id, lo.type_label, lo.name, lo.sort_order
        from location_options lo
        join buildings b on b.id = lo.building_id
        join campuses c on c.id = b.campus_id
        where lo.active = true and lo.removed_at is null and b.active = true and b.removed_at is null and c.active = true
        order by lo.sort_order, lo.name
      `,
      sql`
        select option_type, code, label, sort_order from organization_work_options
        where active = true and removed_at is null order by option_type, sort_order, label
      `,
      sql`select name, type, start_date::text, end_date::text, academic_year_label from academic_periods where active = true order by start_date`,
    ]);
    return { data: { users, campuses, buildings, locationOptions, workOptions, periods } };
  });

  app.get('/approvals', { preHandler: requireManager }, async (request) => {
    const [proposalApprovals, completionReviews] = await Promise.all([
      sql`
        select wo.id, wo.work_order_number, wo.title, wo.priority, wo.due_date::text,
          wo.version, wo.workflow_stage, assignee.full_name as assignee_name,
          proposal.structured_data as proposal_data, proposal.created_at::text as submitted_at,
          submitter.id as submitted_by_id, submitter.full_name as submitted_by_name,
          not exists (
            select 1 from work_order_assignees decision_pic
            where decision_pic.work_order_id = wo.id and decision_pic.user_id = ${request.currentUser.id}
          ) as can_decide
        from work_orders wo
        join users assignee on assignee.id = wo.primary_assignee_id
        join lateral (
          select pu.structured_data, pu.created_at, pu.created_by
          from progress_updates pu
          where pu.work_order_id = wo.id and pu.update_type = 'PROPOSAL_SUBMISSION'
          order by pu.created_at desc limit 1
        ) proposal on true
        join users submitter on submitter.id = proposal.created_by
        where wo.work_type = 'VENDOR' and wo.workflow_stage = 'APPROVAL' and wo.status = 'ACTIVE'
        order by wo.priority, proposal.created_at
      `,
      sql`
        select wo.id, wo.work_order_number, wo.title, wo.priority, wo.due_date::text,
          wo.version, wo.workflow_stage, assignee.full_name as assignee_name,
          submission.note as completion_summary, submission.created_at::text as submitted_at,
          submitter.id as submitted_by_id, submitter.full_name as submitted_by_name,
          coalesce(evidence.items, '[]'::json) as completion_evidence,
          coalesce(history.items, '[]'::json) as decision_history
        from work_orders wo
        join users assignee on assignee.id = wo.primary_assignee_id
        join lateral (
          select coalesce(nullif(pu.structured_data->>'completionSummary', ''), pu.note) as note, pu.created_at, pu.created_by
          from progress_updates pu
          where pu.work_order_id = wo.id and pu.update_type = 'REVIEW_SUBMISSION'
          order by pu.created_at desc limit 1
        ) submission on true
        join users submitter on submitter.id = submission.created_by
        left join lateral (
          select json_agg(json_build_object(
            'id', a.id,
            'file_name', a.file_name,
            'mime_type', a.mime_type,
            'drive_url', a.drive_url,
            'uploaded_by', uploader.full_name,
            'created_at', a.created_at::text
          ) order by a.created_at desc) as items
          from attachments a
          join users uploader on uploader.id = a.uploaded_by
          where a.work_order_id = wo.id and a.evidence_type = 'COMPLETION' and a.removed_at is null
        ) evidence on true
        left join lateral (
          select json_agg(json_build_object(
            'id', decision.id,
            'decision', case when decision.new_stage = 'COMPLETED' then 'APPROVED' else 'REJECTED' end,
            'note', decision.note,
            'waiver_reason', decision.structured_data->>'completionEvidenceWaiverReason',
            'decided_by', reviewer.full_name,
            'decided_at', decision.created_at::text
          ) order by decision.created_at desc) as items
          from progress_updates decision
          join users reviewer on reviewer.id = decision.created_by
          where decision.work_order_id = wo.id and (
            decision.update_type = 'REVIEW_DECISION'
            or (decision.update_type = 'STAGE_TRANSITION' and decision.previous_stage = 'REVIEW' and decision.new_stage = 'IN_PROGRESS')
          )
        ) history on true
        where wo.workflow_stage = 'REVIEW' and wo.status = 'ACTIVE'
        order by wo.priority, submission.created_at
      `,
    ]);
    return { data: { proposalApprovals, completionReviews } };
  });

  app.get('/work-orders', async (request) => {
    const query = z.object({ scope: z.enum(['all', 'mine']).default('all'), status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional() }).parse(request.query);
    const rows = query.scope === 'mine'
      ? await sql<WorkOrderRow[]>`${selectWorkOrders} where exists (select 1 from work_order_assignees mine where mine.work_order_id = wo.id and mine.user_id = ${request.currentUser.id}) ${query.status ? sql`and wo.status = ${query.status}` : sql``} order by wo.due_date, wo.updated_at`
      : await sql<WorkOrderRow[]>`${selectWorkOrders} ${query.status ? sql`where wo.status = ${query.status}` : sql``} order by wo.due_date, wo.updated_at`;
    const periods = await sql<Array<{ type: string; end_date: string }>>`select type, end_date::text from academic_periods where active = true`;
    const semesterEnd = periods.find((period) => period.type === 'SEMESTER')?.end_date;
    const academicYearEnd = periods.find((period) => period.type === 'ACADEMIC_YEAR')?.end_date;
    return {
      data: rows.map((row) => ({ ...row, deadlineGroup: getDeadlineGroup({ dueDate: row.due_date, status: row.status, today: new Date(), semesterEnd, academicYearEnd }) })),
    };
  });

  app.get('/work-orders/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rows = await sql<WorkOrderRow[]>`${selectWorkOrders} where wo.id = ${id}`;
    if (!rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work order not found.', requestId: request.id } });
    const [updates, audits, attachments, periods] = await Promise.all([
      sql`
        select pu.id, pu.update_type, pu.previous_stage, pu.new_stage, pu.note,
          pu.structured_data, pu.created_at::text, u.full_name as author,
          coalesce(comments.items, '[]'::json) as comments
        from progress_updates pu join users u on u.id = pu.created_by
        left join lateral (
          select json_agg(json_build_object(
            'id', puc.id,
            'body', puc.body,
            'author_id', commenter.id,
            'author', commenter.full_name,
            'created_at', puc.created_at::text
          ) order by puc.created_at) as items
          from progress_update_comments puc join users commenter on commenter.id = puc.created_by
          where puc.progress_update_id = pu.id
        ) comments on true
        where pu.work_order_id = ${id} order by pu.created_at desc
      `,
      sql`
        select ae.id, ae.event_type, ae.previous_data, ae.new_data, ae.reason,
          ae.created_at::text, u.full_name as author
        from audit_events ae left join users u on u.id = ae.user_id
        where ae.work_order_id = ${id} order by ae.created_at desc
      `,
      sql`
        select a.id, a.evidence_type, a.source_type, a.file_name, a.original_file_name,
          a.mime_type, a.file_size, a.drive_url, a.created_at::text, u.full_name as uploaded_by
        from attachments a join users u on u.id = a.uploaded_by
        where a.work_order_id = ${id} and a.removed_at is null
        order by a.created_at desc
      `,
      sql<Array<{ type: string; end_date: string }>>`select type, end_date::text from academic_periods where active = true`,
    ]);
    const semesterEnd = periods.find((period) => period.type === 'SEMESTER')?.end_date;
    const academicYearEnd = periods.find((period) => period.type === 'ACADEMIC_YEAR')?.end_date;
    const deadlineGroup = getDeadlineGroup({ dueDate: rows[0].due_date, status: rows[0].status, today: new Date(), semesterEnd, academicYearEnd });
    return { data: { ...rows[0], deadlineGroup, updates, audits, attachments } };
  });

  app.post('/work-orders/:id/progress/:progressUpdateId/comments', async (request, reply) => {
    const { id, progressUpdateId } = z.object({ id: z.string().uuid(), progressUpdateId: z.string().uuid() }).parse(request.params);
    const input = commentSchema.parse(request.body);
    if (!(await canDiscussProgress(id, request.currentUser.id, request.currentUser.roles))) {
      return reply.code(403).send({ error: { code: 'DISCUSSION_ACCESS_DENIED', message: 'Only a PIC, reviewer, or overseer may join this discussion.', requestId: request.id } });
    }
    const result = await sql.begin(async (transaction) => {
      const updates = await transaction<Array<{ work_order_number: string; title: string }>>`
        select wo.work_order_number, wo.title from progress_updates pu
        join work_orders wo on wo.id = pu.work_order_id
        where pu.id = ${progressUpdateId} and pu.work_order_id = ${id}
      `;
      const workOrder = updates[0];
      if (!workOrder) return { error: 'PROGRESS_UPDATE_NOT_FOUND' } as const;
      const comments = await transaction<Array<{ id: string; created_at: string }>>`
        insert into progress_update_comments (progress_update_id, work_order_id, body, created_by)
        values (${progressUpdateId}, ${id}, ${input.body}, ${request.currentUser.id})
        returning id, created_at::text
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select recipients.user_id, ${id}, 'PROGRESS_COMMENT', ${`${workOrder.work_order_number}: new progress comment`}, ${`${request.currentUser.fullName}: ${input.body}`}
        from (
          select user_id from work_order_assignees where work_order_id = ${id}
          union select reviewer_id from work_orders where id = ${id} and reviewer_id is not null
          union
          select distinct puc.created_by as user_id
          from progress_update_comments puc
          join work_order_overseers wov on wov.work_order_id = puc.work_order_id and wov.user_id = puc.created_by
          where puc.progress_update_id = ${progressUpdateId}
        ) recipients
        where recipients.user_id <> ${request.currentUser.id}
      `;
      return { id: comments[0]!.id, body: input.body, author_id: request.currentUser.id, author: request.currentUser.fullName, created_at: comments[0]!.created_at } as const;
    });
    if ('error' in result) return reply.code(404).send({ error: { code: result.error, message: 'Progress update not found.', requestId: request.id } });
    return reply.code(201).send({ data: result });
  });

  app.post('/work-orders', { preHandler: requireManager }, async (request, reply) => {
    const input = createWorkOrderSchema.parse(request.body);
    const idempotencyKey = z.string().min(8).max(200).parse(request.headers['idempotency-key']);
    const result = await sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;
      const existing = await transaction<Array<{ user_id: string; response_status: number; response_body: { data: { id: string; number: string } } }>>`
        select user_id, response_status, response_body from idempotency_keys
        where key = ${idempotencyKey} and request_path = '/api/v1/work-orders'
      `;
      if (existing[0]) {
        if (existing[0].user_id !== request.currentUser.id) return { error: 'IDEMPOTENCY_KEY_CONFLICT' } as const;
        return { existing: existing[0] } as const;
      }
      const configuredOptions = await transaction<Array<{ option_type: string; code: string }>>`
        select option_type, code from organization_work_options
        where active = true and removed_at is null and (
          (option_type = 'CATEGORY' and code = ${input.category})
          or (option_type = 'WORK_TYPE' and code = ${input.workType})
          or (option_type = 'EXECUTION_WINDOW' and code = ${input.executionWindow})
        )
      `;
      if (!configuredOptions.some((option) => option.option_type === 'CATEGORY') || !configuredOptions.some((option) => option.option_type === 'WORK_TYPE') || !configuredOptions.some((option) => option.option_type === 'EXECUTION_WINDOW')) return { error: 'INVALID_WORK_CONFIGURATION' } as const;
      const buildings = await transaction<Array<{ campus_id: string }>>`
        select campus_id from buildings where id = ${input.buildingId} and active = true and removed_at is null
      `;
      if (!buildings[0] || buildings[0].campus_id !== input.campusId) return { error: 'INVALID_LOCATION' } as const;
      let locationSnapshot = { roomOrArea: 'Whole building', floor: null as string | null };
      if (input.locationOptionId) {
        const locations = await transaction<Array<{ display_path: string; floor_name: string | null; all_active: boolean }>>`
          with recursive location_path as (
            select id, parent_id, type_label, name, active, 0 as depth
            from location_options
            where id = ${input.locationOptionId} and building_id = ${input.buildingId} and removed_at is null
            union all
            select parent.id, parent.parent_id, parent.type_label, parent.name, parent.active, child.depth + 1
            from location_options parent join location_path child on child.parent_id = parent.id
          )
          select string_agg(name, ' · ' order by depth desc) as display_path,
            max(name) filter (where type_label = 'FLOOR') as floor_name,
            bool_and(active) as all_active
          from location_path
        `;
        if (!locations[0]?.display_path || !locations[0].all_active) return { error: 'INVALID_LOCATION' } as const;
        locationSnapshot = { roomOrArea: locations[0].display_path, floor: locations[0].floor_name };
      }
      const participantIds = [...new Set([...input.assigneeIds, ...(input.reviewerId ? [input.reviewerId] : []), ...input.overseerIds])];
      const activeParticipants = await transaction<Array<{ id: string; roles: Role[] }>>`
        select u.id, coalesce(array_agg(ur.role) filter (where ur.role is not null), '{}') as roles
        from users u left join user_roles ur on ur.user_id = u.id
        where u.active = true and u.id = any(${participantIds}::uuid[]) group by u.id
      `;
      if (activeParticipants.length !== participantIds.length) return { error: 'INVALID_PARTICIPANT' } as const;
      if (!participantsHaveEligibleRoles(activeParticipants, input)) return { error: 'PARTICIPANT_ROLE_MISMATCH' } as const;
      const year = Number(input.dueDate.slice(0, 4));
      const sequenceRows = await transaction<Array<{ last_value: number }>>`
        insert into work_order_sequences (year, last_value) values (${year}, 1)
        on conflict (year) do update set last_value = work_order_sequences.last_value + 1
        returning last_value
      `;
      const number = formatWorkOrderNumber(year, sequenceRows[0]!.last_value);
      const rows = await transaction<Array<{ id: string }>>`
        insert into work_orders (
          work_order_number, title, description, category, campus_id, building_id, location_option_id, floor,
          room_or_area, work_type, priority, due_date, planned_start_date,
          execution_window, execution_window_note, primary_assignee_id, reviewer_id, created_by_id
        ) values (
          ${number}, ${input.title}, ${input.description}, ${input.category}, ${input.campusId}, ${input.buildingId}, ${input.locationOptionId ?? null}, ${locationSnapshot.floor},
          ${locationSnapshot.roomOrArea}, ${input.workType}, ${input.priority}, ${input.dueDate}, ${input.plannedStartDate ?? null},
          ${input.executionWindow}, ${input.executionWindowNote ?? null}, ${input.assigneeIds[0]!}, ${input.reviewerId ?? null}, ${request.currentUser.id}
        ) returning id
      `;
      const id = rows[0]!.id;
      await transaction`
        insert into work_order_assignees (work_order_id, user_id, added_by)
        select ${id}, participant.user_id, ${request.currentUser.id}
        from unnest(${input.assigneeIds}::uuid[]) participant(user_id)
      `;
      if (input.overseerIds.length) await transaction`
        insert into work_order_overseers (work_order_id, user_id, added_by)
        select ${id}, participant.user_id, ${request.currentUser.id}
        from unnest(${input.overseerIds}::uuid[]) participant(user_id)
      `;
      await transaction`
        insert into progress_updates (work_order_id, update_type, new_stage, note, structured_data, created_by)
        values (${id}, 'STAGE_TRANSITION', 'PLANNED', ${input.planSummary}, ${transaction.json({ planSummary: input.planSummary })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, new_data, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_ORDER_CREATED', ${transaction.json({ number, title: input.title })}, ${request.id})
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select participant.user_id, ${id}, 'ASSIGNMENT', ${`Assigned: ${number}`}, ${input.title}
        from unnest(${input.assigneeIds}::uuid[]) participant(user_id)
      `;
      await transaction`
        insert into idempotency_keys (key, user_id, request_path, response_status, response_body)
        values (${idempotencyKey}, ${request.currentUser.id}, '/api/v1/work-orders', 201, ${transaction.json({ data: { id, number } })})
      `;
      return { id, number } as const;
    });
    if ('error' in result) {
      const error = String(result.error);
      const status = ['INVALID_LOCATION', 'INVALID_WORK_CONFIGURATION', 'INVALID_PARTICIPANT', 'PARTICIPANT_ROLE_MISMATCH'].includes(error) ? 422 : 409;
      const message = error === 'INVALID_LOCATION' ? 'Select an active location that belongs to the selected campus and building.' : error === 'INVALID_WORK_CONFIGURATION' ? 'Select active work options from Organization Settings.' : error === 'INVALID_PARTICIPANT' ? 'Select active users for every project role.' : error === 'PARTICIPANT_ROLE_MISMATCH' ? 'PICs must have the PIC role, Reviewers must be managers, and Overseers must have the Overseer role.' : 'This submission key is already in use.';
      return reply.code(status).send({ error: { code: error, message, requestId: request.id } });
    }
    if ('existing' in result && result.existing) return reply.code(result.existing.response_status).send(result.existing.response_body);
    const provisioning = await provisionAndRecord(result.id, result.number, input.title, request.currentUser.id, request.id);
    return reply.code(201).send({ data: { ...result, driveProvisioningStatus: provisioning.status } });
  });

  app.post('/work-orders/:id/drive/retry', { preHandler: requireManager }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rows = await sql<Array<{ work_order_number: string; title: string; drive_provisioning_status: string }>>`
      select work_order_number, title, drive_provisioning_status from work_orders where id = ${id}
    `;
    const workOrder = rows[0];
    if (!workOrder) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work order not found.', requestId: request.id } });
    if (workOrder.drive_provisioning_status !== 'FAILED') return reply.code(422).send({ error: { code: 'PROVISIONING_NOT_FAILED', message: 'Only failed provisioning can be retried.', requestId: request.id } });
    await sql`update work_orders set drive_provisioning_status = 'PROVISIONING', drive_provisioning_error = null, updated_at = now() where id = ${id}`;
    const result = await provisionAndRecord(id, workOrder.work_order_number, workOrder.title, request.currentUser.id, request.id);
    return { data: result };
  });

  app.post('/work-orders/:id/attachments/upload', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const upload = await request.file({ limits: { files: 1, fileSize: evidenceRules.maxFileSizeBytes, fields: 3, parts: 4 } });
    if (!upload) return reply.code(400).send({ error: { code: 'FILE_REQUIRED', message: 'Choose a file to upload.', requestId: request.id } });
    const fieldValue = (name: string) => {
      const field = upload.fields[name];
      return field && !Array.isArray(field) && field.type === 'field' ? String(field.value) : undefined;
    };
    const input = z.object({ evidenceType: z.enum(evidenceTypes), expectedVersion: z.coerce.number().int().positive() }).parse({ evidenceType: fieldValue('evidenceType'), expectedVersion: fieldValue('expectedVersion') });
    const rows = await sql<Array<{ version: number; primary_assignee_id: string; drive_provisioning_status: string; drive_subfolders: Partial<DriveSubfolderMap> }>>`
      select version, primary_assignee_id, drive_provisioning_status, drive_subfolders from work_orders where id = ${id}
    `;
    const workOrder = rows[0];
    if (!workOrder) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work order not found.', requestId: request.id } });
    if (workOrder.version !== input.expectedVersion) return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'Reload the work order before uploading.', requestId: request.id } });
    if (!isManager(request.currentUser.roles) && !(await isWorkOrderPic(id, request.currentUser.id))) return reply.code(403).send({ error: { code: 'NOT_ASSIGNED', message: 'Only a PIC or Facilities Manager can add evidence.', requestId: request.id } });
    if (workOrder.drive_provisioning_status !== 'COMPLETE') return reply.code(422).send({ error: { code: 'DRIVE_NOT_READY', message: 'The work-order Drive folder is not ready.', requestId: request.id } });
    const folderId = workOrder.drive_subfolders[input.evidenceType];
    if (!folderId) return reply.code(422).send({ error: { code: 'DRIVE_SUBFOLDER_MISSING', message: 'The evidence subfolder is missing.', requestId: request.id } });
    const existing = await sql<Array<{ count: number }>>`select count(*)::int as count from attachments where work_order_id = ${id} and evidence_type = ${input.evidenceType} and removed_at is null`;
    if ((existing[0]?.count ?? 0) >= evidenceRules.maxFilesPerType) return reply.code(422).send({ error: { code: 'FILE_COUNT_LIMIT', message: `A maximum of ${evidenceRules.maxFilesPerType} files is allowed per evidence type.`, requestId: request.id } });

    let prepared;
    try {
      prepared = await prepareEvidenceUpload({ fileName: upload.filename, mimeType: upload.mimetype, buffer: await upload.toBuffer() });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_FILE';
      return reply.code(code === 'FILE_SIZE_NOT_ALLOWED' ? 413 : 422).send({ error: { code, message: 'The selected file type, extension, content, or size is not allowed.', requestId: request.id } });
    }
    const driveFile = await uploadDriveFile({ folderId, fileName: prepared.fileName, mimeType: prepared.mimeType, buffer: prepared.buffer });
    const result = await sql.begin(async (transaction) => {
      const locked = await transaction<Array<{ version: number }>>`select version from work_orders where id = ${id} for update`;
      if (locked[0]?.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      const counts = await transaction<Array<{ count: number }>>`select count(*)::int as count from attachments where work_order_id = ${id} and evidence_type = ${input.evidenceType} and removed_at is null`;
      if ((counts[0]?.count ?? 0) >= evidenceRules.maxFilesPerType) return { error: 'FILE_COUNT_LIMIT' } as const;
      const attachments = await transaction<Array<{ id: string }>>`
        insert into attachments (work_order_id, drive_file_id, drive_url, file_name, original_file_name, mime_type, file_size, drive_subfolder_type, evidence_type, source_type, uploaded_by)
        values (${id}, ${driveFile.id}, ${driveFile.webViewLink}, ${prepared.fileName}, ${prepared.originalFileName}, ${prepared.mimeType}, ${prepared.buffer.length}, ${input.evidenceType}, ${input.evidenceType}, 'UPLOAD', ${request.currentUser.id}) returning id
      `;
      await transaction`update work_orders set version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, note, structured_data, created_by)
        values (${id}, 'FILE_EVIDENCE_ADDED', ${`Added ${input.evidenceType.toLowerCase()} evidence: ${prepared.fileName}`}, ${transaction.json({ attachmentId: attachments[0]!.id, evidenceType: input.evidenceType, sourceType: 'UPLOAD' })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, new_data, correlation_id)
        values (${id}, ${request.currentUser.id}, 'FILE_EVIDENCE_ADDED', ${transaction.json({ attachmentId: attachments[0]!.id, evidenceType: input.evidenceType, driveFileId: driveFile.id })}, ${request.id})
      `;
      return { id: attachments[0]!.id, version: input.expectedVersion + 1, driveUrl: driveFile.webViewLink } as const;
    });
    if ('error' in result) {
      await deleteDriveFile(driveFile.id).catch(() => undefined);
      return reply.code(result.error === 'VERSION_CONFLICT' ? 409 : 422).send({ error: { code: result.error, message: 'The evidence could not be recorded. Reload and try again.', requestId: request.id } });
    }
    return reply.code(201).send({ data: result });
  });



  app.post('/work-orders/:id/attachments/drive-transfer', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = transferDriveEvidenceSchema.parse(request.body);
    const accessToken = z.string().min(20).parse(request.headers['x-google-drive-token']);
    const rows = await sql<Array<{ version: number; primary_assignee_id: string; drive_provisioning_status: string; drive_subfolders: Partial<DriveSubfolderMap> }>>`
      select version, primary_assignee_id, drive_provisioning_status, drive_subfolders from work_orders where id = ${id}
    `;
    const workOrder = rows[0];
    if (!workOrder) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work order not found.', requestId: request.id } });
    if (workOrder.version !== input.expectedVersion) return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'Reload the work order before adding evidence.', requestId: request.id } });
    if (!isManager(request.currentUser.roles) && !(await isWorkOrderPic(id, request.currentUser.id))) return reply.code(403).send({ error: { code: 'NOT_ASSIGNED', message: 'Only a PIC or Facilities Manager can add evidence.', requestId: request.id } });
    if (workOrder.drive_provisioning_status !== 'COMPLETE') return reply.code(422).send({ error: { code: 'DRIVE_NOT_READY', message: 'The work-order Drive folder is not ready.', requestId: request.id } });
    const folderId = workOrder.drive_subfolders[input.evidenceType];
    if (!folderId) return reply.code(422).send({ error: { code: 'DRIVE_NOT_READY', message: 'The evidence folder is not ready.', requestId: request.id } });

    let transferred;
    try {
      transferred = await transferUserDriveFile({ accessToken, expectedEmail: request.currentUser.email, sourceFileId: input.sourceDriveFileId, folderId, allowCopyFallback: input.allowCopyFallback });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_DRIVE_FILE';
      const needsCopyConfirmation = ['DRIVE_FILE_NOT_OWNED', 'DRIVE_MOVE_NOT_ALLOWED'].includes(code) || (!input.allowCopyFallback && !code.startsWith('GOOGLE_') && !code.includes('UNAVAILABLE') && !code.includes('FOLDER'));
      return reply.code(needsCopyConfirmation ? 409 : 422).send({ error: { code: needsCopyConfirmation ? 'DRIVE_COPY_CONFIRMATION_REQUIRED' : code, message: needsCopyConfirmation ? 'This file cannot be moved. Confirm that Woko may create a project copy instead.' : 'The selected Drive file could not be transferred.', requestId: request.id } });
    }
    let result;
    try {
      result = await sql.begin(async (transaction) => {
        const locked = await transaction<Array<{ version: number }>>`select version from work_orders where id = ${id} for update`;
        if (locked[0]?.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
        const counts = await transaction<Array<{ count: number }>>`select count(*)::int as count from attachments where work_order_id = ${id} and evidence_type = ${input.evidenceType} and removed_at is null`;
        if ((counts[0]?.count ?? 0) >= evidenceRules.maxFilesPerType) return { error: 'FILE_COUNT_LIMIT' } as const;
        const attachments = await transaction<Array<{ id: string }>>`
          insert into attachments (work_order_id, drive_file_id, linked_drive_file_id, drive_url, file_name, original_file_name, mime_type, file_size, drive_subfolder_type, evidence_type, source_type, uploaded_by)
          values (${id}, ${transferred.id}, ${transferred.sourceId}, ${transferred.webViewLink}, ${transferred.name}, ${transferred.name}, ${transferred.mimeType}, ${transferred.size}, ${input.evidenceType}, ${input.evidenceType}, ${transferred.mode === 'MOVED' ? 'DRIVE_MOVE' : 'DRIVE_COPY'}, ${request.currentUser.id}) returning id
        `;
        await transaction`update work_orders set version = version + 1, updated_at = now() where id = ${id}`;
        await transaction`
          insert into progress_updates (work_order_id, update_type, note, structured_data, created_by)
          values (${id}, 'FILE_EVIDENCE_ADDED', ${`${transferred.mode === 'MOVED' ? 'Moved' : 'Copied'} ${input.evidenceType.toLowerCase()} evidence from Drive: ${transferred.name}`}, ${transaction.json({ attachmentId: attachments[0]!.id, evidenceType: input.evidenceType, sourceType: transferred.mode === 'MOVED' ? 'DRIVE_MOVE' : 'DRIVE_COPY' })}, ${request.currentUser.id})
        `;
        await transaction`
          insert into audit_events (work_order_id, user_id, event_type, new_data, correlation_id)
          values (${id}, ${request.currentUser.id}, 'FILE_EVIDENCE_ADDED', ${transaction.json({ attachmentId: attachments[0]!.id, evidenceType: input.evidenceType, transferMode: transferred.mode, sourceDriveFileId: transferred.sourceId, driveFileId: transferred.id })}, ${request.id})
        `;
        return { id: attachments[0]!.id, version: input.expectedVersion + 1, driveUrl: transferred.webViewLink, transferMode: transferred.mode } as const;
      });
    } catch (error) {
      await rollbackUserDriveTransfer(accessToken, transferred, folderId).catch(() => undefined);
      throw error;
    }
    if ('error' in result) {
      await rollbackUserDriveTransfer(accessToken, transferred, folderId).catch(() => undefined);
      return reply.code(result.error === 'VERSION_CONFLICT' ? 409 : 422).send({ error: { code: result.error, message: 'The evidence could not be recorded. Reload and try again.', requestId: request.id } });
    }
    return reply.code(201).send({ data: result });
  });

  app.post('/work-orders/:id/attachments/link', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = linkDriveEvidenceSchema.parse(request.body);
    const rows = await sql<Array<{ version: number; primary_assignee_id: string; drive_provisioning_status: string; drive_subfolders: Partial<DriveSubfolderMap> }>>`
      select version, primary_assignee_id, drive_provisioning_status, drive_subfolders from work_orders where id = ${id}
    `;
    const workOrder = rows[0];
    if (!workOrder) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work order not found.', requestId: request.id } });
    if (workOrder.version !== input.expectedVersion) return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'Reload the work order before linking evidence.', requestId: request.id } });
    if (!isManager(request.currentUser.roles) && !(await isWorkOrderPic(id, request.currentUser.id))) return reply.code(403).send({ error: { code: 'NOT_ASSIGNED', message: 'Only a PIC or Facilities Manager can add evidence.', requestId: request.id } });
    if (workOrder.drive_provisioning_status !== 'COMPLETE') return reply.code(422).send({ error: { code: 'DRIVE_NOT_READY', message: 'The work-order Drive folder is not ready.', requestId: request.id } });
    const folderId = workOrder.drive_subfolders[input.evidenceType];
    const sourceFileId = extractDriveFileId(input.driveUrl);
    if (!folderId || !sourceFileId) return reply.code(422).send({ error: { code: 'INVALID_DRIVE_LINK', message: 'Provide a valid Google Drive file link.', requestId: request.id } });
    const existing = await sql<Array<{ count: number }>>`select count(*)::int as count from attachments where work_order_id = ${id} and evidence_type = ${input.evidenceType} and removed_at is null`;
    if ((existing[0]?.count ?? 0) >= evidenceRules.maxFilesPerType) return reply.code(422).send({ error: { code: 'FILE_COUNT_LIMIT', message: `A maximum of ${evidenceRules.maxFilesPerType} files is allowed per evidence type.`, requestId: request.id } });

    let linked;
    try {
      linked = await linkExistingDriveFile({ sourceFileId, folderId });
      validateLinkedDriveFile({ fileName: linked.name, mimeType: linked.mimeType, size: linked.size });
    } catch (error) {
      if (linked?.id) await deleteDriveFile(linked.id).catch(() => undefined);
      return reply.code(422).send({ error: { code: 'INVALID_DRIVE_FILE', message: error instanceof Error ? error.message : 'The Drive file is not valid evidence.', requestId: request.id } });
    }
    const result = await sql.begin(async (transaction) => {
      const locked = await transaction<Array<{ version: number }>>`select version from work_orders where id = ${id} for update`;
      if (locked[0]?.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      const counts = await transaction<Array<{ count: number }>>`select count(*)::int as count from attachments where work_order_id = ${id} and evidence_type = ${input.evidenceType} and removed_at is null`;
      if ((counts[0]?.count ?? 0) >= evidenceRules.maxFilesPerType) return { error: 'FILE_COUNT_LIMIT' } as const;
      const attachments = await transaction<Array<{ id: string }>>`
        insert into attachments (work_order_id, drive_file_id, linked_drive_file_id, drive_url, file_name, original_file_name, mime_type, file_size, drive_subfolder_type, evidence_type, source_type, uploaded_by)
        values (${id}, ${linked.id}, ${linked.targetId}, ${linked.webViewLink}, ${linked.name}, ${linked.name}, ${linked.mimeType}, ${linked.size}, ${input.evidenceType}, ${input.evidenceType}, 'DRIVE_LINK', ${request.currentUser.id}) returning id
      `;
      await transaction`update work_orders set version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, note, structured_data, created_by)
        values (${id}, 'FILE_EVIDENCE_ADDED', ${`Linked ${input.evidenceType.toLowerCase()} evidence: ${linked.name}`}, ${transaction.json({ attachmentId: attachments[0]!.id, evidenceType: input.evidenceType, sourceType: 'DRIVE_LINK' })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, new_data, correlation_id)
        values (${id}, ${request.currentUser.id}, 'FILE_EVIDENCE_ADDED', ${transaction.json({ attachmentId: attachments[0]!.id, evidenceType: input.evidenceType, linkedDriveFileId: linked.targetId })}, ${request.id})
      `;
      return { id: attachments[0]!.id, version: input.expectedVersion + 1, driveUrl: linked.webViewLink } as const;
    });
    if ('error' in result) {
      await deleteDriveFile(linked.id).catch(() => undefined);
      return reply.code(result.error === 'VERSION_CONFLICT' ? 409 : 422).send({ error: { code: result.error, message: 'The evidence could not be recorded. Reload and try again.', requestId: request.id } });
    }
    return reply.code(201).send({ data: result });
  });

  app.post('/work-orders/:id/condition', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = changeConditionSchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_order_number: string; title: string; condition: TaskCondition; status: string; version: number; primary_assignee_id: string }>>`
        select work_order_number, title, condition, status, version, primary_assignee_id
        from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.status !== 'ACTIVE') return { error: 'WORK_ORDER_NOT_ACTIVE' } as const;
      const isManager = request.currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
      if (!isManager && !(await transaction`select 1 from work_order_assignees where work_order_id = ${id} and user_id = ${request.currentUser.id} limit 1`).length) return { error: 'NOT_ASSIGNED' } as const;
            if (workOrder.condition === input.condition) return { error: 'CONDITION_UNCHANGED' } as const;

      const details = input.condition === 'AT_RISK'
        ? { explanation: input.explanation, expectedImpact: input.expectedImpact }
        : input.condition === 'BLOCKED'
          ? { blockerCategory: input.blockerCategory, explanation: input.explanation, expectedResolutionDate: input.expectedResolutionDate }
          : { resolutionNote: input.resolutionNote };
      const note = input.condition === 'AT_RISK'
        ? input.explanation
        : input.condition === 'BLOCKED'
          ? input.explanation
          : input.resolutionNote;
      const updateType = input.condition === 'AT_RISK' ? 'RISK_UPDATE' : input.condition === 'BLOCKED' ? 'BLOCKER_UPDATE' : 'CONDITION_RESOLVED';

      await transaction`
        update work_orders set condition = ${input.condition}, version = version + 1, updated_at = now()
        where id = ${id}
      `;
      await transaction`
        insert into progress_updates (work_order_id, update_type, note, structured_data, created_by)
        values (${id}, ${updateType}, ${note}, ${transaction.json({ previousCondition: workOrder.condition, condition: input.condition, ...details })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_ORDER_CONDITION_CHANGED', ${transaction.json({ condition: workOrder.condition })}, ${transaction.json({ condition: input.condition, ...details })}, ${note}, ${request.id})
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select recipients.user_id, ${id}, 'CONDITION_CHANGED', ${`${workOrder.work_order_number}: ${input.condition.replaceAll('_', ' ')}`}, ${`${workOrder.title} changed from ${workOrder.condition.replaceAll('_', ' ')} to ${input.condition.replaceAll('_', ' ')}. ${note}`}
        from (
          select user_id from work_order_assignees where work_order_id = ${id}
          union select reviewer_id from work_orders where id = ${id} and reviewer_id is not null
          union select user_id from work_order_overseers where work_order_id = ${id}
        ) recipients
      `;
      return { condition: input.condition, version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : result.error === 'NOT_ASSIGNED' ? 403 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The work condition could not be changed.', requestId: request.id } });
    }
    return { data: result };
  });

  app.patch('/work-orders/:id/participants', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = participantsSchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_order_number: string; title: string; version: number; status: string; reviewer_id: string | null }>>`
        select work_order_number, title, version, status, reviewer_id from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.status !== 'ACTIVE') return { error: 'WORK_ORDER_NOT_ACTIVE' } as const;
      const assigned = await transaction`select 1 from work_order_assignees where work_order_id = ${id} and user_id = ${request.currentUser.id} limit 1`;
      const mayManageParticipants = isManager(request.currentUser.roles) || assigned.length > 0 || workOrder.reviewer_id === request.currentUser.id;
      if (!mayManageParticipants) return { error: 'PARTICIPANT_MANAGEMENT_FORBIDDEN' } as const;
      const participantIds = [...new Set([...input.assigneeIds, ...(input.reviewerId ? [input.reviewerId] : []), ...input.overseerIds])];
      const activeParticipants = await transaction<Array<{ id: string; roles: Role[] }>>`
        select u.id, coalesce(array_agg(ur.role) filter (where ur.role is not null), '{}') as roles
        from users u left join user_roles ur on ur.user_id = u.id
        where u.active = true and u.id = any(${participantIds}::uuid[]) group by u.id
      `;
      if (activeParticipants.length !== participantIds.length) return { error: 'INVALID_PARTICIPANT' } as const;
      if (!participantsHaveEligibleRoles(activeParticipants, input)) return { error: 'PARTICIPANT_ROLE_MISMATCH' } as const;
      const [previousAssignees, previousOverseers] = await Promise.all([
        transaction<Array<{ user_id: string }>>`select user_id from work_order_assignees where work_order_id = ${id}`,
        transaction<Array<{ user_id: string }>>`select user_id from work_order_overseers where work_order_id = ${id}`,
      ]);
      const previous = { assigneeIds: previousAssignees.map((item) => item.user_id), reviewerId: workOrder.reviewer_id, overseerIds: previousOverseers.map((item) => item.user_id) };
      const next = { assigneeIds: input.assigneeIds, reviewerId: input.reviewerId, overseerIds: input.overseerIds };
      const snapshotIds = [...new Set([...previous.assigneeIds, ...(previous.reviewerId ? [previous.reviewerId] : []), ...previous.overseerIds, ...next.assigneeIds, ...(next.reviewerId ? [next.reviewerId] : []), ...next.overseerIds])];
      const participantSnapshots = await transaction<Array<{ id: string; full_name: string }>>`
        select id, full_name from users where id = any(${snapshotIds}::uuid[])
      `;
      const peopleById = new Map(participantSnapshots.map((person) => [person.id, { id: person.id, name: person.full_name }]));
      const people = (ids: string[]) => ids.map((userId) => peopleById.get(userId)).filter((person): person is { id: string; name: string } => Boolean(person));
      const changes = {
        pics: {
          added: people(next.assigneeIds.filter((userId) => !previous.assigneeIds.includes(userId))),
          removed: people(previous.assigneeIds.filter((userId) => !next.assigneeIds.includes(userId))),
        },
        reviewer: {
          previous: previous.reviewerId ? peopleById.get(previous.reviewerId) ?? null : null,
          next: next.reviewerId ? peopleById.get(next.reviewerId) ?? null : null,
        },
        overseers: {
          added: people(next.overseerIds.filter((userId) => !previous.overseerIds.includes(userId))),
          removed: people(previous.overseerIds.filter((userId) => !next.overseerIds.includes(userId))),
        },
      };
      await transaction`delete from work_order_assignees where work_order_id = ${id}`;
      await transaction`
        insert into work_order_assignees (work_order_id, user_id, added_by)
        select ${id}, participant.user_id, ${request.currentUser.id} from unnest(${input.assigneeIds}::uuid[]) participant(user_id)
      `;
      await transaction`delete from work_order_overseers where work_order_id = ${id}`;
      if (input.overseerIds.length) await transaction`
        insert into work_order_overseers (work_order_id, user_id, added_by)
        select ${id}, participant.user_id, ${request.currentUser.id} from unnest(${input.overseerIds}::uuid[]) participant(user_id)
      `;
      await transaction`update work_orders set primary_assignee_id = ${input.assigneeIds[0]!}, reviewer_id = ${input.reviewerId}, version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, note, structured_data, created_by)
        values (${id}, 'PARTICIPANTS_CHANGED', ${input.reason}, ${transaction.json({ previous, next, changes })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_ORDER_PARTICIPANTS_CHANGED', ${transaction.json(previous)}, ${transaction.json(next)}, ${input.reason}, ${request.id})
      `;
      const newlyAssigned = input.assigneeIds.filter((userId) => !previous.assigneeIds.includes(userId));
      if (newlyAssigned.length) await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select participant.user_id, ${id}, 'ASSIGNMENT', ${`Assigned: ${workOrder.work_order_number}`}, ${`${workOrder.title}. Reason: ${input.reason}`}
        from unnest(${newlyAssigned}::uuid[]) participant(user_id)
      `;
      return { version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : result.error === 'PARTICIPANT_MANAGEMENT_FORBIDDEN' ? 403 : 422;
      const message = result.error === 'PARTICIPANT_MANAGEMENT_FORBIDDEN' ? 'Only a current PIC, Reviewer, Administrator, or Facilities Manager can change the people involved.' : result.error === 'PARTICIPANT_ROLE_MISMATCH' ? 'PICs must have the PIC role, Reviewers must be managers, and Overseers must have the Overseer role.' : 'The project participants could not be changed.';
      return reply.code(status).send({ error: { code: result.error, message, requestId: request.id } });
    }
    return { data: result };
  });

  app.patch('/work-orders/:id/priority', { preHandler: requireManager }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = prioritySchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_order_number: string; title: string; priority: string; version: number; status: string }>>`
        select work_order_number, title, priority, version, status from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.status !== 'ACTIVE') return { error: 'WORK_ORDER_NOT_ACTIVE' } as const;
      if (workOrder.priority === input.priority) return { error: 'PRIORITY_UNCHANGED' } as const;
      await transaction`update work_orders set priority = ${input.priority}, version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, note, structured_data, created_by)
        values (${id}, 'PRIORITY_CHANGED', ${input.reason}, ${transaction.json({ previousPriority: workOrder.priority, priority: input.priority })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_ORDER_PRIORITY_CHANGED', ${transaction.json({ priority: workOrder.priority })}, ${transaction.json({ priority: input.priority })}, ${input.reason}, ${request.id})
      `;
      if (workOrder.priority === 'CRITICAL' || input.priority === 'CRITICAL') {
        await transaction`
          insert into notifications (recipient_user_id, work_order_id, type, title, message)
          select recipients.user_id, ${id}, 'CRITICAL_PRIORITY_CHANGED', ${`${workOrder.work_order_number}: critical priority changed`}, ${`${workOrder.title} changed from ${workOrder.priority} to ${input.priority}. Reason: ${input.reason}`}
          from (
            select user_id from work_order_assignees where work_order_id = ${id}
            union select reviewer_id from work_orders where id = ${id} and reviewer_id is not null
            union select user_id from work_order_overseers where work_order_id = ${id}
          ) recipients
        `;
      }
      return { priority: input.priority, version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The priority could not be changed.', requestId: request.id } });
    }
    return { data: result };
  });

  app.patch('/work-orders/:id/due-date', { preHandler: requireManager }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = changeDueDateSchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_order_number: string; title: string; due_date: string; status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'; version: number }>>`
        select work_order_number, title, due_date::text, status, version
        from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.due_date === input.dueDate) return { error: 'DUE_DATE_UNCHANGED' } as const;

      await transaction`
        update work_orders set due_date = ${input.dueDate}, version = version + 1, updated_at = now()
        where id = ${id}
      `;
      await transaction`
        insert into progress_updates (work_order_id, update_type, note, structured_data, created_by)
        values (${id}, 'DUE_DATE_CHANGED', ${input.reason}, ${transaction.json({ previousDueDate: workOrder.due_date, dueDate: input.dueDate, reason: input.reason })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_ORDER_DUE_DATE_CHANGED', ${transaction.json({ dueDate: workOrder.due_date })}, ${transaction.json({ dueDate: input.dueDate })}, ${input.reason}, ${request.id})
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select recipients.user_id, ${id}, 'DUE_DATE_CHANGED', ${`${workOrder.work_order_number}: due date changed`}, ${`${workOrder.title} is now due ${input.dueDate}. Reason: ${input.reason}`}
        from (
          select user_id from work_order_assignees where work_order_id = ${id}
          union select reviewer_id from work_orders where id = ${id} and reviewer_id is not null
          union select user_id from work_order_overseers where work_order_id = ${id}
        ) recipients
      `;
      return { dueDate: input.dueDate, status: workOrder.status, version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The due date could not be changed.', requestId: request.id } });
    }
    const periods = await sql<Array<{ type: string; end_date: string }>>`select type, end_date::text from academic_periods where active = true`;
    const semesterEnd = periods.find((period) => period.type === 'SEMESTER')?.end_date;
    const academicYearEnd = periods.find((period) => period.type === 'ACADEMIC_YEAR')?.end_date;
    const deadlineGroup = getDeadlineGroup({ dueDate: result.dueDate, status: result.status, today: new Date(), semesterEnd, academicYearEnd });
    return { data: { dueDate: result.dueDate, deadlineGroup, version: result.version } };
  });

  app.post('/work-orders/:id/vendor-search', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = vendorSearchSchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_type: WorkType; workflow_stage: WorkflowStage; status: string; version: number; primary_assignee_id: string }>>`
        select work_type, workflow_stage, status, version, primary_assignee_id from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.work_type !== 'VENDOR') return { error: 'VENDOR_WORK_REQUIRED' } as const;
      if (workOrder.status !== 'ACTIVE' || !['PLANNED', 'FINDING_VENDOR'].includes(workOrder.workflow_stage)) return { error: 'INVALID_VENDOR_STAGE' } as const;
      if (!isManager(request.currentUser.roles) && !(await transaction`select 1 from work_order_assignees where work_order_id = ${id} and user_id = ${request.currentUser.id} limit 1`).length) return { error: 'NOT_ASSIGNED' } as const;
            const details = {
        vendorSearchNote: input.vendorSearchNote,
        potentialVendorName: input.potentialVendorName,
        contactedVendorName: input.contactedVendorName,
        shortlistNote: input.shortlistNote,
        vendorContactDetails: input.vendorContactDetails,
      };
      await transaction`update work_orders set workflow_stage = 'FINDING_VENDOR', version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, 'VENDOR_SEARCH_UPDATE', ${workOrder.workflow_stage}, 'FINDING_VENDOR', ${input.vendorSearchNote}, ${transaction.json(details)}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, correlation_id)
        values (${id}, ${request.currentUser.id}, 'VENDOR_SEARCH_UPDATED', ${transaction.json({ stage: workOrder.workflow_stage })}, ${transaction.json({ stage: 'FINDING_VENDOR', ...details })}, ${request.id})
      `;
      return { stage: 'FINDING_VENDOR', version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : result.error === 'NOT_ASSIGNED' ? 403 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The vendor search update could not be recorded.', requestId: request.id } });
    }
    return { data: result };
  });

  app.post('/work-orders/:id/proposal', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = proposalSubmissionSchema.parse(request.body);
    const rows = await sql<Array<{ work_type: WorkType; workflow_stage: WorkflowStage; status: string; version: number; primary_assignee_id: string; drive_provisioning_status: string; drive_subfolders: Partial<DriveSubfolderMap> }>>`
      select work_type, workflow_stage, status, version, primary_assignee_id, drive_provisioning_status, drive_subfolders from work_orders where id = ${id}
    `;
    const current = rows[0];
    if (!current) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Work order not found.', requestId: request.id } });
    if (current.version !== input.expectedVersion) return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'Reload the work order before recording the proposal.', requestId: request.id } });
    if (current.work_type !== 'VENDOR' || current.status !== 'ACTIVE' || !['FINDING_VENDOR', 'PROPOSAL'].includes(current.workflow_stage)) return reply.code(422).send({ error: { code: 'INVALID_VENDOR_STAGE', message: 'The proposal cannot be recorded at this stage.', requestId: request.id } });
    if (!isManager(request.currentUser.roles) && !(await isWorkOrderPic(id, request.currentUser.id))) return reply.code(403).send({ error: { code: 'NOT_ASSIGNED', message: 'Only a PIC or Facilities Manager can record the proposal.', requestId: request.id } });

    let transferred: Awaited<ReturnType<typeof transferUserDriveFile>> | undefined;
    let proposalFolderId: string | undefined;
    let accessToken: string | undefined;
    if (input.sourceDriveFileId) {
      proposalFolderId = current.drive_subfolders.PROPOSAL;
      accessToken = z.string().min(20).parse(request.headers['x-google-drive-token']);
      if (current.drive_provisioning_status !== 'COMPLETE' || !proposalFolderId) return reply.code(422).send({ error: { code: 'DRIVE_NOT_READY', message: 'The proposal folder is not ready.', requestId: request.id } });
      try {
        transferred = await transferUserDriveFile({ accessToken, expectedEmail: request.currentUser.email, sourceFileId: input.sourceDriveFileId, folderId: proposalFolderId, allowCopyFallback: input.allowCopyFallback });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'INVALID_DRIVE_FILE';
        const needsCopyConfirmation = ['DRIVE_FILE_NOT_OWNED', 'DRIVE_MOVE_NOT_ALLOWED'].includes(code) || (!input.allowCopyFallback && !code.startsWith('GOOGLE_') && !code.includes('UNAVAILABLE') && !code.includes('FOLDER'));
        return reply.code(needsCopyConfirmation ? 409 : 422).send({ error: { code: needsCopyConfirmation ? 'DRIVE_COPY_CONFIRMATION_REQUIRED' : code, message: needsCopyConfirmation ? 'This proposal cannot be moved. Confirm that Woko may create a project copy instead.' : 'The selected proposal file could not be transferred.', requestId: request.id } });
      }
    }

    const result = await sql.begin(async (transaction) => {
      const lockedRows = await transaction<Array<{ work_type: WorkType; workflow_stage: WorkflowStage; status: string; version: number; primary_assignee_id: string }>>`
        select work_type, workflow_stage, status, version, primary_assignee_id from work_orders where id = ${id} for update
      `;
      const workOrder = lockedRows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      const evidence = transferred ? [transferred] : await transaction`select 1 from attachments where work_order_id = ${id} and evidence_type = 'PROPOSAL' and removed_at is null limit 1`;
      if (!evidence.length) return { error: 'PROPOSAL_EVIDENCE_REQUIRED' } as const;
      let attachmentId: string | undefined;
      if (transferred) {
        const counts = await transaction<Array<{ count: number }>>`select count(*)::int as count from attachments where work_order_id = ${id} and evidence_type = 'PROPOSAL' and removed_at is null`;
        if ((counts[0]?.count ?? 0) >= evidenceRules.maxFilesPerType) return { error: 'FILE_COUNT_LIMIT' } as const;
        const attachments = await transaction<Array<{ id: string }>>`
          insert into attachments (work_order_id, drive_file_id, linked_drive_file_id, drive_url, file_name, original_file_name, mime_type, file_size, drive_subfolder_type, evidence_type, source_type, uploaded_by)
          values (${id}, ${transferred.id}, ${transferred.sourceId}, ${transferred.webViewLink}, ${transferred.name}, ${transferred.name}, ${transferred.mimeType}, ${transferred.size}, 'PROPOSAL', 'PROPOSAL', ${transferred.mode === 'MOVED' ? 'DRIVE_MOVE' : 'DRIVE_COPY'}, ${request.currentUser.id}) returning id
        `;
        attachmentId = attachments[0]!.id;
      }
      const details = {
        vendorName: input.vendorName,
        quotedCost: input.quotedCost,
        proposalValidityDate: input.proposalValidityDate,
        expectedWorkDuration: input.expectedWorkDuration,
        proposalNotes: input.proposalNotes,
        attachmentId,
        transferMode: transferred?.mode,
      };
      await transaction`update work_orders set workflow_stage = 'PROPOSAL', estimated_cost = ${input.quotedCost}, version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, 'PROPOSAL_SUBMISSION', ${workOrder.workflow_stage}, 'PROPOSAL', ${`Proposal received from ${input.vendorName}`}, ${transaction.json(details)}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, correlation_id)
        values (${id}, ${request.currentUser.id}, 'VENDOR_PROPOSAL_RECORDED', ${transaction.json({ stage: workOrder.workflow_stage })}, ${transaction.json({ stage: 'PROPOSAL', ...details })}, ${request.id})
      `;
      return { stage: 'PROPOSAL', version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      if (transferred && accessToken && proposalFolderId) await rollbackUserDriveTransfer(accessToken, transferred, proposalFolderId).catch(() => undefined);
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The proposal could not be recorded.', requestId: request.id } });
    }
    return { data: result };
  });

  app.post('/work-orders/:id/proposal/submit', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ note: z.string().trim().min(3).max(2000), expectedVersion: z.number().int().positive() }).parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ workflow_stage: WorkflowStage; status: string; version: number; primary_assignee_id: string; reviewer_id: string | null }>>`
        select workflow_stage, status, version, primary_assignee_id, reviewer_id from work_orders where id = ${id} and work_type = 'VENDOR' for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.status !== 'ACTIVE' || workOrder.workflow_stage !== 'PROPOSAL') return { error: 'INVALID_VENDOR_STAGE' } as const;
      if (!isManager(request.currentUser.roles) && !(await transaction`select 1 from work_order_assignees where work_order_id = ${id} and user_id = ${request.currentUser.id} limit 1`).length) return { error: 'NOT_ASSIGNED' } as const;
            const [proposal, evidence] = await Promise.all([
        transaction`select 1 from progress_updates where work_order_id = ${id} and update_type = 'PROPOSAL_SUBMISSION' limit 1`,
        transaction`select 1 from attachments where work_order_id = ${id} and evidence_type = 'PROPOSAL' and removed_at is null limit 1`,
      ]);
      if (!proposal.length) return { error: 'PROPOSAL_DATA_REQUIRED' } as const;
      if (!evidence.length) return { error: 'PROPOSAL_EVIDENCE_REQUIRED' } as const;
      await transaction`update work_orders set workflow_stage = 'APPROVAL', version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, 'PROPOSAL_APPROVAL_REQUESTED', 'PROPOSAL', 'APPROVAL', ${input.note}, ${transaction.json({ submittedBy: request.currentUser.id })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, correlation_id)
        values (${id}, ${request.currentUser.id}, 'PROPOSAL_SUBMITTED_FOR_APPROVAL', ${transaction.json({ stage: 'PROPOSAL' })}, ${transaction.json({ stage: 'APPROVAL' })}, ${request.id})
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select recipients.user_id, ${id}, 'PROPOSAL_SUBMITTED', wo.work_order_number || ': proposal awaiting approval', wo.title
        from work_orders wo
        cross join lateral (
          select wo.reviewer_id as user_id where wo.reviewer_id is not null
          union select ur.user_id from user_roles ur where ur.role in ('ADMINISTRATOR', 'FACILITIES_MANAGER')
        ) recipients where wo.id = ${id} and recipients.user_id <> ${request.currentUser.id}
        on conflict do nothing
      `;
      return { stage: 'APPROVAL', version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : result.error === 'NOT_ASSIGNED' ? 403 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The proposal could not be submitted for approval.', requestId: request.id } });
    }
    return { data: result };
  });

  app.post('/work-orders/:id/proposal/decision', { preHandler: requireManager }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = proposalDecisionSchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_order_number: string; title: string; workflow_stage: WorkflowStage; status: string; version: number; primary_assignee_id: string }>>`
        select work_order_number, title, workflow_stage, status, version, primary_assignee_id from work_orders where id = ${id} and work_type = 'VENDOR' for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.status !== 'ACTIVE' || workOrder.workflow_stage !== 'APPROVAL') return { error: 'INVALID_VENDOR_STAGE' } as const;
      const proposals = await transaction<Array<{ id: string; created_by: string; structured_data: { vendorName: string; quotedCost: number; proposalValidityDate?: string; expectedWorkDuration?: string; proposalNotes?: string } }>>`
        select id, created_by, structured_data from progress_updates
        where work_order_id = ${id} and update_type = 'PROPOSAL_SUBMISSION'
        order by created_at desc limit 1
      `;
      const proposal = proposals[0];
      if (!proposal) return { error: 'PROPOSAL_DATA_REQUIRED' } as const;
      const picRows = await transaction<Array<{ user_id: string }>>`select user_id from work_order_assignees where work_order_id = ${id}`;
      if (!canDecideProposal(request.currentUser.id, picRows.map((row) => row.user_id))) return { error: 'PIC_APPROVAL_NOT_ALLOWED' } as const;
      const targetStage = proposalDecisionTargets[input.decision];
      const updates = await transaction<Array<{ id: string }>>`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, 'APPROVAL_DECISION', 'APPROVAL', ${targetStage}, ${input.decisionNote}, ${transaction.json({ decision: input.decision, plannedStartDate: input.plannedStartDate, proposal: proposal.structured_data })}, ${request.currentUser.id})
        returning id
      `;
      await transaction`
        insert into approvals (work_order_id, progress_update_id, approval_type, decision, decision_note, decided_by, submitted_by, proposal_data)
        values (${id}, ${updates[0]!.id}, 'VENDOR_PROPOSAL', ${input.decision}, ${input.decisionNote}, ${request.currentUser.id}, ${proposal.created_by}, ${transaction.json(proposal.structured_data)})
      `;
      await transaction`
        update work_orders set workflow_stage = ${targetStage}, planned_start_date = ${input.decision === 'APPROVED' ? input.plannedStartDate! : null},
          version = version + 1, updated_at = now() where id = ${id}
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'PROPOSAL_DECISION_RECORDED', ${transaction.json({ stage: 'APPROVAL' })}, ${transaction.json({ stage: targetStage, decision: input.decision })}, ${input.decisionNote}, ${request.id})
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select user_id, ${id}, ${`PROPOSAL_${input.decision}`}, ${`${workOrder.work_order_number}: ${input.decision.replaceAll('_', ' ')}`}, ${`${workOrder.title}: ${input.decisionNote}`}
        from work_order_assignees where work_order_id = ${id}
      `;
      return { stage: targetStage, decision: input.decision, version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : result.error === 'PIC_APPROVAL_NOT_ALLOWED' ? 403 : 422;
      return reply.code(status).send({ error: { code: result.error, message: result.error === 'PIC_APPROVAL_NOT_ALLOWED' ? 'A PIC on this work order cannot decide its proposal.' : 'The proposal decision could not be recorded.', requestId: request.id } });
    }
    return { data: result };
  });

  app.post('/work-orders/:id/progress-update', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = progressUpdateSchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ version: number; status: string; workflow_stage: WorkflowStage }>>`
        select version, status, workflow_stage from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (!canRecordMidProgress(workOrder.status, workOrder.workflow_stage)) return { error: 'INVALID_PROGRESS_STAGE' } as const;
      if (!isManager(request.currentUser.roles) && !(await transaction`select 1 from work_order_assignees where work_order_id = ${id} and user_id = ${request.currentUser.id} limit 1`).length) return { error: 'NOT_ASSIGNED' } as const;
      const linkedAttachments = input.attachmentIds.length ? await transaction<Array<{ id: string }>>`
        select id from attachments
        where work_order_id = ${id} and uploaded_by = ${request.currentUser.id} and removed_at is null and id = any(${input.attachmentIds}::uuid[])
      ` : [];
      if (linkedAttachments.length !== input.attachmentIds.length) return { error: 'INVALID_ATTACHMENT' } as const;
      await transaction`update work_orders set version = version + 1, updated_at = now() where id = ${id}`;
      if (input.attachmentIds.length) await transaction`
        delete from progress_updates
        where work_order_id = ${id} and update_type = 'FILE_EVIDENCE_ADDED' and created_by = ${request.currentUser.id}
          and structured_data->>'attachmentId' = any(${input.attachmentIds}::text[])
      `;
      await transaction`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, 'PROGRESS_UPDATE', 'IN_PROGRESS', 'IN_PROGRESS', ${input.note}, ${transaction.json({ attachmentIds: input.attachmentIds })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_PROGRESS_UPDATED', ${transaction.json({ stage: 'IN_PROGRESS' })}, ${transaction.json({ stage: 'IN_PROGRESS', attachmentIds: input.attachmentIds })}, ${request.id})
      `;
      return { version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : result.error === 'NOT_ASSIGNED' ? 403 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The progress update could not be recorded.', requestId: request.id } });
    }
    return { data: result };
  });

  app.post('/work-orders/:id/transitions', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = transitionSchema.parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ id: string; work_order_number: string; title: string; work_type: WorkType; workflow_stage: WorkflowStage; status: string; version: number; primary_assignee_id: string; reviewer_id: string | null }>>`
        select id, work_order_number, title, work_type, workflow_stage, status, version, primary_assignee_id, reviewer_id from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      const isManager = request.currentUser.roles.some((role) => role === 'ADMINISTRATOR' || role === 'FACILITIES_MANAGER');
      if (!isManager && !(await transaction`select 1 from work_order_assignees where work_order_id = ${id} and user_id = ${request.currentUser.id} limit 1`).length) return { error: 'NOT_ASSIGNED' } as const;
            const evidence = await transaction<Array<{ evidence_type: EvidenceType; mime_type: string }>>`
        select evidence_type, mime_type from attachments where work_order_id = ${id} and removed_at is null
      `;
      const hasProposalEvidence = evidence.some((attachment) => attachment.evidence_type === 'PROPOSAL');
      const hasCompletionEvidence = evidence.some((attachment) => attachment.evidence_type === 'COMPLETION' && isCompletionPhoto(attachment.mime_type));
      const linkedAttachments = input.attachmentIds.length ? await transaction<Array<{ id: string }>>`
        select id from attachments
        where work_order_id = ${id} and uploaded_by = ${request.currentUser.id} and removed_at is null and id = any(${input.attachmentIds}::uuid[])
      ` : [];
      if (linkedAttachments.length !== input.attachmentIds.length) return { error: 'INVALID_ATTACHMENT' } as const;
      const completionSummary = input.toStage === 'REVIEW' ? input.note : input.completionSummary;
      const validation = validateTransition({
        workType: workOrder.work_type,
        from: workOrder.workflow_stage,
        to: input.toStage,
        roles: request.currentUser.roles as Role[],
        reason: input.reason,
        hasProposalEvidence,
        hasCompletionEvidence,
        completionEvidenceWaiverReason: input.completionEvidenceWaiverReason,
        plannedStartDate: input.plannedStartDate,
        completionSummary,
      });
      if (!validation.allowed) return { error: validation.code ?? 'INVALID_TRANSITION' } as const;
      const nextStatus = input.toStage === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE';
      await transaction`
        update work_orders set workflow_stage = ${input.toStage}, status = ${nextStatus},
          planned_start_date = coalesce(${input.plannedStartDate ?? null}, planned_start_date),
          completion_date = ${input.toStage === 'COMPLETED' ? sql`current_date` : null},
          version = version + 1, updated_at = now()
        where id = ${id}
      `;
      if (input.attachmentIds.length) await transaction`
        delete from progress_updates
        where work_order_id = ${id} and update_type = 'FILE_EVIDENCE_ADDED' and created_by = ${request.currentUser.id}
          and structured_data->>'attachmentId' = any(${input.attachmentIds}::text[])
      `;
      await transaction`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, ${workOrder.workflow_stage === 'REVIEW' ? 'REVIEW_DECISION' : input.toStage === 'REVIEW' ? 'REVIEW_SUBMISSION' : 'STAGE_TRANSITION'}, ${workOrder.workflow_stage}, ${input.toStage}, ${input.note}, ${transaction.json({ reason: input.reason, plannedStartDate: input.plannedStartDate, completionSummary, hasProposalEvidence, hasCompletionEvidence, completionEvidenceWaiverReason: input.completionEvidenceWaiverReason, attachmentIds: input.attachmentIds })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORKFLOW_STAGE_CHANGED', ${transaction.json({ stage: workOrder.workflow_stage })}, ${transaction.json({ stage: input.toStage })}, ${input.reason ?? null}, ${request.id})
      `;
      if (input.toStage === 'REVIEW') {
        await transaction`
          insert into notifications (recipient_user_id, work_order_id, type, title, message)
          select recipients.user_id, ${id}, 'COMPLETION_REVIEW_SUBMITTED', ${`${workOrder.work_order_number}: completion review submitted`}, ${`${workOrder.title}: ${completionSummary}`}
          from (
            select ${workOrder.reviewer_id}::uuid as user_id where ${workOrder.reviewer_id}::uuid is not null
            union select ur.user_id from user_roles ur where ur.role in ('ADMINISTRATOR', 'FACILITIES_MANAGER')
          ) recipients where recipients.user_id <> ${request.currentUser.id}
        `;
      } else if (workOrder.workflow_stage === 'REVIEW') {
        const reviewType = input.toStage === 'COMPLETED' ? 'COMPLETION_APPROVED' : 'COMPLETION_REJECTED';
        await transaction`
          insert into notifications (recipient_user_id, work_order_id, type, title, message)
          select user_id, ${id}, ${reviewType}, ${`${workOrder.work_order_number}: ${input.toStage === 'COMPLETED' ? 'completion approved' : 'completion rejected'}`}, ${`${workOrder.title}: ${input.note}`}
          from work_order_assignees where work_order_id = ${id}
        `;
      }
      return { version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The workflow transition could not be completed.', requestId: request.id } });
    }
    return { data: result };
  });

  app.post('/work-orders/:id/reopen', { preHandler: requireManager }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ reason: z.string().trim().min(3).max(1000), expectedVersion: z.number().int().positive() }).parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_order_number: string; title: string; workflow_stage: WorkflowStage; status: string; version: number; primary_assignee_id: string; reviewer_id: string | null }>>`
        select work_order_number, title, workflow_stage, status, version, primary_assignee_id, reviewer_id from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.status !== 'COMPLETED') return { error: 'NOT_COMPLETED' } as const;
      await transaction`
        update work_orders set workflow_stage = 'IN_PROGRESS', status = 'ACTIVE', completion_date = null,
          version = version + 1, updated_at = now() where id = ${id}
      `;
      await transaction`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, 'REOPENING', ${workOrder.workflow_stage}, 'IN_PROGRESS', ${input.reason}, ${transaction.json({ reason: input.reason })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_ORDER_REOPENED', ${transaction.json({ status: 'COMPLETED', stage: workOrder.workflow_stage })}, ${transaction.json({ status: 'ACTIVE', stage: 'IN_PROGRESS' })}, ${input.reason}, ${request.id})
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select recipients.user_id, ${id}, 'WORK_ORDER_REOPENED', ${`${workOrder.work_order_number}: reopened`}, ${`${workOrder.title}. Reason: ${input.reason}`}
        from (
          select user_id from work_order_assignees where work_order_id = ${id}
          union select ${workOrder.reviewer_id}::uuid where ${workOrder.reviewer_id}::uuid is not null
        ) recipients
      `;
      return { version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The work order could not be reopened.', requestId: request.id } });
    }
    return { data: result };
  });

  app.post('/work-orders/:id/cancel', { preHandler: requireManager }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ reason: z.string().trim().min(3).max(1000), expectedVersion: z.number().int().positive() }).parse(request.body);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ work_order_number: string; title: string; workflow_stage: WorkflowStage; status: string; version: number }>>`
        select work_order_number, title, workflow_stage, status, version from work_orders where id = ${id} for update
      `;
      const workOrder = rows[0];
      if (!workOrder) return { error: 'NOT_FOUND' } as const;
      if (workOrder.version !== input.expectedVersion) return { error: 'VERSION_CONFLICT' } as const;
      if (workOrder.status !== 'ACTIVE') return { error: 'WORK_ORDER_NOT_ACTIVE' } as const;
      await transaction`update work_orders set status = 'CANCELLED', version = version + 1, updated_at = now() where id = ${id}`;
      await transaction`
        insert into progress_updates (work_order_id, update_type, previous_stage, new_stage, note, structured_data, created_by)
        values (${id}, 'CANCELLATION', ${workOrder.workflow_stage}, ${workOrder.workflow_stage}, ${input.reason}, ${transaction.json({ reason: input.reason })}, ${request.currentUser.id})
      `;
      await transaction`
        insert into audit_events (work_order_id, user_id, event_type, previous_data, new_data, reason, correlation_id)
        values (${id}, ${request.currentUser.id}, 'WORK_ORDER_CANCELLED', ${transaction.json({ status: 'ACTIVE' })}, ${transaction.json({ status: 'CANCELLED' })}, ${input.reason}, ${request.id})
      `;
      await transaction`
        insert into notifications (recipient_user_id, work_order_id, type, title, message)
        select recipients.user_id, ${id}, 'WORK_ORDER_CANCELLED', ${`${workOrder.work_order_number}: cancelled`}, ${`${workOrder.title}. Reason: ${input.reason}`}
        from (
          select user_id from work_order_assignees where work_order_id = ${id}
          union select reviewer_id from work_orders where id = ${id} and reviewer_id is not null
          union select user_id from work_order_overseers where work_order_id = ${id}
        ) recipients
      `;
      return { status: 'CANCELLED', version: workOrder.version + 1 } as const;
    });
    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'VERSION_CONFLICT' ? 409 : 422;
      return reply.code(status).send({ error: { code: result.error, message: 'The work order could not be cancelled.', requestId: request.id } });
    }
    return { data: result };
  });
}
