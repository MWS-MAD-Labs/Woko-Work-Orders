# Docker deployment guide

This guide deploys Woko v0.1.0 on a single Docker host using the repository's `compose.yaml`. It is suitable for a controlled internal production deployment and platforms that import Docker Compose, such as Komodo.

## 1. Deployment model

The stack defines four services:

| Service | Purpose | Published port |
| --- | --- | --- |
| `postgres` | PostgreSQL 17 database | Loopback `${POSTGRES_PORT:-5433}` |
| `migrate` | One-shot schema migration | None |
| `api` | Fastify API and background jobs | None |
| `web` | Nginx web server and API proxy | `${WEB_PORT}:80` |

A named volume, `woko-postgres`, stores PostgreSQL data. Service-account JSON files are mounted into the API as Docker secrets. The migration service must complete successfully before the API starts; the web service waits for API readiness.

## 2. Host requirements

Recommended minimum for a small internal rollout:

- Current Linux distribution with security updates
- Docker Engine 26+ and Docker Compose v2
- 2 CPU cores
- 4 GiB RAM
- 20 GiB available persistent storage, adjusted for evidence metadata, database growth, logs, images, and backups
- DNS record for the public application hostname
- HTTPS reverse proxy such as Caddy, Traefik, Nginx, or the deployment platform's ingress
- Outbound HTTPS access to Google identity and API endpoints
- Reliable time synchronization

Evidence file content is held in Google Drive, but the PostgreSQL database remains business-critical and requires off-host backups.

## 3. Obtain the release

Deploy from a tagged or otherwise immutable v0.1.0 source revision rather than a moving development branch.

```bash
git clone <repository-url> woko
cd woko
git checkout <v0.1.0-tag-or-release-commit>
```

Do not store production secrets in the clone.

## 4. Prepare production configuration

Create the runtime environment from the repository template:

```bash
cp .env.example .env
chmod 600 .env
```

Use the template as the canonical full variable list. The example below highlights the production values needed by the current Compose stack:

```dotenv
# PostgreSQL
POSTGRES_DB=woko
POSTGRES_USER=woko
POSTGRES_PASSWORD=replace-with-a-long-random-password
POSTGRES_PORT=5433
DATABASE_URL=postgres://woko:replace-with-a-long-random-password@localhost:5433/woko
DOCKER_DATABASE_URL=postgres://woko:replace-with-a-long-random-password@postgres:5432/woko

# Public application
WEB_PORT=8080
APP_BASE_URL=https://woko.example.org
WEB_ORIGIN=https://woko.example.org
APP_TIME_ZONE=Asia/Jakarta

# Authentication
AUTH_MODE=google
ALLOWED_GOOGLE_DOMAIN=example.org
GOOGLE_OAUTH_CLIENT_ID=replace-with-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=replace-with-oauth-client-secret
SESSION_DURATION_HOURS=8

# Google Picker and Drive
GOOGLE_PICKER_API_KEY=replace-with-restricted-browser-api-key
GOOGLE_PICKER_APP_ID=replace-with-google-cloud-project-number
GOOGLE_SHARED_DRIVE_ID=replace-with-shared-drive-id
GOOGLE_WORK_ORDERS_ROOT_FOLDER_ID=replace-with-root-folder-id
WOKO_GOOGLE_CREDENTIALS_FILE=/srv/woko-secrets/drive-service-account.json

# Background jobs
BACKGROUND_JOBS_ENABLED=true
JOB_POLL_INTERVAL_MS=2000
JOB_BATCH_SIZE=20
SCHEDULER_INTERVAL_MS=60000

# Email: use disabled unless Gmail has been fully configured
EMAIL_PROVIDER=disabled
GMAIL_SENDER_EMAIL=
GMAIL_SENDER_NAME=Woko Notifications
WOKO_GMAIL_CREDENTIALS_FILE=/srv/woko-secrets/gmail-service-account.json
```

