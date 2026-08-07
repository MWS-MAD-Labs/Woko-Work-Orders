import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdministrator } from './auth.js';
import { sql } from './database/client.js';
import { localizeNotification } from './notification-localization.js';
import { config } from './config.js';

const notificationParams = z.object({ id: z.string().uuid() });
const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4_000),
  keys: z.object({ p256dh: z.string().min(1).max(1_000), auth: z.string().min(1).max(1_000) }),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/notifications/push-public-key', async () => {
    const { webPushEnabled, webPushPublicKey } = await import('./push.js');
    return { data: { enabled: webPushEnabled(), publicKey: webPushPublicKey() ?? null } };
  });

  app.put('/notifications/push-subscription', async (request) => {
    const subscription = pushSubscriptionSchema.parse(request.body);
    await sql`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth)
      values (${request.currentUser.id}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, updated_at = now()
    `;
    return { data: { subscribed: true } };
  });

  app.delete('/notifications/push-subscription', async (request) => {
    const subscription = pushSubscriptionSchema.parse(request.body);
    await sql`delete from push_subscriptions where user_id = ${request.currentUser.id} and endpoint = ${subscription.endpoint}`;
    return { data: { subscribed: false } };
  });

  app.get('/notifications', async (request) => {
    const query = z.object({
      unreadOnly: z.coerce.boolean().default(false),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    const rows = await sql`
      select n.id, n.work_order_id, n.type, n.title, n.message, n.read_status,
        n.email_status, n.email_attempts, n.email_last_error, n.email_sent_at::text,
        n.created_at::text, n.read_at::text, n.acknowledged_at::text,
        wo.work_order_number
      from notifications n
      left join work_orders wo on wo.id = n.work_order_id
      where n.recipient_user_id = ${request.currentUser.id}
        and (n.work_order_id is null or wo.removed_at is null)
        ${query.unreadOnly ? sql`and n.read_status = false` : sql``}
      order by n.created_at desc
      limit ${query.limit}
    `;
    return { data: rows.map((row) => localizeNotification(row as { type: string; title: string; message: string }, request.currentUser.preferredLocale)) };
  });

  app.get('/notifications/:id/digest', async (request, reply) => {
    const { id } = notificationParams.parse(request.params);
    const notifications = await sql<Array<{ id: string; type: string; title: string; message: string; idempotency_key: string | null; created_at: string }>>`
      select id, type, title, message, idempotency_key, created_at::text
      from notifications
      where id = ${id} and recipient_user_id = ${request.currentUser.id}
        and type in ('WORK_LIST_MISSED_DIGEST', 'WORK_LIST_WEEKLY_DIGEST')
    `;
    const notification = notifications[0];
    if (!notification) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Digest not found.', requestId: request.id } });

    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    let rows: Array<Record<string, unknown>> = [];
    const missedDate = notification.idempotency_key?.match(/^work-list-missed-digest:(\d{4}-\d{2}-\d{2}):/)?.[1];
    const weeklyDate = notification.idempotency_key?.match(/:(\d{4}-\d{2}-\d{2})$/)?.[1];

    if (notification.type === 'WORK_LIST_MISSED_DIGEST' && missedDate) {
      periodStart = missedDate;
      periodEnd = missedDate;
      rows = await sql`
        select o.id, o.template_id, o.status, o.recurrence, o.period_date::text, o.due_at::text,
          o.template_snapshot->>'title' as title, o.location_snapshot->>'name' as location,
          coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id), 0) item_count,
          coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id and i.status is not null), 0) resolved_count,
          coalesce((select json_agg(u.full_name order by u.full_name) from users u where u.id = any(o.worker_ids)), '[]'::json) workers
        from work_list_occurrences o
        where o.status='MISSED' and (o.due_at at time zone ${config.APP_TIME_ZONE})::date=${missedDate}::date
        order by o.due_at, title, location
      `;
    } else if (notification.type === 'WORK_LIST_WEEKLY_DIGEST' && weeklyDate) {
      periodStart = await sql<Array<{ value: string }>>`select (${weeklyDate}::date - 7)::text as value`.then((result) => result[0]?.value ?? null);
      periodEnd = weeklyDate;
      rows = await sql`
        select o.id, o.template_id, o.status, o.recurrence, o.period_date::text, o.due_at::text,
          o.template_snapshot->>'title' as title, o.location_snapshot->>'name' as location,
          coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id), 0) item_count,
          coalesce((select count(*)::int from work_list_occurrence_items i where i.occurrence_id=o.id and i.status is not null), 0) resolved_count,
          coalesce((select json_agg(u.full_name order by u.full_name) from users u where u.id = any(o.worker_ids)), '[]'::json) workers
        from work_list_occurrences o
        where o.period_date >= (${weeklyDate}::date - 7) and o.period_date < ${weeklyDate}::date
        order by o.period_date desc, title, location
      `;
    }

    return { data: { ...localizeNotification(notification, request.currentUser.preferredLocale), created_at: notification.created_at, period_start: periodStart, period_end: periodEnd, items: rows } };
  });

  app.post('/notifications/:id/retry-email', { preHandler: requireAdministrator }, async (request, reply) => {
    const { id } = notificationParams.parse(request.params);
    const result = await sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ email_status: string }>>`
        select email_status from notifications where id = ${id} for update
      `;
      const notification = rows[0];
      if (!notification) return { error: 'NOT_FOUND' } as const;
      if (notification.email_status !== 'FAILED') return { error: 'EMAIL_NOT_FAILED' } as const;

      await transaction`
        update notifications
        set email_status = 'PENDING', email_attempts = 0, email_last_error = null, email_sent_at = null
        where id = ${id}
      `;
      await transaction`
        insert into background_jobs (job_type, payload, idempotency_key)
        values ('NOTIFICATION_EMAIL', ${transaction.json({ notificationId: id })}, ${`notification-email-retry:${id}:${crypto.randomUUID()}`})
      `;
      return { retried: true } as const;
    });
    if (result.error === 'NOT_FOUND') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Notification not found.', requestId: request.id } });
    if (result.error === 'EMAIL_NOT_FAILED') return reply.code(422).send({ error: { code: 'EMAIL_NOT_FAILED', message: 'Only failed notification emails can be retried.', requestId: request.id } });
    return { data: result };
  });

  app.get('/notifications/unread-count', async (request) => {
    const rows = await sql<Array<{ count: number }>>`
      select count(*)::int as count from notifications n
      left join work_orders wo on wo.id = n.work_order_id
      where n.recipient_user_id = ${request.currentUser.id} and n.read_status = false
        and (n.work_order_id is null or wo.removed_at is null)
    `;
    return { data: { count: rows[0]?.count ?? 0 } };
  });

  app.post('/notifications/read-all', async (request) => {
    const rows = await sql<Array<{ id: string }>>`
      update notifications n set read_status = true, read_at = coalesce(n.read_at, now())
      where n.recipient_user_id = ${request.currentUser.id} and n.read_status = false
        and (n.work_order_id is null or exists (select 1 from work_orders wo where wo.id = n.work_order_id and wo.removed_at is null))
      returning id
    `;
    return { data: { updated: rows.length } };
  });

  app.post('/notifications/:id/read', async (request, reply) => {
    const { id } = notificationParams.parse(request.params);
    const rows = await sql`
      update notifications set read_status = true, read_at = coalesce(read_at, now())
      where id = ${id} and recipient_user_id = ${request.currentUser.id}
      returning id, read_status, read_at::text, acknowledged_at::text
    `;
    if (!rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Notification not found.', requestId: request.id } });
    return { data: rows[0] };
  });

  app.post('/notifications/:id/acknowledge', async (request, reply) => {
    const { id } = notificationParams.parse(request.params);
    const rows = await sql`
      update notifications set read_status = true, read_at = coalesce(read_at, now()), acknowledged_at = coalesce(acknowledged_at, now())
      where id = ${id} and recipient_user_id = ${request.currentUser.id}
      returning id, read_status, read_at::text, acknowledged_at::text
    `;
    if (!rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Notification not found.', requestId: request.id } });
    return { data: rows[0] };
  });
}
