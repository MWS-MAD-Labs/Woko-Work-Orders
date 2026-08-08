import { hostname } from 'node:os';
import { config } from './config.js';
import { sql } from './database/client.js';
import { sendNotificationEmail } from './email.js';
import { renderInvitationEmail } from './invitation-email.js';
import { renderNotificationEmail } from './notification-email.js';
import { localizeNotification, type NotificationLocale } from './notification-localization.js';
import { deleteDriveFile, findDriveFileByAppProperty } from './drive.js';
import { pushSubscriptionHasExpired, sendPushNotification, webPushEnabled } from './push.js';

type JobRow = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type ReminderWorkOrder = {
  id: string;
  work_order_number: string;
  title: string;
  due_date: string;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  reviewer_id: string | null;
  assignee_ids: string[];
};

const workerId = `${hostname()}:${process.pid}:${crypto.randomUUID()}`;
let workerTimer: NodeJS.Timeout | undefined;
let schedulerTimer: NodeJS.Timeout | undefined;
let running = false;

export function localDateInTimeZone(now = new Date(), timeZone = config.APP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function daysBetween(date: string, referenceDate: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [referenceYear, referenceMonth, referenceDay] = referenceDate.split('-').map(Number);
  return Math.round((Date.UTC(year!, month! - 1, day!) - Date.UTC(referenceYear!, referenceMonth! - 1, referenceDay!)) / 86_400_000);
}

export function reminderType(daysUntilDue: number, priority: ReminderWorkOrder['priority']): string | undefined {
  if (daysUntilDue === 7) return 'DUE_IN_SEVEN_DAYS';
  if (daysUntilDue === 2) return 'DUE_IN_TWO_DAYS';
  if (daysUntilDue === 0) return 'DUE_TODAY';
  if (daysUntilDue === -1) return 'FIRST_DAY_OVERDUE';
  if (daysUntilDue < -1 && priority === 'CRITICAL') return 'CRITICAL_OVERDUE_REMINDER';
  if (daysUntilDue < -1 && Math.abs(daysUntilDue) % 3 === 1) return 'OVERDUE_REMINDER';
  return undefined;
}

function reminderCopy(workOrder: ReminderWorkOrder, type: string, daysUntilDue: number) {
  switch (type) {
    case 'DUE_IN_SEVEN_DAYS': return { title: `${workOrder.work_order_number}: due in 7 days`, message: `${workOrder.title} is due ${workOrder.due_date}.` };
    case 'DUE_IN_TWO_DAYS': return { title: `${workOrder.work_order_number}: due in 2 days`, message: `${workOrder.title} is due ${workOrder.due_date}.` };
    case 'DUE_TODAY': return { title: `${workOrder.work_order_number}: due today`, message: `${workOrder.title} is due today.` };
    case 'FIRST_DAY_OVERDUE': return { title: `${workOrder.work_order_number}: overdue`, message: `${workOrder.title} became overdue today.` };
    case 'CRITICAL_OVERDUE_REMINDER': return { title: `${workOrder.work_order_number}: critical and overdue`, message: `${workOrder.title} is critical and ${Math.abs(daysUntilDue)} days overdue.` };
    default: return { title: `${workOrder.work_order_number}: overdue reminder`, message: `${workOrder.title} is ${Math.abs(daysUntilDue)} days overdue.` };
  }
}

export function localTimeInTimeZone(now = new Date(), timeZone = config.APP_TIME_ZONE): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { hour: Number(value.hour), minute: Number(value.minute) };
}

function localHourInTimeZone(now = new Date(), timeZone = config.APP_TIME_ZONE): number {
  return localTimeInTimeZone(now, timeZone).hour;
}

function dayOfWeek(date: string): number { return new Date(`${date}T12:00:00Z`).getUTCDay(); }

function isLastSaturday(date: string): boolean {
  if (dayOfWeek(date) !== 6) return false;
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 7);
  return next.getUTCMonth() !== new Date(`${date}T12:00:00Z`).getUTCMonth();
}

