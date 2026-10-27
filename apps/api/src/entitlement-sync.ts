import { CentralDataClient } from 'mws-central-auth/data-client';
import { isPermission } from '@woko/domain';
import { config } from './config.js';
import { sql } from './database/client.js';

// In hub mode Central decides who may use Woko and with what permissions (Access Standard AS-1). The places that need
// other people's permissions (pick lists, who gets a notification, who approves a booking) read the stored rows, so this
// keeps those rows the same as the entitlements in Central. It never deletes a user; a person who lost access is only
// switched off and has no stored permissions.

export interface EntitlementRow {
  person_id: string;
  is_active: boolean;
  permissions: readonly string[];
  person: { full_name: string; email: string };
}

export interface EntitlementSource {
  listAllApplicationEntitlements(params: { application_id: string }): Promise<EntitlementRow[]>;
}

export interface EntitlementSyncReport {
  mode: 'dry-run' | 'apply';
  entitlementsSeen: number;
  created: number;
  linked: number;
  renamed: number;
  permissionsChanged: number;
  deactivated: number;
  // Users here with no person id and no match by email in Central. Kept as they are unless told to switch them off.
  unlinkedLocalUsers: number;
}

class RollBack extends Error {}

type Database = typeof sql;

export async function syncEntitlements(options: {
  source: EntitlementSource;
  application?: string;
  mode: 'dry-run' | 'apply';
  deactivateUnlinked?: boolean;
  db?: Database;
}): Promise<EntitlementSyncReport | undefined> {
  const db = options.db ?? sql;
  const application = options.application ?? config.CENTRAL_APPLICATION_ID;
  const entitlements = await options.source.listAllApplicationEntitlements({ application_id: application });
  const active = entitlements.filter((row) => row.is_active && row.person?.email);
  const report: EntitlementSyncReport = { mode: options.mode, entitlementsSeen: active.length, created: 0, linked: 0, renamed: 0, permissionsChanged: 0, deactivated: 0, unlinkedLocalUsers: 0 };
  try {
    return await db.begin(async (tx) => {
      const lock = await tx<Array<{ locked: boolean }>>`select pg_try_advisory_xact_lock(hashtext('woko-entitlement-sync')) as locked`;
      if (!lock[0]?.locked) return undefined;
      const linkedCount = (await tx<Array<{ count: number }>>`select count(*)::int as count from users where central_person_id is not null`)[0]!.count;
      if (active.length === 0 && linkedCount > 0) {
        throw new Error('Central listed nobody with access to Woko. Nothing was changed, in case that is a mistake.');
      }
      const seen = new Set<string>();
      for (const row of active) {
        const email = row.person.email.trim().toLowerCase();
        const wanted = [...new Set(row.permissions)].filter(isPermission).sort();
        seen.add(row.person_id);
        let user = (await tx<Array<{ id: string; full_name: string; active: boolean }>>`select id, full_name, active from users where central_person_id = ${row.person_id} for update`)[0];
        if (!user) {
          const byEmail = (await tx<Array<{ id: string; full_name: string; active: boolean; central_person_id: string | null }>>`select id, full_name, active, central_person_id from users where email = ${email} for update`)[0];
          if (byEmail && byEmail.central_person_id && byEmail.central_person_id !== row.person_id) continue;
          if (byEmail) {
            await tx`update users set central_person_id = ${row.person_id}, updated_at = now() where id = ${byEmail.id}`;
            report.linked += 1;
            user = byEmail;
          } else {
            const created = await tx<Array<{ id: string }>>`insert into users (central_person_id, email, full_name, active) values (${row.person_id}, ${email}, ${row.person.full_name}, true) returning id`;
            report.created += 1;
            user = { id: created[0]!.id, full_name: row.person.full_name, active: true };
          }
        }
        if (user.full_name !== row.person.full_name && row.person.full_name.trim()) {
          await tx`update users set full_name = ${row.person.full_name}, updated_at = now() where id = ${user.id}`;
          report.renamed += 1;
        }
        if (!user.active) await tx`update users set active = true, updated_at = now() where id = ${user.id}`;
        const stored = (await tx<Array<{ permission: string }>>`select permission from user_permissions where user_id = ${user.id}`).map((item) => item.permission).sort();
        if (stored.join('\n') !== wanted.join('\n')) {
          await tx`delete from user_permissions where user_id = ${user.id}`;
          if (wanted.length) await tx`insert into user_permissions (user_id, permission) select ${user.id}, unnest(${wanted}::text[])`;
          report.permissionsChanged += 1;
        }
      }
      const linked = await tx<Array<{ id: string; central_person_id: string }>>`select id, central_person_id from users where central_person_id is not null and active`;
      const gone = linked.filter((user) => !seen.has(user.central_person_id));
      for (const user of gone) {
        await tx`update users set active = false, updated_at = now() where id = ${user.id}`;
        await tx`delete from user_permissions where user_id = ${user.id}`;
        report.deactivated += 1;
      }
      const unlinked = await tx<Array<{ id: string }>>`select id from users where central_person_id is null and active`;
      report.unlinkedLocalUsers = unlinked.length;
      if (options.deactivateUnlinked) {
        for (const user of unlinked) {
          await tx`update users set active = false, updated_at = now() where id = ${user.id}`;
          await tx`delete from user_permissions where user_id = ${user.id}`;
          report.deactivated += 1;
        }
      }
      if (options.mode === 'dry-run') throw new RollBack();
      return report;
    });
  } catch (error) {
    if (error instanceof RollBack) return report;
    throw error;
  }
}

export function centralEntitlementSource(): EntitlementSource {
  const client = new CentralDataClient({
    baseUrl: config.CENTRAL_API_BASE_URL!.replace(/\/+$/, '').replace(/\/api\/internal$/, ''),
    token: config.CENTRAL_API_TOKEN!,
    organizationId: config.CENTRAL_ORGANIZATION_ID,
  });
  return client as unknown as EntitlementSource;
}

type Logger = { info(object: unknown, message?: string): void; warn(object: unknown, message?: string): void };

// Runs once soon after start and then every CENTRAL_SYNC_INTERVAL_MINUTES, only in hub mode.
export function scheduleEntitlementSync(logger: Logger, source: EntitlementSource = centralEntitlementSource()): { stop: () => void } | undefined {
  if (config.AUTH_MODE !== 'hub' || config.CENTRAL_SYNC_INTERVAL_MINUTES <= 0) return undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await syncEntitlements({ source, mode: 'apply' });
      if (report) logger.info(report, 'entitlements synchronized');
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : 'unknown error' }, 'entitlement sync failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), config.CENTRAL_SYNC_INTERVAL_MINUTES * 60_000);
  first.unref();
  timer.unref();
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}
