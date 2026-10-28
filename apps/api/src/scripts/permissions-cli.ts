import '../config.js';
import { runPermissionsCli } from 'mws-central-auth/access/cli';
import { permissionManifest } from '@woko/domain';

// permissions:sync and permissions:check (Access Standard AS-4). The command itself is the shared one from the library.
//   npm run permissions:sync  -- [--confirm-removals] [--retries 5 --wait 20]
//   npm run permissions:check -- [--soft]
process.exit(await runPermissionsCli({ application: 'woko', manifest: permissionManifest }));
