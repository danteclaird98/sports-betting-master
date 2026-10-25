# Sports Betting Master

The combined home for all eight sports-research repositories: the latest EdgeBoard research application, EdgeFusion's independent runtime, the EdgeOdds research engine, provider import adapters, movement history and a manual wager journal. **The shared runtime does not depend on AppDeploy.**

Public master: https://github.com/danteclaird98/sports-betting-master

Use this repository for new development and integration releases. The original
repositories and `sources/` snapshots are reference material; changes imported
from them must be reviewed here before release. A live hostname is not proof
that it runs this repository's current commit.

For the private interactive Computer preview, see [preview startup and security](docs/PREVIEW.md). That path runs the combined app without exposing provider keys and keeps visitor records separate; it is not permanent application hosting.

All eight filtered source snapshots are preserved under `sources/`, with exact commits and file hashes in [the consolidation manifest](docs/consolidation-manifest.json). Original repositories remain unchanged. See [the consolidation guide](docs/CONSOLIDATION.md) for the source map, excluded sensitive files, licensing and integration boundaries.

## Run locally

Requires Node.js 24+ and Python 3.11+. Local Python selection is pinned to the
3.12 series in `.python-version`; CI also uses Python 3.12.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000**. The **Full EdgeBoard workspace** link opens the migrated application at `/edgeboard/`.

Local loopback mode can run without a password. Hosted mode refuses to start unless `WORKSPACE_PASSWORD` has at least 16 characters. Copy `.env.example` to `.env` for local configuration; `npm start` loads it if present. Keep all provider keys server-side.

## Deploy on Fly

Fly is the current deployment target for the supplied `edgeodds-danteclaird.fly.dev` hostname. The reviewed [Fly configuration](fly.toml) uses the combined Node/Python Docker image, port 3000, a single SQLite volume at `/var/data`, an explicit HTTPS/hostname configuration and a `/health` check.

Follow the [Fly deployment guide](docs/FLY_DEPLOYMENT.md). Inspect the existing Fly app, machine and volume configuration before applying this repository. Keep exactly one writer machine and retain existing data. The 1 GB shared-machine allocation is a starting point to verify under load.

The existing Fly service's ownership, image, health and stored records are unverified. This configuration does not provision infrastructure or establish launch success. [Render](docs/RENDER_MIGRATION.md) and [Railway](docs/RAILWAY_DEPLOYMENT.md) documentation is retained as historical reference.

## What's integrated

| Source | Working integration |
| --- | --- |
| EdgeFusion | Shared independent gateway, market board, journal, provider adapters and hosting configuration |
| EdgeBoard | Latest frontend/backend/shared source modules migrated, including independent-model audits and free public-scan guards |
| edgeboard-appdeploy | Export compared with EdgeBoard; newer EdgeBoard research fixes retained rather than reverting to the older duplicate export |
| SportsBettingApp | Normalized EdgeOdds engine, research controls, existing tests and the versioned EdgeBoard import contract |
| OddsHarvester | Direct JSON import for game home/away, 1X2 and supported totals; periods, blocked outcomes and missing provider clocks retained |
| live-odds-tracker | SportsGameOdds snapshot adapter plus significant per-bookmaker movement detection, including zero-point lines |
| sports-odds-api-python | Official SDK pinned to the reviewed user-repository revision; bounded on-demand server-side fetching |
| alexbet-sharp-bot | Original odds-conversion module called by the hosted calculator, plus The Odds API feed imports |

The full EdgeBoard workspace includes today's board, account-slip checks, live/second-half research, wager tracking, scanners, receiver labs, historical calibration, NHL research, parlay audits, quote archives and evidence tools. Their code is preserved and routes are mounted; **provider-backed features still require network access, valid credentials and appropriate provider plans**. Fixture-backed controls and local persistence were tested; live external feeds were not verified.

Telegram delivery, subscription billing, outbound webhooks and unattended scraping are not started by this app. Model artifacts retain their original HOLD status. No automatic wagering or profitable-model claim is included.

Source-backed receiving forecasts, separate frozen 2026 validation evidence and the private forward forecast log are now included in the independent runtime. Model blockers have readable explanations and next actions. [Workflow synchronization and storage details](docs/MODEL_WORKFLOW_SYNC.md) document the source versions, append-only receipts and limitations. No AppDeploy private records were transferred.

The private forward log also supports [read-only outcome evaluation](docs/RECEIVING_FORWARD_EVALUATION.md): exact final-game evidence, unresolved-case accounting, same-cohort Brier/log-loss comparisons, and downloadable source receipts. It never changes saved forecasts or approves bets.

## Data imports and provider setup

Under **Data sources**, choose normalized JSON, SportsGameOdds snapshots, The Odds API responses, OddsHarvester exports or the versioned EdgeOdds→EdgeBoard contract. Samples remain historical demo fixtures, excluded from best-price selection.

```sh
# Optional SDK installation outside Docker; Docker already includes this.
python3 -m pip install -r requirements-providers.txt

# Import a collector export without a provider key.
python3 -m integrations --format oddsharvester --file /path/to/export.json

# Fetch one page of up to 10 events using your configured SportsGameOdds key.
python3 -m integrations --fetch-league NBA
```

Provider names: `SPORTSGAMEODDS_KEY`, `PARLAY_API_KEY`, `CLEARSPORTS_API_KEY`, `PUCKAPI_API_KEY`, `SHARPAPI_KEY`, `THE_ODDS_API_KEY`. Keys are optional and are never stored in Git or sent to the frontend. Provider failures stay failures, rather than being labeled “no opportunities.” Imports namespace provider event IDs; cross-provider event equivalence is not inferred from display names.

For normalized imports, [web/example.json](web/example.json) shows the schema. Missing quote source time stays `null`. Unknown period/rules stay `unknown`. OddsHarvester's scrape time is retrieval time, never provider update time. Source authenticity, availability and rules are not independently verified merely by importing JSON.

## Persistence and migration

The runtime uses two SQLite databases: EdgeBoard records and EdgeFusion snapshots/journal. For the Fly configuration, both live on the persistent volume at `/var/data`. Existing local files are not uploaded automatically. AppDeploy's private database and secrets were not included in the source exports and have **not** been migrated. Existing deployments were not modified.

See [current consolidation guide](docs/CONSOLIDATION.md), [current source/file manifest](docs/consolidation-manifest.json) and [master validation](docs/MASTER_VALIDATION.md). The older [EdgeFusion review](docs/REPOSITORY_REVIEW.md), [source revisions](docs/sources.json), [migration hashes](docs/edgeboard-migration.json) and [validation](docs/VALIDATION.md) describe the inherited baseline, not this consolidation.

## Tests

Use Python 3.11+ for the complete test suite (the Fly smoke test uses the standard-library TOML parser); CI uses Python 3.12. Build first to exercise both gateway smoke tests rather than skip them.

```sh
npm test
npm run build
npm run test:node
npm run test:models
python3 -m unittest discover -s edgeodds/tests -v
python3 -m unittest discover -s tests -v
python3 -m unittest discover -s apps/edgeboard/research/receiving60 -v
node --check web/app.js
```

This is a single-owner app. The production gateway protects both workspaces with a password, signed HttpOnly sessions, origin/Host checks and login throttling. Do not expose the internal Python server directly. Back up both databases with the service stopped or SQLite's backup API; do not copy a live WAL database file by itself. Manual settlement in the simple EdgeFusion journal supports win/loss/void; richer tracking remains in EdgeBoard's wager tools.
