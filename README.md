# Woko

Woko is Millennia World School's mobile-first facilities work-order application. Version **v0.6.6** is the current production release candidate.

> **Release status:** Ready for release validation. See the [v0.6.6 release notes](docs/releases/v0.6.6.md) for upgrade details and validation requirements.

## What v0.6.6 includes

- Mobile-first installable PWA with Bahasa Indonesia and English interfaces
- Internal and vendor work-order workflows with role-aware transitions
- Work assignment for PICs, restricted internal workers, reviewers, and overseers
- Location-based recurring Routine Work for daily, Saturday weekly, and last-Saturday monthly facilities routines, with shared worker completion, photos, overdue reminders, and Facilities Manager digests
- Internal procurement proposal tracking and Facilities review queue
- PIC-authorized work-order creation
- Priority, due-date, overdue, blocked, and at-risk tracking
- Proposal approval and completion review flows
- Timeline updates, discussions, evidence, and immutable audit records
- Google Workspace authentication and administrator-managed access
- Google Drive evidence and project-folder integration
- In-app notifications, opt-in Web Push for installed PWAs, and optional Gmail delivery
- Work-order reporting and operational breakdowns
- Administrator settings for users, locations, and organization work settings
- PostgreSQL migrations, seed data, health endpoints, and Docker Compose deployment

## Technology

| Area | Stack |
| --- | --- |
| Web | React 19, Vite 7, TypeScript, PWA |
| API | Fastify 5, TypeScript, Zod |
| Data | PostgreSQL 17 |
| Integrations | Google OAuth/OIDC, Drive, Picker, Gmail, Web Push |
| Deployment | Docker Compose, Nginx |
| Testing | Vitest, TypeScript type checking |

## Repository layout

```text
apps/
  api/       Fastify API, database migrations, jobs, and integrations
  web/       React PWA and production Nginx configuration
packages/
  domain/    Shared types, validation, deadlines, and workflow rules
docs/
  deployment/ Docker production guide
  product/    Product requirements and release scope
  releases/   Versioned release notes
```

## Requirements

- Node.js 22+
- npm 10+
- Docker Engine with Docker Compose v2
- Google Cloud and Google Workspace access for production authentication and integrations

## Local development

1. Create local configuration from the maintained template:

   ```bash
   cp .env.example .env
   ```

2. Check `.env`. The defaults sign you in as a local test user (`AUTH_MODE=test`), so no Google credentials are needed. Set `AUTH_MODE=google` and fill in the `GOOGLE_*` keys only when you want real Google sign-in. Keep real credentials and service-account JSON files outside version control.

3. Install dependencies and start PostgreSQL:

   ```bash
   npm install
   docker compose up -d postgres
   ```

4. Build shared packages, migrate, seed, and run both applications:

   ```bash
   npm run build
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

5. With `AUTH_MODE=test` the API signs every request in as the user `30000000-0000-4000-8000-000000000001`, and the seed does not create users. Add that user once:

   ```bash
   docker compose exec postgres psql -U woko -d woko -c "
     insert into users (id, email, full_name)
     values ('30000000-0000-4000-8000-000000000001', 'dev.admin@millennia21.id', 'Dev Admin')
     on conflict do nothing;
     insert into user_permissions (user_id, permission)
     select '30000000-0000-4000-8000-000000000001', unnest(array[
       'work-order.create','work-order.read-all','work-order.operate-any','work-order.transition-any','work-order.approve',
       'work-order.reopen','work-order.cancel','work-order.set-schedule','work-order.manage-participants','work-order.read-audit',
       'work-order.delete','work-order.be-reviewer','work-list.manage','facilities.request','facilities.manage','settings.manage','users.manage'])
     on conflict do nothing;"
   ```

6. Open `http://localhost:5173`.

The default development ports are:

- Web: `5173`
- API: `3001`
- PostgreSQL: `127.0.0.1:5433`

