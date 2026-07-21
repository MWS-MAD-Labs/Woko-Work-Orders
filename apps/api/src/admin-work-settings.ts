import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { workTypes, executionWindows } from '@woko/domain';
import { authenticate, requireAdministrator } from './auth.js';
import { sql } from './database/client.js';

const optionTypeSchema = z.enum(['WORK_TYPE', 'CATEGORY', 'EXECUTION_WINDOW']);
const codeSchema = z.string().trim().min(1).max(80).transform((value) => value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_'));
const fixedCodes = new Set<string>([...workTypes, ...executionWindows]);

export async function adminWorkSettingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireAdministrator);

  app.get('/admin/work-settings', async () => {
    const options = await sql`
      select id, option_type, code, label, active, sort_order
      from organization_work_options where removed_at is null
      order by option_type, sort_order, label
    `;
    return { data: options };
  });

  app.put('/admin/work-settings', async (request, reply) => {
    const input = z.object({
      options: z.array(z.object({ id: z.string().uuid(), optionType: optionTypeSchema, code: codeSchema, label: z.string().trim().min(1).max(160), active: z.boolean(), sortOrder: z.number().int().min(-10000).max(10000) })),
      removedIds: z.array(z.string().uuid()),
    }).parse(request.body);
    const keys = new Set<string>();
    for (const option of input.options) {
      const key = `${option.optionType}:${option.code}`;
      if (keys.has(key)) return reply.code(409).send({ error: { code: 'DUPLICATE_WORK_OPTION', message: `${option.label} uses a duplicate code.`, requestId: request.id } });
      keys.add(key);
      if (option.optionType === 'WORK_TYPE' && !workTypes.includes(option.code as typeof workTypes[number])) return reply.code(422).send({ error: { code: 'INVALID_WORK_TYPE', message: 'Work type codes must remain INTERNAL or VENDOR because they control workflow behavior.', requestId: request.id } });
      if (option.optionType === 'EXECUTION_WINDOW' && !executionWindows.includes(option.code as typeof executionWindows[number])) return reply.code(422).send({ error: { code: 'INVALID_EXECUTION_WINDOW', message: 'Execution-window codes are fixed because they control validation behavior.', requestId: request.id } });
    }
    const removed = await sql<Array<{ code: string }>>`select code from organization_work_options where id = any(${input.removedIds}::uuid[])`;
    if (removed.some((option) => fixedCodes.has(option.code))) return reply.code(422).send({ error: { code: 'FIXED_OPTION_REMOVAL', message: 'Work types and execution windows can be renamed or disabled, but not removed.', requestId: request.id } });

    await sql.begin(async (transaction) => {
      if (input.removedIds.length) await transaction`update organization_work_options set active = false, removed_at = now(), updated_at = now() where id = any(${input.removedIds}::uuid[])`;
      if (input.options.length) await transaction`update organization_work_options set code = id::text where id = any(${input.options.map((option) => option.id)}::uuid[])`;
      for (const option of input.options) {
        await transaction`
          insert into organization_work_options (id, option_type, code, label, active, sort_order, removed_at)
          values (${option.id}, ${option.optionType}, ${option.code}, ${option.label}, ${option.active}, ${option.sortOrder}, null)
          on conflict (id) do update set option_type = excluded.option_type, code = excluded.code, label = excluded.label,
            active = excluded.active, sort_order = excluded.sort_order, removed_at = null, updated_at = now()
        `;
      }
      await transaction`
        insert into audit_events (user_id, event_type, new_data, correlation_id)
        values (${request.currentUser.id}, 'WORK_CONFIGURATION_SAVED', ${transaction.json({ optionCount: input.options.length, removedIds: input.removedIds })}, ${request.id})
      `;
    });
    return { data: { saved: true } };
  });
}
