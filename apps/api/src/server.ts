import { buildApp } from './app.js';
import { config } from './config.js';
import { startBackgroundServices, stopBackgroundServices } from './background.js';
import { revokeLegacyWorkOrderFolderPermissions } from './drive-maintenance.js';
import { scheduleEntitlementSync } from './entitlement-sync.js';

const app = await buildApp();
const entitlementSync = scheduleEntitlementSync(app.log);
app.addHook('onClose', async () => { entitlementSync?.stop(); await stopBackgroundServices(); });
await app.listen({ host: '0.0.0.0', port: config.PORT });
app.log.info({ authMode: config.AUTH_MODE, appBaseUrl: config.APP_BASE_URL }, 'Sign-in mode');
void revokeLegacyWorkOrderFolderPermissions(app.log).catch((error) => app.log.error(error, 'Legacy Drive permission cleanup failed'));
await startBackgroundServices();