export async function generateWorkListOccurrences(localDate: string) {
  const templates = await sql<Array<{ id: string; version: number; title: string; instructions: string; location_ids: string[]; worker_ids: string[]; recurrence: 'DAILY' | 'WEEKLY' | 'MONTHLY' }>>`
    select t.id, t.version, t.title, t.instructions, array_agg(distinct l.location_option_id)::text[] as location_ids,
      array_agg(distinct w.user_id)::text[] as worker_ids, i.recurrence
    from work_list_templates t join work_list_template_items i on i.template_id=t.id
      join work_list_template_locations l on l.template_id=t.id join work_list_template_workers w on w.template_id=t.id
    where t.active group by t.id, t.version, t.title, t.instructions, i.recurrence
  `;
  for (const template of templates) {
    const due = template.recurrence === 'DAILY' || (template.recurrence === 'WEEKLY' && dayOfWeek(localDate) === 6) || (template.recurrence === 'MONTHLY' && isLastSaturday(localDate));
    if (!due) continue;
    const items = await sql`select id, title, instructions, required, sort_order from work_list_template_items where template_id=${template.id} and recurrence=${template.recurrence} order by sort_order`;
    for (const locationId of template.location_ids) {
      const location = await sql<Array<{ id: string; name: string; type_label: string }>>`select id, name, type_label from location_options where id=${locationId}`;
      if (!location[0]) continue;
      const result = await sql`
        insert into work_list_occurrences (template_id, template_version, recurrence, period_date, due_at, location_option_id, location_snapshot, template_snapshot, worker_ids)
        values (${template.id}, ${template.version}, ${template.recurrence}::work_list_recurrence, ${localDate}::date, ((${localDate}::date + time '17:00') at time zone ${config.APP_TIME_ZONE}), ${locationId}, ${sql.json(location[0])}, ${sql.json({ title: template.title, instructions: template.instructions })}, ${template.worker_ids}::uuid[])
        on conflict (template_id, template_version, location_option_id, recurrence, period_date) do nothing returning id
      `;
      if (result[0]) await sql`insert into work_list_occurrence_items (occurrence_id, template_item_id, title, instructions, required, sort_order) select ${result[0].id}, id, title, instructions, required, sort_order from work_list_template_items where template_id=${template.id} and recurrence=${template.recurrence}`;
    }
  }
}

export function shouldGenerateDailyWorkListReminder(now: Date, timeZone = config.APP_TIME_ZONE): boolean {
  const localTime = localTimeInTimeZone(now, timeZone);
  return localTime.hour > 15 || (localTime.hour === 15 && localTime.minute >= 30);
}

export function notificationPushBody(type: string, message: string): string {
  return type === 'WORK_LIST_DAILY_REMINDER' ? 'You have unfinished Routine Work.' : message;
}

export async function generateWorkListNotifications(localDate: string, now = new Date()) {
  const localTime = localTimeInTimeZone(now);
  if (shouldGenerateDailyWorkListReminder(now)) {
    const unfinished = await sql<Array<{ worker_id: string; count: number; examples: string[] }>>`
      select u.id as worker_id, count(distinct o.id)::int as count,
        (array_agg(distinct (o.template_snapshot->>'title') || ' · ' || (o.location_snapshot->>'name')))[1:4] as examples
      from work_list_occurrences o
      cross join lateral unnest(o.worker_ids) as worker(worker_id)
      join users u on u.id=worker.worker_id and u.active
      join user_roles role on role.user_id=u.id and role.role='WORKER'
      where o.status='OPEN' and (o.due_at at time zone ${config.APP_TIME_ZONE})::date=${localDate}::date
        and exists (select 1 from work_list_occurrence_items i where i.occurrence_id=o.id and i.status is null)
      group by u.id
    `;
    for (const row of unfinished) await sql`
      insert into notifications (recipient_user_id, type, title, message, idempotency_key)
      values (${row.worker_id}, 'WORK_LIST_DAILY_REMINDER', 'Routine Work still to complete today',
        ${`You have ${row.count} Routine Work with unfinished items today: ${row.examples.join(', ')}${row.count > 4 ? ', and more' : ''}. Complete them before the deadline.`},
        ${`work-list-daily-reminder:${localDate}:${row.worker_id}`})
      on conflict (idempotency_key) where idempotency_key is not null do nothing
    `;
  }

  await sql`update work_list_occurrences set status='MISSED', version=version+1, updated_at=now() where status in ('OPEN', 'OVERDUE') and due_at < now()`;

  if (localTime.hour >= 7) {
    const missedDates = await sql<Array<{ due_date: string; count: number; examples: string[] }>>`
      select (due_at at time zone ${config.APP_TIME_ZONE})::date::text as due_date, count(*)::int as count,
        (array_agg((template_snapshot->>'title') || ' · ' || (location_snapshot->>'name') order by due_at))[1:4] as examples
      from work_list_occurrences
      where status='MISSED'
        and due_at < (${localDate}::date at time zone ${config.APP_TIME_ZONE})
        and due_at >= ((${localDate}::date - 14) at time zone ${config.APP_TIME_ZONE})
      group by (due_at at time zone ${config.APP_TIME_ZONE})::date
      order by (due_at at time zone ${config.APP_TIME_ZONE})::date
    `;
    for (const digest of missedDates) await sql`
      insert into notifications (recipient_user_id, type, title, message, idempotency_key)
      select distinct u.id, 'WORK_LIST_MISSED_DIGEST', ${`Missed Routine Work · ${digest.due_date}`},
        ${`${digest.count} Routine Work due ${digest.due_date} were missed: ${digest.examples.join(', ')}${digest.count > 4 ? ', and more' : ''}. No worker action is required; this digest is for facilities monitoring only.`},
        ${`work-list-missed-digest:${digest.due_date}:`} || u.id::text
      from users u join user_roles r on r.user_id=u.id
      where u.active and r.role='FACILITIES_MANAGER'
      on conflict (idempotency_key) where idempotency_key is not null do nothing
    `;
  }

  if (dayOfWeek(localDate) !== 1 || localHourInTimeZone(now) !== 8) return;
  const summary = await sql<Array<{ status: string; count: number }>>`select status, count(*)::int as count from work_list_occurrences where period_date >= (${localDate}::date - 7) and period_date < ${localDate}::date group by status`;
  const message = `Previous week Routine Work activity: ${summary.map((row) => `${row.count} ${row.status.toLowerCase().replaceAll('_', ' ')}`).join(', ') || 'no activity'}.`;
  await sql`
    insert into notifications (recipient_user_id, type, title, message, idempotency_key)
    select u.id, 'WORK_LIST_WEEKLY_DIGEST', 'Weekly Routine Work activity', ${message}, 'work-list-digest:' || u.id::text || ':' || ${localDate}
    from users u join user_roles r on r.user_id=u.id where u.active and r.role='FACILITIES_MANAGER'
    on conflict (idempotency_key) where idempotency_key is not null do nothing
  `;
}

