# EdgeBoard coordinator wave 2 — 2026-10-26 UTC

## Ground truth and scope

Product mode READ-ONLY: only odds ingestion changed; no user-data endpoint, bet sizing, wagering or money movement added. Security/money audit H was out of scope. GitHub canonical main was observed at `719a9e04537360c373534417e7c17df35c8bfb7d`. Local source checkout began clean on PR #12 at `4e44b14`. AppDeploy read-only status still reports ready, snapshot `1792966364427`, https://edgeboard-research-ai9jat.v2.appdeploy.ai/ . Exact live Git commit remains unknown: the prior pinned search of 135 stored files found no source-commit marker. No deployment or promotion occurred.

Latest observed existing PR heads: #6 b5dc7c8, #7 2865336, #8 f95d8e6, #9 1816e77, #10 1a77b44, #11 c3fa909, #12 4e44b14; all latest Validate runs green. #12 push40246894452 and PR40246914991 succeeded. Historical main failure40242643455 was the tight source deadline assertion, repaired by #5; no new CI repair was needed. #7 depends on #6, and #8 overlaps that workflow port. None was merged by this run.

Actual runtime is Node24/React19/TypeScript/Vite/Tailwind plus Python/SQLite. FastAPI/Pydantic/PostgreSQL/async SQLAlchemy/Alembic/Redis/TanStack Query/OpenAPI-generated types are NOT implemented by this candidate. Replacing the runtime needs its own migration plan and data contracts. This work fixes demonstrated defects in the actual canonical application. Existing archived repositories and frozen model artifacts are preserved.

## Tool inventory and assignments

The session exposes app connectors through the `codex_apps` MCP tools. Relevant tools were preferred over custom HTTP clients for hosted services.

| Available skill/plugin/connector/tool | Assigned task and usage |
| --- | --- |
| Cloud Environment runtime skill; environment_status MCP | Used: network policy/readiness and Docker proxy/CA instructions. Current policy enforced, no configured secret bindings or outbound identities. |
| Parallel Agents skill; collaboration spawn/followup/message tools | Used: three bounded auditors, separate implementation worktrees and independent review. One owner per task; shared-file tasks sequenced. |
| GitHub connector: get_repo, fetch/fetch_file, search_prs, commit/run/job/log reads, branch/diff/PR metadata, create_pull_request | Used: canonical source/HEAD, existing PR/Actions status, historical failure diagnosis, candidate PR. CLI git handles isolated worktrees/cherry-picks/push; gh token is invalid, so API reads use connector. |
| AppDeploy connector: get_apps, get_app_status, get_app_versions, src_glob/src_grep/src_read | Used read-only inventory/status/source provenance. Secret-name metadata, deployment/restore/config/domain tools available but not needed or invoked. Dashboard: https://dashboard.appdeploy.ai . |
| Browser control skill/plugin | Available for future interactive live verification; no browser/source-provider operations needed to establish these local defects. Local Compose verifies HTML/assets, not visual browser rendering. |
| Data analytics analyze-data-quality, validate-data, metric-diagnostics, visualize-data, product-business-analysis, create-data-context, build-report skills | Available for dataset-backed model/calibration work. No genuine held-out archive supplied; no performance claim manufactured. |
| Vercel React best-practices/verification skills and platform tools | Available for applicable React/platform work. No TSX edits or Vercel project established here; unused. |
| Supabase PostgreSQL best-practices/Supabase tools, Firebase, Base44, Sites tools | Available alternative backend/site platforms; not dependencies of this repository, so not substituted for the requested stack. |
| Google Drive/Notion documentation connectors | Available; no supplied authoritative workspace document/link required them. |
| bash, rg, git, Python3.12.14, unittest, Node24.19.0, npm, uv, Docker28.4.0, Compose2.40.3, gh | Used local inspection, tests, worktrees/builds. No psql/redis-cli found on PATH, no active dedicated FastAPI/SQLAlchemy/Alembic skill listed. pytest was initially absent; installed isolated from the project runtime and pinned in requirements-test.txt. |

