import type { FastifyInstance } from 'fastify';
import { roles, type Role } from '@woko/domain';
import { CodeChallengeMethod } from 'google-auth-library';
import { z } from 'zod';
import { authenticate, oauthClient, randomToken, requireAdministrator, safeHashEquals, sessionCookieName, sessionCookieOptions, sha256 } from './auth.js';
import { config } from './config.js';
import { sql } from './database/client.js';

const googleIssuers = new Set(['accounts.google.com', 'https://accounts.google.com']);
const redirectPathSchema = z.string().regex(/^\/(?!\/)/).max(500).default('/');

function loginErrorUrl(code: string): string {
  const url = new URL('/login', config.APP_BASE_URL);
  url.searchParams.set('error', code);
  return url.toString();
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/auth/login', async (request, reply) => {
    const { redirect } = z.object({ redirect: redirectPathSchema.optional() }).parse(request.query);
    if (config.AUTH_MODE !== 'google') return reply.code(503).send({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Google authentication is not enabled.', requestId: request.id } });
    const client = oauthClient();
    const state = randomToken();
    const nonce = randomToken();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    await sql`
      insert into auth_login_attempts (state_hash, nonce_hash, code_verifier, redirect_path, expires_at)
      values (${sha256(state)}, ${sha256(nonce)}, ${codeVerifier}, ${redirect ?? '/'}, now() + interval '10 minutes')
    `;
    const url = client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      nonce,
      hd: config.ALLOWED_GOOGLE_DOMAIN,
      prompt: 'select_account',
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    return reply.redirect(url);
  });

  app.get('/auth/callback', async (request, reply) => {
    const input = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(request.query);
    if (!input.success || config.AUTH_MODE !== 'google') return reply.redirect(loginErrorUrl('INVALID_CALLBACK'));
    const attempts = await sql<Array<{ nonce_hash: string; code_verifier: string; redirect_path: string }>>`
      delete from auth_login_attempts
      where state_hash = ${sha256(input.data.state)} and expires_at > now()
      returning nonce_hash, code_verifier, redirect_path
    `;
    const attempt = attempts[0];
    if (!attempt) return reply.redirect(loginErrorUrl('LOGIN_EXPIRED'));

    try {
      const client = oauthClient();
      const { tokens } = await client.getToken({ code: input.data.code, codeVerifier: attempt.code_verifier });
      if (!tokens.id_token) return reply.redirect(loginErrorUrl('ID_TOKEN_MISSING'));
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_OAUTH_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || !payload.exp || !payload.iat || !payload.iss || !payload.nonce) return reply.redirect(loginErrorUrl('INVALID_ID_TOKEN'));
      if (!googleIssuers.has(payload.iss)) return reply.redirect(loginErrorUrl('INVALID_ISSUER'));
      if (payload.exp * 1000 <= Date.now()) return reply.redirect(loginErrorUrl('TOKEN_EXPIRED'));
      if (payload.iat * 1000 > Date.now() + 60_000) return reply.redirect(loginErrorUrl('INVALID_TOKEN_TIME'));
      if (!safeHashEquals(payload.nonce, attempt.nonce_hash)) return reply.redirect(loginErrorUrl('INVALID_NONCE'));
      if (payload.hd !== config.ALLOWED_GOOGLE_DOMAIN || !payload.email.toLowerCase().endsWith(`@${config.ALLOWED_GOOGLE_DOMAIN}`)) return reply.redirect(loginErrorUrl('UNAUTHORIZED_DOMAIN'));
      if (payload.email_verified !== true) return reply.redirect(loginErrorUrl('EMAIL_NOT_VERIFIED'));

      const login = await sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext('woko:first-user-bootstrap'))`;
        let users = await transaction<Array<{ id: string; email: string; full_name: string; active: boolean; google_subject_id: string | null }>>`
          select id, email::text, full_name, active, google_subject_id from users where email = ${payload.email!.toLowerCase()} for update
        `;
        if (!users[0]) {
          const counts = await transaction<Array<{ count: number }>>`select count(*)::int as count from users`;
          if (counts[0]?.count === 0) {
            users = await transaction<Array<{ id: string; email: string; full_name: string; active: boolean; google_subject_id: string | null }>>`
              insert into users (google_subject_id, email, full_name, profile_photo_url, active, last_login_at)
              values (${payload.sub}, ${payload.email!.toLowerCase()}, ${payload.name ?? payload.email!}, ${payload.picture ?? null}, true, now())
              returning id, email::text, full_name, active, google_subject_id
            `;
            await transaction`insert into user_roles (user_id, role) values (${users[0]!.id}, 'ADMINISTRATOR')`;
            await transaction`
              insert into audit_events (user_id, event_type, new_data, correlation_id)
              values (${users[0]!.id}, 'INITIAL_ADMINISTRATOR_BOOTSTRAPPED', ${transaction.json({ email: users[0]!.email, role: 'ADMINISTRATOR' })}, ${request.id})
            `;
          }
        }
        const user = users[0];
        if (!user) return { error: 'USER_NOT_REGISTERED' } as const;
        if (!user.active) return { error: 'USER_INACTIVE' } as const;
        if (user.google_subject_id && user.google_subject_id !== payload.sub) return { error: 'IDENTITY_MISMATCH' } as const;
        const duplicate = await transaction`select 1 from users where google_subject_id = ${payload.sub} and id <> ${user.id}`;
        if (duplicate.length) return { error: 'IDENTITY_MISMATCH' } as const;
        await transaction`
          update users set google_subject_id = ${payload.sub}, full_name = ${payload.name ?? user.full_name},
            profile_photo_url = ${payload.picture ?? null}, last_login_at = now(), updated_at = now()
          where id = ${user.id}
        `;
        const token = randomToken();
        const sessions = await transaction<Array<{ expires_at: string }>>`
          insert into user_sessions (token_hash, user_id, expires_at, user_agent, ip_address)
          values (${sha256(token)}, ${user.id}, now() + (${config.SESSION_DURATION_HOURS} * interval '1 hour'), ${request.headers['user-agent'] ?? null}, ${request.ip})
          returning expires_at::text
        `;
        await transaction`
          insert into audit_events (user_id, event_type, new_data, correlation_id)
          values (${user.id}, 'USER_SIGNED_IN', ${transaction.json({ email: user.email, expiresAt: sessions[0]!.expires_at })}, ${request.id})
        `;
        return { token, expiresAt: sessions[0]!.expires_at } as const;
      });
      if ('error' in login && login.error) return reply.redirect(loginErrorUrl(login.error));
      reply.setCookie(sessionCookieName, login.token, { ...sessionCookieOptions, expires: new Date(login.expiresAt) });
      return reply.redirect(new URL(attempt.redirect_path, config.APP_BASE_URL).toString());
    } catch (error) {
      const details = error as { response?: { data?: { error?: string; error_description?: string } }; code?: string; message?: string };
      const providerCode = details.response?.data?.error;
      const failureCode = providerCode === 'invalid_grant' ? 'OAUTH_CODE_EXCHANGE_FAILED'
        : providerCode === 'invalid_client' ? 'OAUTH_CLIENT_INVALID'
          : details.code === 'ENOTFOUND' || details.code === 'ECONNREFUSED' ? 'GOOGLE_UNREACHABLE'
            : 'LOGIN_FAILED';
      request.log.warn({ providerCode, providerDescription: details.response?.data?.error_description, code: details.code, message: details.message }, 'Google OIDC callback failed');
      return reply.redirect(loginErrorUrl(failureCode));
    }
  });

  app.patch('/me/preferences', { preHandler: authenticate }, async (request) => {
    const input = z.object({ locale: z.enum(['id', 'en']) }).parse(request.body);
    await sql`update users set preferred_locale = ${input.locale}, updated_at = now() where id = ${request.currentUser.id}`;
    return { data: { preferredLocale: input.locale } };
  });

  app.get('/google-picker/config', { preHandler: authenticate }, async (_request, reply) => {
    if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_PICKER_API_KEY || !config.GOOGLE_PICKER_APP_ID) {
      return reply.code(503).send({ error: { code: 'GOOGLE_PICKER_NOT_CONFIGURED', message: 'Google Picker is not configured.', requestId: _request.id } });
    }
    return { data: { clientId: config.GOOGLE_OAUTH_CLIENT_ID, apiKey: config.GOOGLE_PICKER_API_KEY, appId: config.GOOGLE_PICKER_APP_ID, email: _request.currentUser.email } };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionCookieName];
    if (token) await sql`update user_sessions set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
    reply.clearCookie(sessionCookieName, sessionCookieOptions);
    return { data: { loggedOut: true } };
  });

  app.get('/admin/users', { preHandler: [authenticate, requireAdministrator] }, async () => {
    const users = await sql`
      select u.id, u.email::text, u.full_name, u.active, u.google_subject_id is not null as identity_linked,
        u.last_login_at::text, u.created_at::text,
        coalesce(array_agg(ur.role order by ur.role) filter (where ur.role is not null), '{}') as roles
      from users u left join user_roles ur on ur.user_id = u.id
      group by u.id order by u.full_name, u.email
    `;
    return { data: users };
  });

  app.post('/admin/users', { preHandler: [authenticate, requireAdministrator] }, async (request, reply) => {
    const input = z.object({
      email: z.string().email().transform((value) => value.toLowerCase()),
      fullName: z.string().trim().min(2).max(160),
      active: z.boolean().default(true),
      roles: z.array(z.enum(roles)).min(1),
    }).parse(request.body);
    if (!input.email.endsWith(`@${config.ALLOWED_GOOGLE_DOMAIN}`)) return reply.code(422).send({ error: { code: 'UNAUTHORIZED_DOMAIN', message: `Users must have a @${config.ALLOWED_GOOGLE_DOMAIN} address.`, requestId: request.id } });
    const result = await sql.begin(async (transaction) => {
      const existing = await transaction`select 1 from users where email = ${input.email}`;
      if (existing.length) return { error: 'EMAIL_ALREADY_REGISTERED' } as const;
      const users = await transaction<Array<{ id: string }>>`
        insert into users (email, full_name, active) values (${input.email}, ${input.fullName}, ${input.active}) returning id
      `;
      const userId = users[0]!.id;
      for (const role of [...new Set(input.roles)]) await transaction`insert into user_roles (user_id, role) values (${userId}, ${role})`;
      await transaction`
        insert into audit_events (user_id, event_type, new_data, correlation_id)
        values (${request.currentUser.id}, 'USER_REGISTERED', ${transaction.json({ userId, email: input.email, active: input.active, roles: input.roles })}, ${request.id})
      `;
      return { id: userId } as const;
    });
    if ('error' in result) return reply.code(409).send({ error: { code: result.error, message: 'This email is already registered.', requestId: request.id } });
    return reply.code(201).send({ data: result });
  });

  app.patch('/admin/users/:id', { preHandler: [authenticate, requireAdministrator] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ active: z.boolean(), roles: z.array(z.enum(roles)).min(1) }).parse(request.body);
    if (id === request.currentUser.id && (!input.active || !input.roles.includes('ADMINISTRATOR'))) return reply.code(422).send({ error: { code: 'SELF_LOCKOUT_NOT_ALLOWED', message: 'You cannot deactivate yourself or remove your own administrator role.', requestId: request.id } });
    const result = await sql.begin(async (transaction) => {
      const userRows = await transaction<Array<{ active: boolean }>>`select active from users where id = ${id} for update`;
      if (!userRows[0]) return { error: 'NOT_FOUND' } as const;
      const roleRows = await transaction<Array<{ role: Role }>>`select role from user_roles where user_id = ${id}`;
      const previous = { active: userRows[0].active, roles: roleRows.map((row) => row.role) };
      await transaction`update users set active = ${input.active}, updated_at = now() where id = ${id}`;
      await transaction`delete from user_roles where user_id = ${id}`;
      for (const role of [...new Set(input.roles)]) await transaction`insert into user_roles (user_id, role) values (${id}, ${role})`;
      if (!input.active) await transaction`update user_sessions set revoked_at = now() where user_id = ${id} and revoked_at is null`;
      await transaction`
        insert into audit_events (user_id, event_type, previous_data, new_data, correlation_id)
        values (${request.currentUser.id}, 'USER_ACCESS_CHANGED', ${transaction.json(previous)}, ${transaction.json(input)}, ${request.id})
      `;
      return { id, ...input } as const;
    });
    if ('error' in result) return reply.code(404).send({ error: { code: result.error, message: 'User not found.', requestId: request.id } });
    return { data: result };
  });
}
