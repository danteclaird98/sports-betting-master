# Migration from AppDeploy to Render

## Ready in this repository

- EdgeBoard's React frontend, all backend source modules and shared contracts are copied from the pinned GitHub revision.
- Every `@appdeploy/client` and `@appdeploy/sdk` import is replaced with EdgeFusion's runtime.
- Original route handlers remain intact. The gateway mounts them at `/edgeboard-api/*`; the migrated frontend translates `/api/*` calls to that prefix.
- Persistent collection CRUD, paginated reads and atomic snapshot upserts use Node's SQLite driver. The EdgeFusion Python service retains its own quote/journal database behind the same authenticated gateway.
- Provider secrets come from server environment variables. AppDeploy endpoints and backend SDKs are not called. Source references in historical manifests remain provenance only.
- A password/session gateway protects both apps. The owner account is single-user; prior AppDeploy OAuth identities are not preserved.
- Docker builds and runs Node 24, Python, the full app and the pinned SportsGameOdds SDK.

## Deploy

Sign in at https://dashboard.render.com and choose New → Blueprint. Connect GitHub, select `danteclaird98/sports-betting-master` and use `render.yaml`. Supply a password of at least 16 characters and review the paid service/disk plan before deploying.

The username is `owner`; change `WORKSPACE_USER` if desired. Render automatically supplies the public hostname and port. The application uses those to validate Host and protect its session cookie. The public `/health` route reports only service health and verifies that the internal Python process is responding.

The Blueprint disables automatic deployments; publishing a Git commit alone will not replace your running service. Use Render's manual deployment control after reviewing changes.

For custom domains, set `ALLOWED_HOSTS` to the exact domain(s), comma-separated, and `COOKIE_SECURE=true`. Enable HTTPS at the hosting platform. Never put provider keys into Vite variables or public JSON.

## Provider keys

Set only the keys for services you actually use in Render's Environment screen:

| Key | Features |
| --- | --- |
| `SPORTSGAMEODDS_KEY` | SportsGameOdds SDK on-demand event/odds imports |
| `PARLAY_API_KEY` | EdgeBoard reference prices and paid-provider research |
| `THE_ODDS_API_KEY` | EdgeBoard The Odds API integration |
| `SHARPAPI_KEY` | Alternate EdgeBoard odds provider |
| `CLEARSPORTS_API_KEY` | NFL injury/context integration |
| `PUCKAPI_API_KEY` | NHL historical player-prop audit |

No AppDeploy production database or secret was migrated. During consolidation, credential-like values were found in an upstream bot configuration and deployment script; those files were excluded from this public repository. Existing provider plans, accounts and quotas must be checked by their owner, and potentially exposed upstream credentials should be rotated. The app does not submit bets, send notifications or activate subscriptions.

## Existing data

The two new persistent databases are `/var/data/edgeboard.sqlite3` and `/var/data/edgefusion.sqlite3`. They are separate stores and are not silently merged. The app's two wager views remain distinct; import/reconcile records deliberately to avoid counting the same wager twice.

Existing AppDeploy records require an export from the account that owns that app. That export is not present here. Do not call this a historical-data migration until an export is imported and reconciled. Browser-local legacy EdgeBoard wagers can still use the existing explicit import flow in its wager tracker; they are not scraped from another origin.

For an existing local EdgeFusion database, stop the local app, back up the database, then transfer it to the matching path on the Render persistent disk while the hosted service is stopped. Keep a second copy until readback is verified. On a live service use SQLite's backup API so WAL pages are included.

## Rollback and portability

Keep database backups before a deployment. Use Render's prior deploy or revert the Git commit; never reset a persistent database to roll back code. The Dockerfile also runs on another container host with a persistent volume, a public hostname allowlist and server-only secrets. There is no Render-specific SDK or AppDeploy runtime dependency.

## Verification limits

For this master, the production application build, regression suites, hosted authentication tests, persistence controls, browser rendering, mobile width and bundled SDK installation were checked. Docker persistent-volume testing was reported for the inherited EdgeFusion baseline only; the combined image has not been rebuilt here.

Not verified: the combined Docker image, Render account provisioning, a deployed Render URL, live provider authorization or parity with unavailable AppDeploy production data. Public GitHub source publication is separate from application hosting; no hosted application deployment is claimed.