async function generateReminders(localDate: string) {
  const workOrders = await sql<ReminderWorkOrder[]>`
    select wo.id, wo.work_order_number, wo.title, wo.due_date::text, wo.priority, wo.reviewer_id,
      coalesce(array_agg(wa.user_id) filter (where wa.user_id is not null), array[wo.primary_assignee_id]) as assignee_ids
    from work_orders wo left join work_order_assignees wa on wa.work_order_id = wo.id
    where wo.status = 'ACTIVE' and wo.removed_at is null and wo.due_date <= (${localDate}::date + 7)
    group by wo.id
  `;
  let generated = 0;
  for (const workOrder of workOrders) {
    const daysUntilDue = daysBetween(workOrder.due_date, localDate);
    const type = reminderType(daysUntilDue, workOrder.priority);
    if (!type) continue;
    const copy = reminderCopy(workOrder, type, daysUntilDue);
    const recipientIds = [...new Set([...workOrder.assignee_ids, workOrder.reviewer_id].filter((id): id is string => Boolean(id)))];
    for (const recipientId of recipientIds) {
      const rows = await sql`
        insert into notifications (recipient_user_id, work_order_id, type, title, message, idempotency_key)
        values (${recipientId}, ${workOrder.id}, ${type}, ${copy.title}, ${copy.message}, ${`reminder:${type}:${workOrder.id}:${recipientId}:${localDate}`})
        on conflict (idempotency_key) where idempotency_key is not null do nothing
        returning id
      `;
      generated += rows.length;
    }
  }
  return generated;
}

async function deliverNotificationEmail(notificationId: string) {
  const rows = await sql<Array<{ id: string; email: string; full_name: string; preferred_locale: NotificationLocale; type: string; title: string; message: string; work_order_id: string | null; work_order_number: string | null; work_order_title: string | null; priority: string | null; condition: string | null; workflow_stage: string | null; due_date: string | null }>>`
    select n.id, u.email::text, u.full_name, u.preferred_locale, n.type, n.title, n.message, n.work_order_id,
      wo.work_order_number, wo.title as work_order_title, wo.priority, wo.condition,
      wo.workflow_stage, wo.due_date::text
    from notifications n
    join users u on u.id = n.recipient_user_id
    left join work_orders wo on wo.id = n.work_order_id
    where n.id = ${notificationId}
  `;
  const notification = rows[0];
  if (!notification) return;
  await sql`update notifications set email_status = 'SENDING', email_attempts = email_attempts + 1 where id = ${notificationId}`;
  const content = renderNotificationEmail({
    type: notification.type,
    title: notification.title,
    message: notification.message,
    recipientName: notification.full_name,
    workOrderId: notification.work_order_id,
    workOrderNumber: notification.work_order_number,
    workOrderTitle: notification.work_order_title,
    priority: notification.priority,
    condition: notification.condition,
    workflowStage: notification.workflow_stage,
    dueDate: notification.due_date,
    locale: notification.preferred_locale,
  });
  const localized = localizeNotification(notification, notification.preferred_locale);
  const delivery = await sendNotificationEmail({
    toEmail: notification.email,
    toName: notification.full_name,
    subject: localized.title,
    text: content.text,
    html: content.html,
  });
  if (delivery.disabled) {
    await sql`update notifications set email_status = 'DISABLED', email_last_error = null where id = ${notificationId}`;
    return;
  }
  await sql`update notifications set email_status = 'SENT', email_sent_at = now(), email_last_error = null where id = ${notificationId}`;
}