With `AUTH_MODE=hub`, see [Signing in through the Hub](#signing-in-through-the-hub). With `AUTH_MODE=google`, register `http://localhost:5173/api/v1/auth/callback` as an authorized Google OAuth redirect URI. The first verified identity in the configured Google Workspace domain becomes the initial administrator when no internal users exist; subsequent users must be registered and activated by an administrator.

### Local troubleshooting

- **A port is already in use.** Change `PORT` for the API (the Vite proxy follows it), `POSTGRES_PORT` and `DATABASE_URL` for PostgreSQL, and start the web app with `npm run dev -w @woko/web -- --port 5174` (then set `WEB_ORIGIN` to match). Vite reads the `.env` in the repo root, so restart it after changing `PORT`.
- **`EMFILE: too many open files, watch ...` when starting Vite.** The machine ran out of inotify instances, usually because many dev servers are running. Stop some, or raise the limit: `sudo sysctl fs.inotify.max_user_instances=1024` (add `fs.inotify.max_user_instances=1024` to `/etc/sysctl.d/99-inotify.conf` to keep it after a reboot).
- **The API exits with a `ZodError` about a `GOOGLE_*` key.** An empty value such as `GOOGLE_OAUTH_CLIENT_ID=` is rejected. Remove or comment out the key.

## Signing in through the Hub

`AUTH_MODE=hub` is the target mode. The Hub's shared session says who someone is, and Central's entitlement for the `woko` application says what they may do. Woko keeps no password and no role of its own.

- A request without the Hub cookie gets 401, and `/api/v1/auth/login` sends the browser to the Hub to restore the session and back. A person without an entitlement gets 403 `NO_ACCESS`. If Central cannot be asked, the API answers 503 `CENTRAL_UNAVAILABLE` and does not fall back to old rights.
- The entitlement is cached for up to 60 seconds, so a change in Central reaches an open session within a minute (AS-11).
- The first time someone signs in, Woko creates the local user. An existing user with the same email is linked once (`users.central_person_id`) and keeps their history. An email already linked to another person is refused with 409 `ACCOUNT_CONFLICT`.
- Pickers and notifications need other people's rights, so a job copies Central's entitlements into `user_permissions` every `CENTRAL_SYNC_INTERVAL_MINUTES` (default 5). The table is a copy in this mode and the User Access screen is read only. Granting access is done in Central, and the administrator comes from a Central group (AS-12).
- Check before switching a deployment: `npm run central:sync -- --dry-run` prints what would be created, linked, renamed, changed and switched off, and how many local users have no match in Central. `--apply` does it, `--deactivate-unlinked` also switches off local users that Central does not know.
- `AUTH_MODE=google` stays as the way back until `hub` is proven in staging.
- If nobody gets in, run `npm run access:doctor -- --url http://localhost:3011` (the address of the API). It checks the `.env` lines, the Hub, the Central token and its profile, the permission list, who has access, and whether the running API really is in `hub` mode. The API also logs its `AUTH_MODE` and `APP_BASE_URL` when it starts. Restart the API after changing `.env`.

## Access model

Woko follows the MWS Access Standard (`mws-data-center/docs/access-standard.md`, v1.0). The code checks permissions, never role names, and each API route declares the permission it needs. The permission list lives in `packages/domain/src/permissions.ts`. Today the permissions are kept per user in Woko (`user_permissions`) and granted from the User Access screen; moving login to Hub and the permissions to Central is tracked in `mws-data-center/docs/access-conformance.md`. Keys are `domain.action` (AS-3). `woko.use` is the right to be in the app, and each `manage` permission needs its `read`.

- Woko uses the shared access kit from `mws-central-auth` (installed from GitHub at a tag, so the Docker build stage installs `git`). The permission list is built with `definePermissions` in `packages/domain/src/permissions.ts`, and `npm run permissions:check` / `npm run permissions:sync` are the library's command (AS-4). They read `CENTRAL_API_BASE_URL` and `CENTRAL_API_TOKEN` from `.env`; see `.env.example`.
- `npm run access:check` runs `mws-access check` from `access.config.json`: the manifest, the role presets, permission typos, role names in the code, and every route turned away from a person with no permissions (AS-2 to AS-6, AS-13). It needs `AUTH_MODE=test` and a migrated database, and runs in the pull request workflow.
- `role-presets.json` holds the starting roles. It is made from the permission bundles with `npm run presets:write` (a test fails when it is out of date). In Central, create the roles with `bun run seed:application-roles role-presets.json --as <super admin email>` after the first sync (AS-13).

Still to do for the Central model: log in through the Hub and take the permissions from the entitlement instead of `user_permissions`.

## Verification

Run the release checks before merging or deploying:

```bash
npm run typecheck
npm test
npm run build
```

## Docker deployment

The production Compose stack contains:

- `postgres`: persistent PostgreSQL database
- `migrate`: one-shot database migration service
- `api`: Fastify API and background workers
- `web`: Nginx-served PWA and `/api` reverse proxy

For a complete production procedure, including environment configuration, Google service accounts, TLS, backups, upgrades, rollback, and troubleshooting, use the **[Docker deployment guide](docs/deployment/docker.md)**.

After production configuration is ready, the core deployment command is:

```bash
docker compose up -d --build
```

By default the application is published from the web container at `http://<host>:${WEB_PORT}`. Put it behind an HTTPS reverse proxy for production, and set `APP_BASE_URL` and `WEB_ORIGIN` to the public HTTPS origin.

## Documentation

- [Documentation index](docs/README.md)
- [Product requirements document](docs/product/PRD.md)
- [Architecture overview](docs/architecture.md)
- [Docker deployment guide](docs/deployment/docker.md)
- [Komodo deployment guide](docs/deployment/komodo.md)
- [v0.6.6 release notes](docs/releases/v0.6.6.md)
- [v0.6.5 release notes](docs/releases/v0.6.5.md)
- [v0.6.0 release notes](docs/releases/v0.6.0.md)
- [v0.5.1 release notes](docs/releases/v0.5.1.md)
- [v0.1.0 release notes](docs/releases/v0.1.0.md)

## Security and data handling

- Never commit `.env`, OAuth client secrets, database credentials, or service-account JSON.
- Use HTTPS in production; production session cookies are secure-only.
- Restrict Google API keys and service accounts to the minimum APIs, origins, scopes, folders, and Shared Drives required.
- Back up PostgreSQL and test restore procedures before relying on the deployment for operational records.
- Treat work-order descriptions, discussions, reports, and evidence as internal organizational data.

## Versioning

The root package and all workspaces identify this release candidate as `0.6.6`. Release tags and GitHub releases are created only after the deployed commit passes production verification.

## License

Woko is available under the [MIT License](LICENSE).
