# Komodo deployment guide

This guide deploys Woko from the public GitHub repository as a Komodo **Stack** using Docker Compose.

Repository: `https://github.com/MWS-MAD-Labs/Woko-Work-Orders`

Komodo clones the repository onto the target server, writes the Stack environment to `.env`, builds the API and web images, runs database migrations, and starts the application.

## 1. Prerequisites

Before creating the Stack, prepare:

- A Linux server registered and healthy in Komodo
- Docker Engine and Docker Compose v2 on that server
- At least 2 CPU cores, 4 GiB RAM, and 20 GiB free storage
- A DNS record for the application, such as `woko.example.org`
- An HTTPS reverse proxy forwarding the hostname to the Woko web port
- Google OAuth credentials for a web application
- Google Picker/Drive configuration and a Drive service-account JSON file
- A Gmail service-account JSON file only if Gmail notifications will be enabled

The PostgreSQL named volume is business-critical. Configure off-host backups before production use.

## 2. Install credential files on the target server

The Compose stack uses file-based Docker secrets for Google service accounts. Install the files on the same server selected for the Komodo Stack; do not add them to Git or paste their JSON into the Stack environment.

```bash
sudo install -d -m 700 /srv/woko-secrets
sudo install -m 600 /secure/source/drive-service-account.json /srv/woko-secrets/drive-service-account.json
sudo install -m 600 /secure/source/gmail-service-account.json /srv/woko-secrets/gmail-service-account.json
```

If email is disabled, the current Compose file still declares the Gmail secret. Provide a non-sensitive, readable placeholder file rather than copying or reusing an unrelated real credential:

```bash
printf '{}\n' | sudo tee /srv/woko-secrets/gmail-disabled.json >/dev/null
sudo chmod 600 /srv/woko-secrets/gmail-disabled.json
```

The files must be readable by the Docker daemon. Keep `/srv/woko-secrets` restricted from ordinary host users.

## 3. Create protected Komodo variables

In Komodo, open **Settings → Variables**. Create the following variables and enable **Secret** for every sensitive value.

| Variable | Secret | Value |
| --- | --- | --- |
| `WOKO_POSTGRES_PASSWORD` | Yes | Long random database password |
| `WOKO_DOCKER_DATABASE_URL` | Yes | `postgres://woko:<URL-encoded-password>@postgres:5432/woko` |
| `WOKO_GOOGLE_OAUTH_CLIENT_ID` | No | Google OAuth web client ID |
| `WOKO_GOOGLE_OAUTH_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `WOKO_GOOGLE_PICKER_API_KEY` | Yes | Browser key restricted to Picker and the production origin |
| `WOKO_GOOGLE_PICKER_APP_ID` | No | Numeric Google Cloud project number |
| `WOKO_GOOGLE_SHARED_DRIVE_ID` | No | Shared Drive ID |
| `WOKO_GOOGLE_ROOT_FOLDER_ID` | No | Work-orders root folder ID |

When Gmail delivery is enabled, also create:

| Variable | Secret | Value |
| --- | --- | --- |
| `WOKO_GMAIL_SENDER_EMAIL` | No | Workspace mailbox used for delegated sending |

Use a database password that is safe to place in a URI, or URL-encode it in `WOKO_DOCKER_DATABASE_URL`. The `POSTGRES_PASSWORD` value itself must remain unencoded.

Komodo interpolates protected variables with `[[VARIABLE_NAME]]`. Secret values are masked in Komodo updates and logs.

## 4. Create the Stack

In Komodo, create a new **Stack** with these settings.

### General

| Setting | Value |
| --- | --- |
| Name | `woko-work-orders` |
| Server | Select the production server |
| Mode | `Git Repo` |
| Git provider | `github.com` |
| Git account | None required; the repository is public |
| Repository | `MWS-MAD-Labs/Woko-Work-Orders` |
| Branch | `main` |
| Run directory | Leave empty; `compose.yaml` is at the repository root |
| File paths | `compose.yaml` |
| Environment file path | `.env` |
| Project name | `woko` |

### Deployment behavior

| Setting | Value | Reason |
| --- | --- | --- |
| Pre Pull Images / Auto Pull | Off | `api` and `web` are locally built images; pulling them would fail |
| Pre Build Images / Run Build | On | Builds the API and web images from the checked-out repository |
| Build extra args | `--pull` | Refreshes base images during a deployment |
| Destroy Before Deploy | Off | Avoids unnecessary downtime and preserves the normal Compose update path |
| Ignore services | `migrate` | Migration is a successful one-shot service and should not make the Stack unhealthy after exit |
| Send alerts | On | Reports Stack state changes |

Do not enable image auto-update for this Stack. Application updates come from Git and require rebuilding the local images.

## 5. Configure the Stack environment

Paste the following into the Stack **Environment** editor. Replace the public hostname and Workspace domain. Values using `[[...]]` come from Komodo Variables.

```dotenv
POSTGRES_DB=woko
POSTGRES_USER=woko
POSTGRES_PASSWORD=[[WOKO_POSTGRES_PASSWORD]]
POSTGRES_PORT=5433
DOCKER_DATABASE_URL=[[WOKO_DOCKER_DATABASE_URL]]