export function notificationTargetUrl(type: string, workOrderId: string | null): string | undefined {
  if (type === 'WORK_LIST_DAILY_REMINDER') return '/?view=work-lists';
  return workOrderId ? `/?workOrder=${encodeURIComponent(workOrderId)}` : undefined;
}

async function deliverNotificationPush(notificationId: string) {
  if (!webPushEnabled()) return;
  const rows = await sql<Array<{ id: string; type: string; title: string; message: string; work_order_id: string | null; endpoint: string; p256dh: string; auth: string }>>`
    select n.id, n.type, n.title, n.message, n.work_order_id, ps.endpoint, ps.p256dh, ps.auth
    from notifications n
    join push_subscriptions ps on ps.user_id = n.recipient_user_id
    where n.id = ${notificationId}
  `;
  for (const subscription of rows) {
    try {
      await sendPushNotification(subscription, {
        title: subscription.title,
        body: notificationPushBody(subscription.type, subscription.message),
        notificationId: subscription.id,
        workOrderId: subscription.work_order_id,
        targetUrl: notificationTargetUrl(subscription.type, subscription.work_order_id),
      });
    } catch (error) {
      if (pushSubscriptionHasExpired(error)) {
        await sql`delete from push_subscriptions where endpoint = ${subscription.endpoint}`;
        continue;
      }
      throw error;
    }
  }
}

