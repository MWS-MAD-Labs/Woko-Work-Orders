import '../config.js';
import { centralEntitlementSource, syncEntitlements } from '../entitlement-sync.js';
import { sql } from '../database/client.js';

// npm run central:sync -- --dry-run | --apply [--deactivate-unlinked]
// Reads who has access to Woko in Central and makes the users here match (AUTH_MODE=hub). --dry-run changes nothing.
const flags = new Set(process.argv.slice(2));
const known = new Set(['--dry-run', '--apply', '--deactivate-unlinked']);
const mode = flags.has('--apply') && !flags.has('--dry-run') ? 'apply' : flags.has('--dry-run') && !flags.has('--apply') ? 'dry-run' : undefined;
if (!mode || [...flags].some((flag) => !known.has(flag))) {
  console.error('Usage: npm run central:sync -- --dry-run | --apply [--deactivate-unlinked]');
  process.exit(1);
}
try {
  const report = await syncEntitlements({ source: centralEntitlementSource(), mode, deactivateUnlinked: flags.has('--deactivate-unlinked') });
  console.log(report ? JSON.stringify(report, null, 2) : 'Another sync is running.');
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await sql.end();
}
