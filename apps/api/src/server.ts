import { buildApp } from './app.js';
import { config } from './config.js';
import { startBackgroundServices, stopBackgroundServices } from './background.js';
import { revokeLegacyWorkOrderFolderPermissions } from './drive-maintenance.js';

const app = await buildApp();
app.addHook('onClose', async () => stopBackgroundServices());
await app.listen({ host: '0.0.0.0', port: config.PORT });
void revokeLegacyWorkOrderFolderPermissions(app.log).catch((error) => app.log.error(error, 'Legacy Drive permission cleanup failed'));
await startBackgroundServices();
