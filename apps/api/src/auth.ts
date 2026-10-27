import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, canAny, isPermission, type Permission } from '@woko/domain';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { sql } from './database/client.js';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  profilePhotoUrl?: string;
  permissions: Permission[];
  preferredLocale: 'id' | 'en';
  sessionExpiresAt: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser;
  }
}

export const sessionCookieName = 'woko_session';
export const sessionDurationHours = 24 * 30;
export const sessionCookieOptions = {
  path: '/',
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: sessionDurationHours * 60 * 60,
};

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeHashEquals(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(sha256(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function oauthClient(redirectUri = `${config.APP_BASE_URL}/api/v1/auth/callback`): OAuth2Client {
  if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials are not configured.');
  }
  return new OAuth2Client({
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri,
  });
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (config.AUTH_MODE === 'test') {
    const userId = request.headers['x-test-user-id'] ?? '30000000-0000-4000-8000-000000000001';
    const rows = await sql<Array<{ id: string; email: string; full_name: string; active: boolean; preferred_locale: 'id' | 'en'; permissions: string[] }>>`
      select u.id, u.email::text, u.full_name, u.active, u.preferred_locale,
        coalesce(array_agg(up.permission) filter (where up.permission is not null), '{}') as permissions
      from users u left join user_permissions up on up.user_id = u.id
      where u.id = ${userId}::uuid
      group by u.id
    `;
    const user = rows[0];
    if (!user || !user.active) return reply.code(401).send({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Test user is not active.', requestId: request.id } });
    request.currentUser = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      permissions: user.permissions.filter(isPermission),
      preferredLocale: user.preferred_locale,
      sessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    return;
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.origin;
    if (!origin || new URL(origin).origin !== new URL(config.APP_BASE_URL).origin) {
      return reply.code(403).send({ error: { code: 'INVALID_ORIGIN', message: 'The request origin is not allowed.', requestId: request.id } });
    }
  }

  const token = request.cookies[sessionCookieName];
  if (!token) return reply.code(401).send({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in with your Millennia World School account.', requestId: request.id } });
  const rows = await sql<Array<{ id: string; email: string; full_name: string; profile_photo_url: string | null; active: boolean; preferred_locale: 'id' | 'en'; expires_at: string; permissions: string[] }>>`
    select u.id, u.email::text, u.full_name, u.profile_photo_url, u.active, u.preferred_locale, s.expires_at::text,
      coalesce(array_agg(up.permission) filter (where up.permission is not null), '{}') as permissions
    from user_sessions s
    join users u on u.id = s.user_id
    left join user_permissions up on up.user_id = u.id
    where s.token_hash = ${sha256(token)} and s.revoked_at is null and s.expires_at > now()
    group by u.id, s.id
  `;
  const user = rows[0];
  if (!user || !user.active) {
    reply.clearCookie(sessionCookieName, sessionCookieOptions);
    return reply.code(401).send({ error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Sign in again.', requestId: request.id } });
  }
  await sql`update user_sessions set last_seen_at = now() where token_hash = ${sha256(token)}`;
  request.currentUser = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    profilePhotoUrl: user.profile_photo_url ?? undefined,
    permissions: user.permissions.filter(isPermission),
    preferredLocale: user.preferred_locale,
    sessionExpiresAt: user.expires_at,
  };
}

const forbidden = (request: FastifyRequest, reply: FastifyReply) =>
  reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do this.', requestId: request.id } });

// The gate of a route: it needs this permission.
export function requirePermission(permission: Permission) {
  return async function requireThePermission(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!can(request.currentUser.permissions, permission)) await forbidden(request, reply);
  };
}

// The gate of a route that several kinds of people use: any one of these will do. Whether the person belongs to this
// particular work order is checked inside the route.
export function requireAnyPermission(wanted: readonly Permission[]) {
  return async function requireOneOfThePermissions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!canAny(request.currentUser.permissions, wanted)) await forbidden(request, reply);
  };
}