Important details:

- `APP_BASE_URL` and `WEB_ORIGIN` should be the same public HTTPS origin unless a deliberate cross-origin architecture is implemented and tested.
- The production Google callback URI is `${APP_BASE_URL}/api/v1/auth/callback`.
- `DOCKER_DATABASE_URL` must use the Compose service hostname `postgres`, not `localhost`.
- `DATABASE_URL` is used by commands run directly on the host. It can use the loopback PostgreSQL port.
- Keep `AUTH_MODE=google`; the API rejects test authentication in production.
- URL-encode special characters in database passwords when embedding them in connection strings.
- The current Compose file declares both Google JSON mounts. Provide readable files at both host paths even when Gmail delivery is disabled; the Gmail file may be a separately managed placeholder only if your deployment platform requires the declared secret to exist. Never reuse or expose a real credential unnecessarily.
- Prefer your platform's protected environment and secret management instead of a plaintext `.env` when supported.

Validate interpolation before deployment:

```bash
docker compose config --quiet
```

This checks Compose structure and required paths without starting services. Do not paste the expanded `docker compose config` output into tickets or logs because it can include secret environment values.

## 5. Configure Google OAuth

Create a Google OAuth web application for Woko:

1. Configure the OAuth consent screen for the organization.
2. Add the public application origin, for example `https://woko.example.org`, as an authorized JavaScript origin where required.
3. Add `https://woko.example.org/api/v1/auth/callback` as an authorized redirect URI.
4. Set the matching client ID and secret in the protected deployment environment.
5. Set `ALLOWED_GOOGLE_DOMAIN` to the organization's Workspace domain.

On a new database with no internal users, the first verified identity from the allowed domain is created as the active administrator. Perform this bootstrap with the intended owner account. Every later identity must be added and activated by an administrator.

## 6. Configure Google Picker and Drive

1. Enable Google Drive API and Google Picker API in the Google Cloud project.
2. Create a browser API key for Picker.
3. Restrict the key to the Picker API and the exact production web origin.
4. Set `GOOGLE_PICKER_APP_ID` to the numeric Google Cloud project number.
5. Add the `drive.file` scope to the consent configuration.
6. Create or select the project Shared Drive and work-order root folder.
7. Create a dedicated Drive service account.
8. Add the service account to the Shared Drive with only the permissions needed to create folders and manage project files.
9. Store its JSON outside the repository, for example:

   ```bash
   sudo install -d -m 700 /srv/woko-secrets
   sudo install -m 600 /secure/source/drive-service-account.json /srv/woko-secrets/drive-service-account.json
   ```

10. Set `WOKO_GOOGLE_CREDENTIALS_FILE`, `GOOGLE_SHARED_DRIVE_ID`, and `GOOGLE_WORK_ORDERS_ROOT_FOLDER_ID`.

The Compose stack mounts the Drive credential at `/run/secrets/woko_google_credentials` and sets `GOOGLE_APPLICATION_CREDENTIALS` automatically.

## 7. Optional Gmail delivery

In-app notifications work with `EMAIL_PROVIDER=disabled`. To enable email:

1. Create a dedicated Gmail service account in Google Cloud.
2. Enable the Gmail API.
3. In Google Admin, open **Security → Access and data control → API controls → Manage Domain Wide Delegation**.
4. Authorize the service account's numeric OAuth client ID for only:

   ```text
   https://www.googleapis.com/auth/gmail.send
   ```

5. Choose an active Workspace mailbox to impersonate as the sender.
6. Store the service-account JSON outside the repository.
7. Set:

   ```dotenv
   EMAIL_PROVIDER=gmail
   GMAIL_SENDER_EMAIL=notifications@example.org
   GMAIL_SENDER_NAME=Woko Notifications
   WOKO_GMAIL_CREDENTIALS_FILE=/srv/woko-secrets/gmail-service-account.json
   ```

