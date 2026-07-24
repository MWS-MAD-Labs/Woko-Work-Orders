import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

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
