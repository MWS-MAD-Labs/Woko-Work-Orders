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
SESSION_DURATION_HOURS=8

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
- Keep `AUTH_MODE=google` in production.
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

## 9. Configure automatic deployment from GitHub

After the first successful manual deployment:

1. Open the Stack's **Config → Webhooks** section.
2. Ensure webhooks are enabled and the branch is `main`.
3. Copy the Stack **Deploy** webhook URL.
4. Open `MWS-MAD-Labs/Woko-Work-Orders` on GitHub.
5. Go to **Settings → Webhooks → Add webhook**.
6. Set the payload URL to the Komodo Deploy webhook URL.
7. Set content type to `application/json`.
8. Set the secret to the same value as Komodo's `KOMODO_WEBHOOK_SECRET`, or the Stack-specific webhook secret.
9. Select push events.
10. Enable **Webhook Force Deploy** on the Stack.

Komodo will ignore pushes to branches other than the Stack's configured branch. Force deploy is required here because Komodo's normal change check tracks the Compose and configured environment files, not every TypeScript source file in the repository. Without it, a code-only push can be treated as having no deployment changes.

Because this Stack builds images from repository source, keep both **Webhook Force Deploy** and **Run Build** enabled for webhook deployments.

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
