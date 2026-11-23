import { afterAll, describe, expect, it } from 'vitest';
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
  it('has no production address on the real stack', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/public-config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { production_url: null } });
  });

  it('gives the production address of a test stack without a trailing slash', async () => {
    const mutable = config as { PRODUCTION_URL?: string };
    mutable.PRODUCTION_URL = 'https://woko.example.org/';
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/public-config' });
      expect(response.json()).toEqual({ data: { production_url: 'https://woko.example.org' } });
    } finally {
      mutable.PRODUCTION_URL = undefined;
    }
  });
});
