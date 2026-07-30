import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('postgres://woko:woko@localhost:5432/woko'),
  AUTH_MODE: z.enum(['google', 'test']).default('google'),
  ALLOWED_GOOGLE_DOMAIN: z.string().default('millennia21.id'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_PICKER_API_KEY: z.string().min(1).optional(),
  GOOGLE_PICKER_APP_ID: z.string().min(1).optional(),

  APP_TIME_ZONE: z.string().default('Asia/Jakarta'),
  BACKGROUND_JOBS_ENABLED: z.string().default('true').transform((value) => value === 'true'),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
  JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  EMAIL_PROVIDER: z.enum(['disabled', 'gmail']).default('disabled'),
  WEB_PUSH_VAPID_PUBLIC_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  WEB_PUSH_SUBJECT: z.string().url().default('https://woko.app'),
  GMAIL_SENDER_EMAIL: z.preprocess((value) => value === '' ? undefined : value, z.string().email().optional()),
  GMAIL_SENDER_NAME: z.string().trim().min(1).max(100).default('Woko Notifications'),
  GMAIL_APPLICATION_CREDENTIALS: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  GOOGLE_SHARED_DRIVE_ID: z.string().min(1).default('0ACDajqMZCk-DUk9PVA'),
  GOOGLE_WORK_ORDERS_ROOT_FOLDER_ID: z.string().min(1).default('15S3zlBJJG4mYpHwhv707eC0SLNk3jUEP'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
});

export const config = schema.transform((value) => ({
  ...value,
  WEB_PUSH_ENABLED: Boolean(value.WEB_PUSH_VAPID_PUBLIC_KEY && value.WEB_PUSH_VAPID_PRIVATE_KEY),
})).parse(process.env);

if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'test') {
  throw new Error('Test authentication cannot be enabled in production.');
}
if (config.EMAIL_PROVIDER === 'gmail' && (!config.GMAIL_SENDER_EMAIL || !config.GMAIL_APPLICATION_CREDENTIALS)) {
  throw new Error('Gmail delivery requires GMAIL_SENDER_EMAIL and GMAIL_APPLICATION_CREDENTIALS.');
}
if (Boolean(config.WEB_PUSH_VAPID_PUBLIC_KEY) !== Boolean(config.WEB_PUSH_VAPID_PRIVATE_KEY)) {
  throw new Error('Web Push requires both WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY.');
}
