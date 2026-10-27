import { trackFastifyRoutes, type RouteTracker } from 'mws-central-auth/conformance';
import { buildApp } from '../app.js';
import { sql } from '../database/client.js';

// Used by `mws-access check` (access.config.json): starts the real app, lists its routes, and sends each one as a
// signed-in person who holds no permission at all (Access Standard AS-6). Needs AUTH_MODE=test and a migrated database.
const nobody = '30000000-0000-4000-8000-0000000000ff';

export async function createProbe() {
  let tracker: RouteTracker | undefined;
  const app = await buildApp({ logger: false, prepare: (instance) => { tracker = trackFastifyRoutes(instance); } });
  await app.ready();
  await sql`
    insert into users (id, email, full_name, active) values (${nobody}, 'no-permissions@probe.invalid', 'No Permissions', true)
    on conflict (id) do nothing
  `;
  await sql`delete from user_permissions where user_id = ${nobody}`;
  return {
    routes: tracker!.routes(),
    call: async ({ method, url }: { method: string; url: string }) =>
      (await app.inject({ method: method as 'GET', url, headers: { 'x-test-user-id': nobody }, payload: method === 'GET' || method === 'DELETE' ? undefined : {} })).statusCode,
    close: async () => {
      await sql`delete from users where id = ${nobody}`;
      await app.close();
      await sql.end();
    },
  };
}
