import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from './auth.js';
import { sql } from './database/client.js';
import { localizeNotification } from './notification-localization.js';

const notificationParams = z.object({ id: z.string().uuid() });

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

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
        ${query.unreadOnly ? sql`and n.read_status = false` : sql``}
      order by n.created_at desc
      limit ${query.limit}
    `;
    return { data: rows.map((row) => localizeNotification(row as { type: string; title: string; message: string }, request.currentUser.preferredLocale)) };
  });

  app.get('/notifications/unread-count', async (request) => {
    const rows = await sql<Array<{ count: number }>>`
      select count(*)::int as count from notifications
      where recipient_user_id = ${request.currentUser.id} and read_status = false
    `;
    return { data: { count: rows[0]?.count ?? 0 } };
  });

  app.post('/notifications/read-all', async (request) => {
    const rows = await sql<Array<{ id: string }>>`
      update notifications set read_status = true, read_at = coalesce(read_at, now())
      where recipient_user_id = ${request.currentUser.id} and read_status = false
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