The Compose stack mounts this credential at `/run/secrets/woko_gmail_credentials` and sets `GMAIL_APPLICATION_CREDENTIALS` automatically. The API refuses to start with Gmail enabled unless both sender email and credential path are present.

## 8. Build and start

Pull base images and build from the selected release:

```bash
docker compose pull postgres
docker compose build --pull
docker compose up -d
```

Inspect service state:

```bash
docker compose ps
```

Expected result:

- `postgres` is healthy.
- `migrate` exits with code `0`.
- `api` is healthy.
- `web` is running.

If migration fails, the API and web services should not fully start. Inspect the migration logs and correct the issue; do not bypass the migration dependency.

```bash
docker compose logs migrate
docker compose logs api
docker compose logs web
```

## 9. Configure HTTPS ingress

The web container listens on the host's `WEB_PORT`, commonly `8080`. Publish the public hostname through an HTTPS reverse proxy and forward all paths to that port. Preserve these headers:

- `Host`
- `X-Real-IP`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

Example Caddy configuration:

```caddyfile
woko.example.org {
    reverse_proxy 127.0.0.1:8080
}
```

Do not expose the API container directly; the web container already proxies `/api/` to the API over the private Compose network. Do not expose PostgreSQL beyond loopback unless there is a specific secured administration requirement.

After HTTPS is active, verify that `APP_BASE_URL`, `WEB_ORIGIN`, OAuth origin, and redirect URI all use the same scheme and hostname. A mismatch can cause rejected mutation origins, login callbacks, or cookies that appear not to persist.

## 10. Health and smoke checks

Confirm the host-published web application responds:

```bash
curl --fail http://127.0.0.1:8080/
```

Check API health from inside its container:

```bash
docker compose exec api wget -qO- http://127.0.0.1:3001/health/live
docker compose exec api wget -qO- http://127.0.0.1:3001/health/ready
```

The supplied Nginx configuration proxies `/api/` but does not publish the API's root `/health/*` routes. Use Docker's API health status for routine checks, or explicitly add protected health-route proxying at the ingress layer if an external monitor requires HTTP health endpoints.

Then perform the release smoke test:

1. Sign in with the intended administrator.
2. Register and activate a second test user.
3. Create an internal work order and progress it to completion.
4. Create a vendor work order and test proposal approval.
5. Attach Drive evidence.
6. Confirm in-app notifications.
7. Confirm Gmail delivery if enabled.
8. Open reports and organization settings.
9. Verify an unauthorized role cannot perform a manager-only action.

## 11. Logs and monitoring

Useful commands:

```bash
docker compose logs --since=30m api
docker compose logs --since=30m postgres
docker compose logs --since=30m web
docker compose ps
```

At minimum, monitor:

- Public HTTPS availability
- API readiness
- Container restart count
- Host disk and inode use
- PostgreSQL volume growth
- Failed migration exits
- API error rate and queue delivery failures
- TLS certificate expiry
- Backup success and restore-test age

Docker's default JSON logs can grow indefinitely depending on daemon configuration. Configure host-level log rotation or the Compose logging driver through your deployment platform.

## 12. Database backup and restore

### Backup

Create backups outside the named volume and copy them off-host. A logical compressed backup can be produced with:

```bash
docker compose exec -T postgres pg_dump -U woko -d woko -Fc > woko-$(date +%Y-%m-%d).dump
```

The filename in this example is generated by the host shell. Protect backup files because they contain internal operational data. Automate backups according to the organization's recovery objectives and retain multiple generations.

### Restore drill

Test restores in a separate non-production environment. A typical procedure is:

1. Stop API and web writes.
2. Create a fresh PostgreSQL database or disposable stack.
3. Restore the dump:

   ```bash
   cat woko-YYYY-MM-DD.dump | docker compose exec -T postgres pg_restore -U woko -d woko --clean --if-exists
   ```

