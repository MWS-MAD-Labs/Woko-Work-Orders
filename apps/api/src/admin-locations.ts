import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdministrator } from './auth.js';
import { sql } from './database/client.js';

const nameSchema = z.string().trim().min(1).max(160);
const codeSchema = z.string().trim().min(1).max(40).transform((value) => value.toUpperCase());
const locationTypeSchema = z.string().trim().min(1).max(40).transform((value) => value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_'));

const locationConfigurationSchema = z.object({
  campuses: z.array(z.object({ id: z.string().uuid(), code: codeSchema, name: nameSchema, active: z.boolean() })),
  buildings: z.array(z.object({ id: z.string().uuid(), campusId: z.string().uuid(), code: codeSchema, name: nameSchema, active: z.boolean() })),
  options: z.array(z.object({
    id: z.string().uuid(), buildingId: z.string().uuid(), parentId: z.string().uuid().nullable(), typeLabel: locationTypeSchema,
    code: z.string().trim().max(40).nullable(), name: nameSchema, active: z.boolean(), sortOrder: z.number().int().min(-10000).max(10000),
  })),
  removedBuildingIds: z.array(z.string().uuid()),
  removedOptionIds: z.array(z.string().uuid()),
});

export async function adminLocationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireAdministrator);

  app.get('/admin/locations', async () => {
    const [campuses, buildings, options] = await Promise.all([
      sql`select id, code, name, active from campuses order by name`,
      sql`select id, campus_id, code, name, active from buildings where removed_at is null order by name`,
      sql`
        select id, building_id, parent_id, type_label, code, name, active, sort_order
        from location_options where removed_at is null order by building_id, parent_id nulls first, sort_order, name
      `,
    ]);
    return { data: { campuses, buildings, options } };
  });

  app.put('/admin/locations', async (request, reply) => {
    const input = locationConfigurationSchema.parse(request.body);
    const campusIds = new Set(input.campuses.map((campus) => campus.id));
    const buildingIds = new Set(input.buildings.map((building) => building.id));
    const optionById = new Map(input.options.map((option) => [option.id, option]));
    const campusCodes = new Set<string>();
    const buildingCodes = new Set<string>();
    const optionNames = new Set<string>();

    for (const campus of input.campuses) {
      if (campusCodes.has(campus.code)) return reply.code(409).send({ error: { code: 'DUPLICATE_CAMPUS_CODE', message: `Campus code ${campus.code} is duplicated.`, requestId: request.id } });
      campusCodes.add(campus.code);
    }
    for (const building of input.buildings) {
      if (!campusIds.has(building.campusId)) return reply.code(422).send({ error: { code: 'INVALID_CAMPUS', message: 'Every building must belong to a valid campus.', requestId: request.id } });
      const key = `${building.campusId}:${building.code}`;
      if (buildingCodes.has(key)) return reply.code(409).send({ error: { code: 'DUPLICATE_BUILDING_CODE', message: `Building code ${building.code} is duplicated within a campus.`, requestId: request.id } });
      buildingCodes.add(key);
    }
    for (const option of input.options) {
      if (!buildingIds.has(option.buildingId)) return reply.code(422).send({ error: { code: 'INVALID_BUILDING', message: 'Every location option must belong to a valid building.', requestId: request.id } });
      if (option.parentId) {
        const parent = optionById.get(option.parentId);
        if (!parent || parent.buildingId !== option.buildingId) return reply.code(422).send({ error: { code: 'INVALID_LOCATION_PARENT', message: 'A location parent must belong to the same building.', requestId: request.id } });
      }
      const key = `${option.buildingId}:${option.parentId ?? 'root'}:${option.name.toLowerCase()}`;
      if (optionNames.has(key)) return reply.code(409).send({ error: { code: 'DUPLICATE_LOCATION_NAME', message: `${option.name} is duplicated under the same parent.`, requestId: request.id } });
      optionNames.add(key);
    }

    const result = await sql.begin(async (transaction) => {
      if (input.removedOptionIds.length) {
        await transaction`
          with recursive removed_options as (
            select id from location_options where id = any(${input.removedOptionIds}::uuid[])
            union all select child.id from location_options child join removed_options parent on child.parent_id = parent.id
          )
          update location_options set active = false, removed_at = now(), updated_at = now() where id in (select id from removed_options)
        `;
      }
      if (input.removedBuildingIds.length) {
        await transaction`update location_options set active = false, removed_at = now(), updated_at = now() where building_id = any(${input.removedBuildingIds}::uuid[])`;
        await transaction`update buildings set active = false, removed_at = now() where id = any(${input.removedBuildingIds}::uuid[])`;
      }
      if (input.campuses.length) await transaction`update campuses set code = id::text where id = any(${input.campuses.map((campus) => campus.id)}::uuid[])`;
      if (input.buildings.length) await transaction`update buildings set code = id::text where id = any(${input.buildings.map((building) => building.id)}::uuid[])`;
      if (input.options.length) await transaction`update location_options set name = id::text where id = any(${input.options.map((option) => option.id)}::uuid[])`;
      for (const campus of input.campuses) {
        await transaction`
          insert into campuses (id, code, name, active) values (${campus.id}, ${campus.code}, ${campus.name}, ${campus.active})
          on conflict (id) do update set code = excluded.code, name = excluded.name, active = excluded.active
        `;
      }
      for (const building of input.buildings) {
        const existing = await transaction<Array<{ campus_id: string; in_use: boolean }>>`
          select b.campus_id, exists(select 1 from work_orders wo where wo.building_id = b.id) as in_use from buildings b where b.id = ${building.id}
        `;
        if (existing[0]?.in_use && existing[0].campus_id !== building.campusId) return { error: 'BUILDING_CAMPUS_LOCKED' } as const;
        await transaction`
          insert into buildings (id, campus_id, code, name, active, removed_at)
          values (${building.id}, ${building.campusId}, ${building.code}, ${building.name}, ${building.active}, null)
          on conflict (id) do update set campus_id = excluded.campus_id, code = excluded.code, name = excluded.name, active = excluded.active, removed_at = null
        `;
      }
      const pendingOptions = [...input.options];
      const savedOptionIds = new Set<string>();
      while (pendingOptions.length) {
        const readyIndex = pendingOptions.findIndex((option) => !option.parentId || savedOptionIds.has(option.parentId));
        if (readyIndex < 0) return { error: 'LOCATION_CYCLE' } as const;
        const [option] = pendingOptions.splice(readyIndex, 1);
        await transaction`
          insert into location_options (id, building_id, parent_id, type_label, code, name, active, sort_order, removed_at)
          values (${option!.id}, ${option!.buildingId}, ${option!.parentId}, ${option!.typeLabel}, ${option!.code?.toUpperCase() ?? null}, ${option!.name}, ${option!.active}, ${option!.sortOrder}, null)
          on conflict (id) do update set building_id = excluded.building_id, parent_id = excluded.parent_id, type_label = excluded.type_label,
            code = excluded.code, name = excluded.name, active = excluded.active, sort_order = excluded.sort_order, removed_at = null, updated_at = now()
        `;
        savedOptionIds.add(option!.id);
      }
      await transaction`
        insert into audit_events (user_id, event_type, new_data, correlation_id)
        values (${request.currentUser.id}, 'LOCATION_CONFIGURATION_SAVED', ${transaction.json({ campusCount: input.campuses.length, buildingCount: input.buildings.length, optionCount: input.options.length, removedBuildingIds: input.removedBuildingIds, removedOptionIds: input.removedOptionIds })}, ${request.id})
      `;
      return { saved: true } as const;
    });

    if ('error' in result && result.error) {
      const messages: Record<string, string> = {
        BUILDING_CAMPUS_LOCKED: 'A building used by work orders cannot be moved to another campus.',
        LOCATION_CYCLE: 'Location options contain an invalid parent cycle.',
      };
      return reply.code(422).send({ error: { code: result.error, message: messages[result.error] ?? 'Location configuration could not be saved.', requestId: request.id } });
    }
    return { data: result };
  });
}
