import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp();

afterAll(async () => {
  await app.close();
});

describe('health endpoint', () => {
  it('reports that the process is live without requiring a database query', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('validation errors', () => {
  it('uses the API error envelope for Zod errors thrown inside route plugins', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/login?redirect=https://example.com' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the submitted information.',
      },
    });
  });
});

describe('public config', () => {
  const mutable = config as { PRODUCTION_URL?: string; AUTH_MODE: string };
  const before = { production: mutable.PRODUCTION_URL, mode: mutable.AUTH_MODE };
  afterEach(() => { mutable.PRODUCTION_URL = before.production; mutable.AUTH_MODE = before.mode; });

  it('has no production address and no Hub on the real stack', async () => {
    mutable.PRODUCTION_URL = undefined;
    mutable.AUTH_MODE = 'test';
    const response = await app.inject({ method: 'GET', url: '/api/v1/public-config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { production_url: null, hub_refresh_url: null, hub_home_url: null } });
  });

  it('gives the production address of a test stack without a trailing slash', async () => {
    mutable.PRODUCTION_URL = 'https://woko.example.org/';
    mutable.AUTH_MODE = 'test';
    const response = await app.inject({ method: 'GET', url: '/api/v1/public-config' });
    expect(response.json().data.production_url).toBe('https://woko.example.org');
  });

  it('tells the page where to renew the Hub session', async () => {
    mutable.AUTH_MODE = 'hub';
    const response = await app.inject({ method: 'GET', url: '/api/v1/public-config' });
    expect(response.json().data.hub_refresh_url).toMatch(/\/auth\/refresh$/);
    expect(response.json().data.hub_home_url).toMatch(/\/$/);
  });
});