See the earlier [audit](COORDINATOR_AUDIT_2026-10-25.md) for initial ground truth and operating limits. No irrelevant installed service was accessed merely because its tools exist.

## Ranked evidence and task disposition

1. **Corruption: immutable evidence.** Existing #10 guard/capture fix is included unchanged. Independent review additionally found that legacy `quotes` could be mutated beneath new receipts. The canonical task guards quotes and metadata against UPDATE/DELETE/REPLACE/UPSERT; separate-connection attempts fail. No old snapshot body is rewritten.
2. **Lookahead/model labels.** Existing #11 NFL score/matched-cohort fix and #12 strict pre-start closing/movement fix included. `correctedReceiving.ts` still discloses consumed holdout, calibration partition reuse and missing calibrated uncertainty. Model remains HOLD; no promotion or profitable-model claim.
3. **Latest-price correctness.** Original `app.py:64` replaced same-time quotes by import order. New tests cover conflicting prices/status and permutations, healthy competing books, no old fallback and later clean recovery. Contradictions remain visible/ineligible.
4. **Identity/UTC.** New `integrations/canonical_events.py` matches normalized Unicode/case/whitespace participant names plus league and an immutable <=30-minute anchor. Provider/book/external-ID bindings persist. Multiple candidates, a second same-book provider ID for one event, incompatible participant/start bindings and incomplete/conflicting venue/site evidence reject atomically. Unknown aliases are not guessed; unknown/legacy event metadata remains visible but ineligible. New captured timestamps normalize to UTC; callers and historical rows stay unchanged. Canonical IDs affect read projection only; original IDs/selections and immutable quote receipt/hash remain available.
5. **Quota.** Original `altOdds.ts` requested US×spreads,totals (2 credits) and transport errors could abort healthy providers. New default-off path admits only US×h2h (1 credit), reserves under a shared SQLite transaction before network, reconciles conservatively and isolates failures. Independent review found a rollover undercount; followup blocks new months while earlier outcomes are unresolved. Fourteen fake-provider/quota tests include an actual two-process final-credit race. No fixed-interval paid polling exists or was added; free /sports/events change detection is unnecessary until a scheduler is deliberately introduced.
6. **Performance.** `Workspace.state()` still parses the full archive. Reproducible script `scripts/benchmark-state.py`, three samples each: 1,000 snapshots median17.10ms; 10,000 median195.35ms. SQL plan `SCAN quotes`. Synthetic local timings, not production measurements. Latest projection/history optimization remains a followup rather than an unmeasured rewrite. Requested /odds/latest/history/movement names are not the runtime's API; existing /api/state and EdgeOdds /v1 read paths were audited.
7. **Dashboard.** Legacy web board BEST/FRESH expired only on reload. Seven deterministic clock/DOM tests now cover expiry/kickoff, invalid/future/backward clocks, hidden-tab timer pause and catch-up, no automatic alternate promotion/provider fetching and empty states. Existing React daily/live clocks already worked and were not duplicated.
8. **CI/deployment parity.** Original Docker build measured Python3.11.2 versus CI3.12. Candidate Dockerfile uses Python3.12 with Node24. Health exposes sourceCommit when a full SHA is supplied at build time. Mock Compose isolates a fresh volume/network; no AppDeploy state changed.

## Integration and verification contract

One integrator cherry-picked #10/#11/#12 and the separate latest/UTC, quota and board commits. A later canonical task owns the same app files sequentially. Independent reviewers found/fixed both the quota-rollover and underlying-quote-mutation holes before final acceptance. Red findings stopped progression until regressions passed.

Combined local build passes. Node suite131 passed; model suite8 passed/1 existing external-dataset skip. Python unittest:146 EdgeOdds +45 application +2 Receiving60 passed. Pytest on the same active Python suites:193 passed plus84 subtests. Preserved sources:8 repositories/995 SHA-256 hashes unchanged. Whitespace check passes. The model skip is missing external data, not evidence of model quality.