WEB_PORT=8080
APP_BASE_URL=https://woko.example.org
WEB_ORIGIN=https://woko.example.org
APP_TIME_ZONE=Asia/Jakarta

AUTH_MODE=google
ALLOWED_GOOGLE_DOMAIN=example.org
GOOGLE_OAUTH_CLIENT_ID=[[WOKO_GOOGLE_OAUTH_CLIENT_ID]]
GOOGLE_OAUTH_CLIENT_SECRET=[[WOKO_GOOGLE_OAUTH_CLIENT_SECRET]]


GOOGLE_PICKER_API_KEY=[[WOKO_GOOGLE_PICKER_API_KEY]]
GOOGLE_PICKER_APP_ID=[[WOKO_GOOGLE_PICKER_APP_ID]]
GOOGLE_SHARED_DRIVE_ID=[[WOKO_GOOGLE_SHARED_DRIVE_ID]]
GOOGLE_WORK_ORDERS_ROOT_FOLDER_ID=[[WOKO_GOOGLE_ROOT_FOLDER_ID]]
WOKO_GOOGLE_CREDENTIALS_FILE=/srv/woko-secrets/drive-service-account.json

BACKGROUND_JOBS_ENABLED=true
JOB_POLL_INTERVAL_MS=2000
JOB_BATCH_SIZE=20
SCHEDULER_INTERVAL_MS=60000

EMAIL_PROVIDER=disabled
GMAIL_SENDER_EMAIL=
GMAIL_SENDER_NAME=Woko Notifications
WOKO_GMAIL_CREDENTIALS_FILE=/srv/woko-secrets/gmail-disabled.json
```

For Gmail delivery, change only these lines and ensure domain-wide delegation is configured for the Gmail service account:

```dotenv
EMAIL_PROVIDER=gmail
GMAIL_SENDER_EMAIL=[[WOKO_GMAIL_SENDER_EMAIL]]
WOKO_GMAIL_CREDENTIALS_FILE=/srv/woko-secrets/gmail-service-account.json
```

Important:

- `APP_BASE_URL` and `WEB_ORIGIN` must be the exact same public HTTPS origin.
- Do not add a trailing slash to either URL.
- `DOCKER_DATABASE_URL` must use `postgres:5432`, not `localhost`.
- Keep `AUTH_MODE=google` until Hub sign-in is proven in staging, then switch to `AUTH_MODE=hub` (see [Sign in through the Hub](#sign-in-through-the-hub)).
- Port `5433` is bound only to host loopback by the supplied Compose file.
- Choose another unused host port if `8080` is already occupied.

## 6. Configure Google OAuth

For the Google OAuth web client, configure:

- Authorized JavaScript origin: `https://woko.example.org`
- Authorized redirect URI: `https://woko.example.org/api/v1/auth/callback`