async function deliverInvitationEmail(userId: string) {
  const rows = await sql<Array<{ email: string; full_name: string; active: boolean; last_login_at: string | null }>>`
    select email::text, full_name, active, last_login_at::text from users where id = ${userId}
  `;
  const user = rows[0];
  if (!user || !user.active || user.last_login_at) return;
  const content = renderInvitationEmail({ recipientName: user.full_name });
  await sendNotificationEmail({
    toEmail: user.email,
    toName: user.full_name,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

async function claimJob(): Promise<JobRow | undefined> {
  return sql.begin(async (transaction) => {
    const rows = await transaction<JobRow[]>`
      select id, job_type, payload, attempts, max_attempts
      from background_jobs
      where status = 'PENDING' and run_at <= now()
      order by run_at, created_at
      for update skip locked
      limit 1
    `;
    const job = rows[0];
    if (!job) return undefined;
    await transaction`
      update background_jobs set status = 'RUNNING', attempts = attempts + 1,
        locked_at = now(), locked_by = ${workerId}, updated_at = now()
      where id = ${job.id}
    `;
    return { ...job, attempts: job.attempts + 1 };
  });
}

async function cleanupPendingAttachments() {
  const expired = await sql<Array<{ id: string; drive_file_id: string | null }>>`
    select id, drive_file_id from attachments
    where status = 'PENDING' and removed_at is null and created_at < now() - interval '24 hours'
    order by created_at limit 100
  `;
  for (const attachment of expired) {
    if (attachment.drive_file_id) await deleteDriveFile(attachment.drive_file_id).catch(() => undefined);
    await sql`update attachments set removed_at = now(), status = 'ATTACHED', pending_action_token = null where id = ${attachment.id} and status = 'PENDING'`;
  }

  const workListUploads = await sql<Array<{ id: string; drive_file_id: string | null }>>`
    select id, drive_file_id from work_list_evidence_uploads
    where status='PENDING' and created_at < now() - interval '24 hours'
    order by created_at limit 100
  `;
  for (const upload of workListUploads) {
    let driveFileId = upload.drive_file_id;
    if (!driveFileId) {
      try { driveFileId = await findDriveFileByAppProperty('workListEvidenceUploadId', upload.id) ?? null; }
      catch { continue; }
    }
    if (driveFileId) {
      const deleted = await deleteDriveFile(driveFileId).then(() => true).catch(() => false);
      if (!deleted) continue;
    }
    await sql`update work_list_evidence_uploads set status='CANCELLED' where id=${upload.id} and status='PENDING'`;
  }
}

async function processJob(job: JobRow) {
  if (job.job_type === 'ATTACHMENT_DRAFT_CLEANUP') {
    await cleanupPendingAttachments();
    return;
  }
  if (job.job_type === 'REMINDER_SCAN') {
    const localDate = zString(job.payload.localDate);
    await generateWorkListOccurrences(localDate);
    await generateReminders(localDate);
    return;
  }
  if (job.job_type === 'NOTIFICATION_EMAIL') {
    await deliverNotificationEmail(zString(job.payload.notificationId));
    return;
  }
  if (job.job_type === 'NOTIFICATION_PUSH') {
    await deliverNotificationPush(zString(job.payload.notificationId));
    return;
  }
  if (job.job_type === 'INVITATION_EMAIL') {
    await deliverInvitationEmail(zString(job.payload.userId));
    return;
  }
  throw new Error(`Unsupported background job type: ${job.job_type}`);
}

function zString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Background job payload is missing a required string.');
  return value;
}

async function finishJob(job: JobRow, error?: unknown) {
  if (!error) {
    await sql`
      update background_jobs set status = 'COMPLETED', completed_at = now(), locked_at = null,
        locked_by = null, last_error = null, updated_at = now() where id = ${job.id}
    `;
    return;
  }
  const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown background job error.';
  const exhausted = job.attempts >= job.max_attempts;
  if (job.job_type === 'NOTIFICATION_EMAIL' && typeof job.payload.notificationId === 'string') {
    await sql`
      update notifications
      set email_status = ${exhausted ? 'FAILED' : 'RETRYING'}, email_last_error = ${message}
      where id = ${job.payload.notificationId}
    `;
  }
  if (exhausted) {
    await sql`
      update background_jobs set status = 'FAILED', last_error = ${message}, locked_at = null,
        locked_by = null, updated_at = now() where id = ${job.id}
    `;
  } else {
    const delaySeconds = Math.min(3600, 60 * (2 ** (job.attempts - 1)));
    await sql`
      update background_jobs set status = 'PENDING', run_at = now() + (${delaySeconds} * interval '1 second'),
        last_error = ${message}, locked_at = null, locked_by = null, updated_at = now() where id = ${job.id}
    `;
  }
}

async function workOnce() {
  if (running) return;
  running = true;
  try {
    for (let processed = 0; processed < config.JOB_BATCH_SIZE; processed += 1) {
      const job = await claimJob();
      if (!job) break;
      try {
        await processJob(job);
        await finishJob(job);
      } catch (error) {
        await finishJob(job, error);
      }
    }
  } finally {
    running = false;
  }
}

async function scheduleReminderScan() {
  const localDate = localDateInTimeZone();
  await Promise.all([
    generateWorkListNotifications(localDate),
    sql`
      insert into background_jobs (job_type, payload, idempotency_key)
      values ('REMINDER_SCAN', ${sql.json({ localDate })}, ${`reminder-scan:${localDate}`})
      on conflict (idempotency_key) do nothing
    `,
    sql`
      insert into background_jobs (job_type, payload, idempotency_key)
      values ('ATTACHMENT_DRAFT_CLEANUP', '{}'::jsonb, ${`attachment-cleanup:${localDate}`})
      on conflict (idempotency_key) do nothing
    `,
  ]);
  await sql`
    update background_jobs set status = 'PENDING', locked_at = null, locked_by = null,
      run_at = now(), updated_at = now(), last_error = coalesce(last_error, 'Recovered stale worker lock.')
    where status = 'RUNNING' and locked_at < now() - interval '15 minutes'
  `;
}

async function runBackgroundTask(name: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[background] ${name} failed; it will retry on the next interval: ${message}`);
  }
}

export async function startBackgroundServices() {
  if (!config.BACKGROUND_JOBS_ENABLED || workerTimer || schedulerTimer) return;
  workerTimer = setInterval(() => void runBackgroundTask('worker', workOnce), config.JOB_POLL_INTERVAL_MS);
  schedulerTimer = setInterval(() => void runBackgroundTask('reminder scheduler', scheduleReminderScan), config.SCHEDULER_INTERVAL_MS);
  workerTimer.unref();
  schedulerTimer.unref();
  await Promise.all([
    runBackgroundTask('initial reminder scheduler', scheduleReminderScan),
    runBackgroundTask('initial worker', workOnce),
  ]);
}

export function stopBackgroundServices() {
  if (workerTimer) clearInterval(workerTimer);
  if (schedulerTimer) clearInterval(schedulerTimer);
  workerTimer = undefined;
  schedulerTimer = undefined;
}