Local mock Compose started clean and healthy. The built container measured Python3.12.15 and Node24.22.1, with its Docker network confirmed internal=true. Runtime startup logged scheduled monthly credits0 and paid calls disabled. The authenticated local smoke passed one canonical event, four distinct immutable quote records, six observations after three polls (including an exact repeat), correct best book, and served dashboard HTML/JavaScript. Source marker matched the clean build's full candidate SHA. The entire npm test command also passed INSIDE that container:131 Node +8 model +146 EdgeOdds +45 application +2 Receiving60, with the same one model external-data skip (332 passed total).

The execution workspace could not reach the container's published host port (connection refused). The smoke therefore ran through Compose exec at container loopback:3000, not a public or browser probe. No host networking or policy bypass was used. The verifier accepts only those two fixed loopback addresses. These checks do not establish hosted feature parity, external feed licensing/access, real provider freshness, trained-model validity, or visual browser rendering. sourceCommit is declared build metadata, meaningful alongside the clean build/source check; it is not an independent source attestation.

## Local reproduction

```sh
npm ci --no-audit --no-fund
npm run build
npm test
python3 -m pip install -r requirements-test.txt
python3 -m pytest -q
python3 scripts/benchmark-state.py
export EDGEBOARD_SOURCE_COMMIT="$(git rev-parse HEAD)"
# Working tree must be clean so this marker describes the copied source.
docker compose -p edgeboard-mock-audit -f compose.mock.yml up --build -d --wait
python3 scripts/verify-mock-compose.py --commit "$EDGEBOARD_SOURCE_COMMIT"
# If this executor cannot reach published Docker ports, run the same check inside:
docker compose -p edgeboard-mock-audit -f compose.mock.yml exec -T edgeboard \
  python3 scripts/verify-mock-compose.py --base http://127.0.0.1:3000 --commit "$EDGEBOARD_SOURCE_COMMIT"
# Only this dedicated mock project's disposable volume is removed.
docker compose -p edgeboard-mock-audit -f compose.mock.yml down -v
```

Managed builds need the configured proxy CA; compose defaults to /etc/ssl/certs/ca-certificates.crt and supports EDGEBOARD_BUILD_CA. Preserve Docker registry/proxy configuration; BUILDX_CONFIG can select a writable cache directory if the managed home is read-only. No TLS checks disabled. The mock container has no provider credentials and an internal network with no provider egress. Its fixed login is local fixture configuration only, never a production credential.

## Credit budget and recovery

Run spend0 credits. Projected scheduled monthly burn0; no paid poller. Each explicitly admitted call costs1 credit; maximum local shared-account ledger500/month. Historical calls are unsupported by this path (cost10× would require a separate approval/configuration). Startup logs the projection via logOddsApiProjection.

Paid configuration remains DISABLED. Enabling requires ODDS_API_ENABLED=true, absolute durable EDGEBOARD_DB with an existing parent, a stable shared ODDS_API_BUDGET_ACCOUNT, current UTC ODDS_API_BUDGET_MONTH (YYYY-MM), and independently confirmed ODDS_API_MONTH_START_USED0..500. Every consumer of that account must share the same file/account. External consumers bypassing this ledger cannot be constrained; provider headers only reveal their use after a response. Unknown failures keep their reservation. Prior-month unknown outcomes block all later-month admissions; neither a fresh baseline nor a delayed response clears them. No automatic operator recovery is provided. Do not clear reservations or invent usage to resume calls.

Production monthly usage and exact live Git commit remain UNVERIFIED. No credentials, tier purchase, external messages, production migration, merge or deployment were performed.

## Remaining decisions and parked work

Main stays unchanged pending approval. This integration candidate contains existing #10–#12 plus new work; do not merge duplicate alternatives as if they were independent features. Workflow PRs #6/#7/#8 are excluded pending overlap selection. Prospective frozen model data, semantic aliases/rules/period equivalence, production usage/provenance and indexed latest/history projections remain followups. FastAPI/PostgreSQL/Redis/OpenAPI migration is not represented as complete. No AppDeploy deployment may occur without a separate explicit go-ahead.