Replace the example hostname with the exact value used for `APP_BASE_URL`.

On an empty database, the first verified user from `ALLOWED_GOOGLE_DOMAIN` becomes the initial administrator. Use the intended administrator account for the first login.

## 7. Configure HTTPS ingress

Publish only the web service through an HTTPS reverse proxy. Forward the public hostname to `127.0.0.1:8080` on the Docker host.

Example Caddy configuration:

```caddyfile
woko.example.org {
    reverse_proxy 127.0.0.1:8080
}
```

If the reverse proxy itself runs in Docker and cannot reach host loopback, either attach it to the Woko Compose network or bind `WEB_PORT` to an address reachable only from the proxy's trusted network. Do not publicly expose PostgreSQL or the API container.

Preserve `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.

## 8. Deploy and verify

Save the Stack configuration, then select **Deploy**.

The first deployment should:

1. Clone the GitHub repository.
2. Write the protected Stack environment to `.env`.
3. Pull current Docker base images.
4. Build the API and web images.
5. Start PostgreSQL and wait for it to become healthy.
6. Run all pending migrations in `migrate`.
7. Start the API and wait for readiness.
8. Start the web service.

Expected service state:

- `postgres`: running and healthy
- `migrate`: exited successfully with code `0`; ignored by Komodo health reporting
- `api`: running and healthy
- `web`: running

Verify from the target server:

```bash
curl --fail http://127.0.0.1:8080/
curl --fail https://woko.example.org/
```

In Komodo, inspect the `migrate`, `api`, and `web` logs if deployment fails. Do not bypass a failed migration.

### Send the permission list to Central

Woko publishes its permission list to Central after each deploy (Access Standard AS-4). It is off by default. To turn it on:

1. Create an API client in Central for the Woko application with the scopes `application_permissions:write` and `application_entitlements:read`.
2. Add `CENTRAL_API_BASE_URL` and `CENTRAL_API_TOKEN` to the protected Stack environment. Use the protected variable mechanism from step 3 for the token.
3. Add `COMPOSE_PROFILES=central` to the Stack environment.

The one-shot `permissions` service then runs after `api` is healthy, retries while Central is not reachable, and fails the deployment when Central refuses the list. Add `permissions` to **Ignore services** next to `migrate`, since it exits after it finishes. The starting roles come from `role-presets.json` (see the README).

### Sign in through the Hub

Set this up in staging first.

1. In Central, register the `woko` application with its sign-in address and the sign-in way Shared Hub Session.
2. Run the permission sync (above), then create the roles with `seed:application-roles role-presets.json` and the access groups that decide who gets which role.
3. Give the API client the scope `application_entitlements:read`.
4. Woko must be served from a subdomain of the Hub's parent domain, or the shared session cookie is not sent.
5. Add `HUB_BASE_URL`, `CENTRAL_ORGANIZATION_ID` and, if the Hub uses a custom cookie name, `HUB_ACCESS_COOKIE_NAME` to the Stack environment, and set `AUTH_MODE=hub`.
6. Before the switch, run `npm run central:sync -- --dry-run` against the staging database and look at the users Central does not match. A different email in Central creates a second account for the same person.

Switching back to `AUTH_MODE=google` restores the old sign-in. Local users keep their rights as last copied from Central.

## 9. Configure automatic deployment from GitHub

Use a Komodo **Procedure** so every successful webhook delivery runs a full Stack deployment, including image rebuilds and migrations.

1. Create a Procedure named `Woko Production Redeploy`.
2. Add one enabled stage containing an enabled `DeployStack` execution for `woko-work-orders`.
3. Enable the Procedure webhook and configure a dedicated random webhook secret.
4. Use the GitHub listener URL for branch `main`:

   ```text
   https://<komodo-host>/listener/github/procedure/<procedure-id>/main
   ```

5. Create these GitHub Actions repository secrets:

   - `KOMODO_WEBHOOK_URL`: the Procedure listener URL
   - `KOMODO_WEBHOOK_SECRET`: the Procedure's dedicated webhook secret

6. Add a workflow triggered by pushes to `main`. It must send a JSON push payload and an HMAC-SHA256 signature in `X-Hub-Signature-256`.

The maintained workflow is `.github/workflows/deploy-komodo.yml`. It runs on pushes to `main` (production) and `staging`, sends `{"ref":"refs/heads/<branch>"}` to the Procedure listener of that branch, supports manual dispatch, and prevents overlapping deployments of the same branch.

### Staging

Staging is a second Stack and a second Procedure, built from the same `compose.yaml`:

1. Create a Stack for branch `staging` with its own project name (not `woko`, so containers and the database volume stay apart), its own `WEB_PORT` that no other stack on the host uses, and a Stack environment for staging (`AUTH_MODE=hub`, the Hub and Central values, the staging `APP_BASE_URL` and `WEB_ORIGIN`).

On the staging Stack also set `PRODUCTION_URL=https://woko.example.org` (the address of the real Woko, no trailing slash). The app then shows a strip at the top saying this is a test version, with a link to that address. Leave it empty on the real Stack and nothing is shown.
2. Create a Procedure `Woko Staging Redeploy` with a `DeployStack` execution for that Stack, a dedicated webhook secret, and the listener URL for branch `staging`:

   ```text
   https://<komodo-host>/listener/github/procedure/<staging-procedure-id>/staging
   ```