4. Start the migration service to apply any migrations newer than the backup.
5. Start API and web services.
6. Verify authentication, work-order counts, recent audit history, notifications, and reports.

Do not overwrite production during a restore drill.

## 13. Upgrade procedure

For every release:

1. Read its release notes and migration notes.
2. Confirm a recent backup and tested recovery path.
3. Record the currently deployed image/source revision.
4. Fetch and check out the target immutable release.
5. Review changes to `.env.example`, `compose.yaml`, and service-account requirements.
6. Update protected configuration without deleting still-required variables.
7. Validate Compose:

   ```bash
   docker compose config --quiet
   ```

8. Build new images:

   ```bash
   docker compose build --pull
   ```

9. Start the stack:

   ```bash
   docker compose up -d
   ```

10. Confirm migration exit status, service health, logs, and smoke tests.

The migration container is designed to run on each deployment and apply only pending migrations.

## 14. Rollback

Application rollback is safe only when the previous application version is compatible with the migrated database schema.

1. Stop incoming traffic or place the app in a maintenance window.
2. Capture a fresh database backup.
3. Inspect the failed release's migration impact.
4. If migrations are backward-compatible, check out the previous release and rebuild/restart.
5. If migrations are not backward-compatible, restore the pre-upgrade database backup into a clean database/volume, then deploy the previous release.
6. Run the full smoke test before reopening traffic.

Never delete or manually edit migration records merely to force an older API to start.

## 15. Troubleshooting

### `migrate` exits non-zero

- Check `docker compose logs migrate`.
- Confirm `DOCKER_DATABASE_URL` uses `postgres:5432`.
- Confirm PostgreSQL credentials match `POSTGRES_*` values.
- Check whether a previous manual schema change conflicts with a migration.
- Restore a known backup before attempting destructive corrections.

### API remains unhealthy

- Check `docker compose logs api`.
- Verify `/health/ready` can query PostgreSQL.
- Confirm migrations completed successfully.
- Confirm production is not using `AUTH_MODE=test`.
- If Gmail is enabled, confirm sender and mounted credential path.

### Google login fails

- Ensure callback URI exactly matches `${APP_BASE_URL}/api/v1/auth/callback`.
- Ensure `APP_BASE_URL` uses the public HTTPS origin.
- Verify OAuth client ID and secret belong to the same web client.
- Verify the user's email domain matches `ALLOWED_GOOGLE_DOMAIN`.
- Confirm the user is registered and active, except for initial bootstrap.
- Check reverse-proxy forwarding and API logs.

### Sign-in succeeds but the session is lost

- Confirm the public site uses HTTPS; production cookies are secure-only.
- Confirm requests stay on the same public origin.
- Check proxy forwarding of host and protocol headers.
- Check browser cookie policy and clock synchronization.

### Drive evidence fails

- Verify Drive and Picker APIs are enabled.
- Confirm Picker key origin/API restrictions.
- Confirm Shared Drive and root folder IDs.
- Confirm the service account is a Shared Drive member with adequate permission.
- Check Workspace file ownership and external-sharing policies.
- Use the copy fallback only with user approval when moving is prohibited.

### Gmail notifications fail

- Confirm `EMAIL_PROVIDER=gmail`.
- Confirm sender mailbox exists and is active.
- Confirm domain-wide delegation uses the service account's numeric client ID.
- Confirm only the `gmail.send` scope is granted.
- Confirm the mounted JSON belongs to the delegated service account.
- Review API logs and notification delivery state.

### PWA appears stale after deployment

- Reload the application and allow the service worker to update.
- Confirm `index.html` and `sw.js` are not cached long-term by an upstream proxy/CDN.
- Preserve immutable caching only for hashed `/assets/` files.

## 16. Shutdown and data deletion

Stop containers without deleting data:

```bash
docker compose down
```

Do **not** use `docker compose down -v` in production unless permanent database deletion is explicitly intended and a verified backup exists. The `-v` option removes the PostgreSQL named volume.
