import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { config } from './config.js';
import { sql } from './database/client.js';
import { workOrderRoutes } from './work-orders.js';
import { authRoutes } from './auth-routes.js';
import { notificationRoutes } from './notifications.js';
import { reportRoutes } from './reports.js';
import { adminLocationRoutes } from './admin-locations.js';
import { adminWorkSettingRoutes } from './admin-work-settings.js';

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true, genReqId: () => crypto.randomUUID() });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://apis.google.com', 'https://accounts.google.com'],
        frameSrc: ["'self'", 'https://accounts.google.com', 'https://docs.google.com', 'https://drive.google.com'],
        connectSrc: ["'self'", 'https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://www.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      },
    },
  });
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { files: 1, fields: 4, parts: 5, fileSize: 15 * 1024 * 1024, fieldSize: 10 * 1024 },
  });

  app.setErrorHandler((error, request, reply) => {
    const isZodError = error instanceof ZodError
      || (error instanceof Error && error.name === 'ZodError' && 'flatten' in error && typeof error.flatten === 'function');
    if (isZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted information.', details: (error as ZodError).flatten(), requestId: request.id } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId: request.id } });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await sql`select 1`;
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(workOrderRoutes, { prefix: '/api/v1' });
  await app.register(notificationRoutes, { prefix: '/api/v1' });
  await app.register(reportRoutes, { prefix: '/api/v1' });
  await app.register(adminLocationRoutes, { prefix: '/api/v1' });
  await app.register(adminWorkSettingRoutes, { prefix: '/api/v1' });
  return app;
}