3. Add these GitHub Actions secrets (repository secrets, or in a GitHub Environment named `staging`):

   - `KOMODO_WEBHOOK_URL_STAGING`: the staging Procedure listener URL
   - `KOMODO_WEBHOOK_SECRET_STAGING`: the staging Procedure's webhook secret

   Production keeps `KOMODO_WEBHOOK_URL` and `KOMODO_WEBHOOK_SECRET`. A push to `staging` never reads the production pair when the staging pair is set.

Tests (`verify-pr.yml`) run for pull requests to `main` and `staging` and for pushes to `staging`. The deploy job does not wait for them, the same as production today.

Keep **Run Build** enabled on the Stack. The Procedure uses `DeployStack`, so code-only pushes perform a full deployment rather than relying on Compose-file change detection.

## 10. Backups and upgrades

Before every upgrade, create and verify an off-host PostgreSQL backup. Komodo Stack destruction must never include volume deletion unless permanent data loss is explicitly intended.

The Compose migration service runs on each deployment and applies only pending migrations. Application rollback is safe only when the prior application version remains compatible with the migrated schema.

See the [Docker deployment guide](docker.md) for backup, restore, rollback, monitoring, and detailed Google integration procedures.

## Troubleshooting

### Komodo tries to pull `api` or `web`

Disable **Pre Pull Images / Auto Pull**. Those services use local `build` definitions and are not published registry images.

### Source changes deploy without rebuilding

Enable **Pre Build Images / Run Build** and set build extra arguments to `--pull`.

### Stack reports unhealthy because `migrate` exited

Add `migrate` to **Ignore Services**. Exit code `0` is expected after migrations complete.

### Docker cannot find a credential file

Confirm both `WOKO_*_CREDENTIALS_FILE` values are absolute paths on the selected target server and that the files exist before deployment.

### API remains unhealthy

Check the `migrate` and `api` logs. Confirm PostgreSQL values match, `DOCKER_DATABASE_URL` uses `postgres:5432`, and production does not use `AUTH_MODE=test`.

### Login redirects or cookies fail

Confirm the reverse proxy serves HTTPS and that `APP_BASE_URL`, `WEB_ORIGIN`, OAuth origin, and OAuth callback use the exact same hostname and scheme.
