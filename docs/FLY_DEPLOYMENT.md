# Fly deployment of Sports Betting Master

The supplied hostname is `edgeodds-danteclaird.fly.dev`. This repository prepares the combined Node/Python application for that Fly app; its ownership, current image, configuration, health and stored records have not been verified. Configuration in Git is not evidence of deployment.

## Inspect the existing app first

Use an authenticated Fly CLI session for the intended account:

```sh
fly status -a edgeodds-danteclaird
fly config show -a edgeodds-danteclaird
fly machine list -a edgeodds-danteclaird
fly volumes list -a edgeodds-danteclaird
fly secrets list -a edgeodds-danteclaird
```

Compare the real application and configuration before deploying this repository. Save the existing configuration and image reference for rollback. Do not run `fly launch` over an existing app or replace an unrelated service just because its hostname matches. If access is denied or the app does not exist, resolve account/app identity first.

The committed `fly.toml` expects one machine and a volume named `edgeboard_data`, mounted at `/var/data`. If the app already has a data volume, inspect its paths and adapt the mount source to that volume instead of creating an empty replacement. Preserve its region and back up both databases. Only for a confirmed new installation with no data volume, create the named volume in the intended machine region using `fly volumes create edgeboard_data --size 1 --region REGION -a edgeodds-danteclaird`, replacing REGION with the chosen region. Volume and machine resources incur Fly charges.

## Configuration and secrets

The Docker image starts Node on port 3000 and a Python process on loopback port 8788. The Fly proxy exposes only port 3000. A 1 GB shared machine is the initial allocation for both processes; inspect memory and latency after launch before adjusting it.

`ALLOWED_HOSTS` contains the exact public hostname and the health probe explicitly sends that Host header. Host validation runs before the health route. Add any authorized custom domain to the comma-separated list without a URL scheme or path; do not disable validation.

`COOKIE_SECURE=true` is necessary for HTTPS login origin checks and secure session cookies. The runtime's automatic hosting detection only recognizes Render, so Fly must set this explicitly.

Set these secrets through Fly's secret facility, using values from a local secret manager rather than literal values in a shell command or chat:

- `WORKSPACE_PASSWORD`: private password of at least 16 characters.
- `WORKSPACE_SESSION_SECRET`: separate random secret with at least 32 random bytes, kept stable across deploys.
- Optional `WORKSPACE_USER` (defaults to `owner`) and authorized provider credentials.

For example, with private shell variables populated locally, use:

```sh
fly secrets set --stage -a edgeodds-danteclaird WORKSPACE_PASSWORD="$workspace_password" WORKSPACE_SESSION_SECRET="$workspace_session_secret"
```

Do not enable shell tracing, print these variables, commit a secrets file or replace existing secrets without checking the current setup. `--stage` saves secrets for the next deployment without restarting the existing application immediately. Existing private AppDeploy records and provider credentials are not transferred.

## Build and deploy a reviewed commit

Run the repository's normal build and test checks, then validate the config with `fly config validate --strict --config fly.toml`. Build the combined Docker image and confirm its startup before deployment. Fly's config validation requires an authenticated Fly session; parsing TOML locally does not replace platform validation. This change has not provisioned or deployed infrastructure.

Keep exactly one writer machine for the SQLite volume. Inspect existing machines before using `fly scale count 1 -a edgeodds-danteclaird`; do not remove an unrelated machine or its volume. The deployment command disables Fly's automatic spare-machine creation:

```sh
fly deploy --config fly.toml --ha=false
```

The immediate deployment strategy permits brief downtime to avoid rolling old/new application writers. Automatic stopping is off and the minimum is one machine. These settings do not remove pre-existing extra machines; verify machine count separately. Do not enable horizontal scaling or place independent writable copies of the same logical databases in multiple regions.

## Automated hosted-runtime check

After `npm run build`, `npm run test:node` runs `flyHostedGateway.test.ts` against the built Node/Python server. This test requires Python 3.11+ for its standard-library TOML parser; CI uses Python 3.12. It reads the committed Fly environment and health-check Host, substitutes temporary local ports/databases and random test credentials, and checks login, origin/host rejection, secure cookie attributes, private routes and logout. It does not contact Fly or verify public TLS, volume persistence or production credentials. Without the build artifact the test reports an explicit skip.

## Verify launch

1. Confirm the intended image/commit and exactly one machine with the intended volume.
2. Check `https://edgeodds-danteclaird.fly.dev/health` returns HTTP 200 with status `ok` and runtime `self-hosted`. The check includes the internal Python service.
3. Confirm anonymous `/session` returns 401 and the root leads to login; sign in with the configured account and open `/edgeboard/`.
4. Confirm the session cookie is Secure and HttpOnly and an incorrect password is denied.
5. Use a clearly labeled paper journal entry to verify storage across a machine restart, then remove the QA entry through supported controls. Check both database paths are on the mounted volume. Never fabricate a real forecast or actual wager for QA.
6. Inspect source failures explicitly. Missing provider access must not be reported as an absence of betting opportunities. Model approval remains HOLD.

Inspect `fly logs -a edgeodds-danteclaird` and `fly checks list -a edgeodds-danteclaird` when troubleshooting. A 403 health response indicates a Host-header mismatch; a 503 indicates the Python service is not ready. Startup may fail if the password is too short or the data mount is unwritable. A browser login origin failure can indicate a missing `COOKIE_SECURE=true`.

## Preserve data and rollback

Back up both `/var/data/edgeboard.sqlite3` and `/var/data/edgefusion.sqlite3` with the app stopped or SQLite's backup API. Copying a live main database file alone can omit WAL data. Inspect and test Fly volume snapshots and maintain independent backups. Roll back the image/configuration while retaining the existing volume; never delete or replace the volume to roll back code.

The Render and Railway guides remain historical references. Fly is the current configuration target. Actual public deployment health, provider access and private-data migration remain unverified until the checks above are completed.
