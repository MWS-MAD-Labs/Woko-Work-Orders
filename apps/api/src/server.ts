import { buildApp } from './app.js';
import { config } from './config.js';
import { startBackgroundServices, stopBackgroundServices } from './background.js';

const app = await buildApp();
app.addHook('onClose', async () => stopBackgroundServices());
await app.listen({ host: '0.0.0.0', port: config.PORT });
await startBackgroundServices();
