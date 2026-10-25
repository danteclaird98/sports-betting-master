# Legacy deployment option: Railway

This guide is retained as an alternative. The repository's current recommended deployment path is Render; see [the Render migration guide](RENDER_MIGRATION.md). Railway has not been provisioned or verified for this app. One container runs the Node gateway and internal Python service; a persistent volume holds both SQLite databases.

Status: configuration prepared; no Railway project, service, volume or production URL has been provisioned or verified by this change. Railway usage and storage may incur charges; review your account's pricing before provisioning.

## Create the service

1. Sign in at https://railway.com/new and choose **Deploy from GitHub repo**. Authorize Railway for `danteclaird98/sports-betting-master`, select branch `main`, and keep the repository root as the service root.
2. Railway reads `railway.toml` and the existing `Dockerfile`. If the first automatic deployment fails before configuration is complete, finish the following steps and redeploy.
3. Add a persistent **volume to this service**, mounted at **/var/data**. Both databases must use this mount. Keep one replica; independent local SQLite stores must not be scaled horizontally.
4. Under networking, generate a public HTTPS domain. Use the application target port **3000**, unless you explicitly configure a different `PORT`.
5. In service variables, set the values below. Enter secrets directly in Railway; do not put them in GitHub, browser code, or chat.

| Variable | Value |
| --- | --- |
| `HOST` | `0.0.0.0` |
| `PORT` | `3000` |
| `WORKSPACE_USER` | `owner`, or your chosen username |
| `WORKSPACE_PASSWORD` | A unique private password of at least 16 characters |
| `WORKSPACE_SESSION_SECRET` | A separate random secret, at least 32 random bytes; keep stable across deploys |
| `COOKIE_SECURE` | `true` |
| `ALLOWED_HOSTS` | Your exact generated hostname **without** https:// or a trailing slash, followed by `,healthcheck.railway.app` |
| `EDGEBOARD_DB` | `/var/data/edgeboard.sqlite3` |
| `EDGEFUSION_DB` | `/var/data/edgefusion.sqlite3` |

For example, if Railway generates `your-service.up.railway.app`, use `your-service.up.railway.app,healthcheck.railway.app` for `ALLOWED_HOSTS`. The second host permits Railway's health probe; it does not bypass application authentication. Do not use a wildcard or disable the gateway's Host check.

6. Deploy the configured service. Wait for the Docker build and `/health` check to succeed. The startup probe can take up to 180 seconds; subsequent process failures retry at most three times.
7. Open the HTTPS domain and sign in. If using a custom domain later, add that exact hostname to `ALLOWED_HOSTS` and retain `COOKIE_SECURE=true`.
8. In deployment settings, use Railway's CI-wait option if available so GitHub validation completes before automatic deployments. Otherwise disable automatic deployments and deploy reviewed commits manually. Never run the private preview adapter as the public production server.

## Verify before calling the launch complete

- `GET /health` returns HTTP 200 and `{"status":"ok","runtime":"self-hosted"}`. This checks the internal Python service too.
- Unauthenticated `GET /session` returns 401; the root redirects to sign-in.
- After sign-in, the root workspace and `/edgeboard/` both load.
- A sample import is labeled historical/demo and does not assert current opportunities.
- A fictional journal entry saves, settles and exports correctly.
- After restarting/redeploying, the journal entry remains. Check both database files reside on the mounted volume; do not infer durability from a page reload alone.
- The session cookie is HttpOnly, SameSite=Strict and Secure. Wrong-password sign-in fails.
- Confirm the deployed commit and GitHub validation result. A configuration commit alone is not evidence of a running service.

Remove fictional QA entries through supported application controls when finished.

## Live feeds and existing data

Provider keys are optional for launch. Add only authorized keys as server-side Railway variables: `SPORTSGAMEODDS_KEY`, `PARLAY_API_KEY`, `THE_ODDS_API_KEY`, `SHARPAPI_KEY`, `CLEARSPORTS_API_KEY`, `PUCKAPI_API_KEY`. Check actual provider access and quotas independently. Missing credentials mean unavailable feeds, not no betting opportunities.

Existing preview/AppDeploy/private records are not transferred by this deployment. For existing SQLite data, stop the relevant app and make a backup (or use SQLite's backup API), then transfer each database to its corresponding mounted path. Never overwrite a running database or copy only the main file while WAL writes are active.

## Backups and rollback

Enable the volume backup facility available on your Railway plan and verify a restore before relying on it. Keep independent exports/backups of important records. Roll back code by redeploying a known-good commit; preserve the volume. A volume is persistence, not a complete backup policy.

## Troubleshooting

- **403 Invalid host:** make `ALLOWED_HOSTS` match the generated/custom hostname exactly and include `healthcheck.railway.app`.
- **Sign-in rejected despite correct password:** ensure the public URL uses HTTPS and `COOKIE_SECURE=true`; then retry after any login throttle expires.
- **Startup exits:** verify a 16+ character password, writable mounted volume and successful Docker build.
- **Health remains 503:** inspect the internal Python startup/storage error in Railway logs without sharing credentials.
- **Lost records after redeploy:** stop writes and inspect the volume attachment and both database paths before adding more records.
