# Woko

Woko is Millennia World School's mobile-first facilities work-order application. Version **v0.1.0** is the first release-ready internal version of the product.

> **Release status:** Ready for controlled production deployment. See the [v0.1 release notes](docs/releases/v0.1.0.md) for scope, prerequisites, and known limitations.

## What v0.1 includes

- Mobile-first installable PWA with Bahasa Indonesia and English interfaces
- Internal and vendor work-order workflows with role-aware transitions
- Work assignment for PICs, reviewers, and overseers
- Priority, due-date, overdue, blocked, and at-risk tracking
- Proposal approval and completion review flows
- Timeline updates, discussions, evidence, and immutable audit records
- Google Workspace authentication and administrator-managed access
- Google Drive evidence and project-folder integration
- In-app notifications and optional Gmail delivery
- Work-order reporting and operational breakdowns
- Administrator settings for users, locations, and organization work settings
- PostgreSQL migrations, seed data, health endpoints, and Docker Compose deployment

## Technology

| Area | Stack |
| --- | --- |
| Web | React 19, Vite 7, TypeScript, PWA |
| API | Fastify 5, TypeScript, Zod |
| Data | PostgreSQL 17 |
| Integrations | Google OAuth/OIDC, Drive, Picker, Gmail |
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

2. Update `.env` for local PostgreSQL and Google authentication. Keep real credentials and service-account JSON files outside version control.

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

5. Open `http://localhost:5173`.

The default development ports are:

- Web: `5173`
- API: `3001`
- PostgreSQL: `127.0.0.1:5433`

Register `http://localhost:5173/api/v1/auth/callback` as an authorized Google OAuth redirect URI. The first verified identity in the configured Google Workspace domain becomes the initial administrator when no internal users exist; subsequent users must be registered and activated by an administrator.

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
- [v0.1.0 release notes](docs/releases/v0.1.0.md)

## Security and data handling

- Never commit `.env`, OAuth client secrets, database credentials, or service-account JSON.
- Use HTTPS in production; production session cookies are secure-only.
- Restrict Google API keys and service accounts to the minimum APIs, origins, scopes, folders, and Shared Drives required.
- Back up PostgreSQL and test restore procedures before relying on the deployment for operational records.
- Treat work-order descriptions, discussions, reports, and evidence as internal organizational data.

## Versioning

The root package and all workspaces currently identify this release as `0.1.0`. Future releases should add a versioned note under `docs/releases/` and update this README when release status or supported deployment requirements change.

## License

Woko is available under the [MIT License](LICENSE).
