# EdgeBoard coordinator audit

Mode: READ-ONLY product capabilities. No provider calls, user-data writes, production changes, merge or deployment. Audit baseline: main `719a9e04537360c373534417e7c17df35c8bfb7d`.

## Ground truth and tools

Canonical GitHub: danteclaird98/sports-betting-master. The supplied SportsBettingApp checkout is historical/recovery source (README line 1), on local branch work at b4e5d3a, initially clean. Canonical clone initially failed because command networking was disabled; enabling network permission succeeded. gh auth reports an invalid token; use the working GitHub connector for API operations.

Observed stack: Node 24, React 19, TypeScript, Vite, Tailwind, SQLite, standard-library Python; CI Python 3.12. FastAPI/Pydantic/PostgreSQL/async SQLAlchemy/Alembic/Redis/Compose/TanStack Query/generated OpenAPI types are requested targets, not the observed implementation. No migration is inferred to be authorized.

Relevant available capabilities and assignments:

| Capability | Assignment |
| --- | --- |
| GitHub plugin / codex_apps MCP: repo/file/commit/tree/branch/PR/diff reads, Actions jobs/logs/status; branch/commit/PR writes | Ground truth, CI diagnosis, reviewed branch/PR delivery; no merge |
| AppDeploy plugin / codex_apps MCP: app lists/status/versions, stored-source glob/grep/read, secret-name metadata | Read-only production inventory/provenance; deploy/restore/configuration/resource/domain tools available but not invoked |
| Cloud Environment skill + environment_status MCP | Network and credential readiness; no configured runtime secrets or outbound identities observed |
| Parallel Agents skill + collaboration tools | Three read-only bounded auditors: ingestion/data/quota, model/API, dashboard/CI |
| Browser control skill/plugin | Available fallback for live UI inspection; not needed for this source audit and not used |
| Vercel React best-practices/verification skills | Available for future multi-component React edits; no React changes in this slice |
| Data analytics quality/validation/visualization skills | Available for historical data and model evaluation; no dataset supplied for measured calibration |
| Google Drive/Notion tools | Available documentation sources, but no relevant supplied link or evidence requiring access |
| Supabase/Firebase/Base44/Sites/Vercel tools | Available alternative platforms, not used: current repository does not establish these as dependencies |
| git, rg, bash, Python 3.12/unittest, node, npm, uv, Docker CLI, gh | Local inspection, isolated branch, tests and source hash verification; gh authentication unavailable; Docker not exercised |

The exposed app tools share codex_apps naming; no separate PostgreSQL/Redis CLI was found on PATH. No dedicated FastAPI/SQLAlchemy/Alembic skill was listed. Use repository unittest/Node test commands rather than inventing pytest infrastructure.

AppDeploy both connected accounts list edgeboard-research-ai9jat at valid version `1792966364427`; status read reports ready. URL: https://edgeboard-research-ai9jat.v2.appdeploy.ai/ . A pinned-source search across 135 files (both pages) found no GIT_SHA/COMMIT_SHA/gitCommit/commitSha/BUILD_COMMIT/SOURCE_COMMIT marker. Exact live Git commit remains UNVERIFIED; snapshot ID is not a commit SHA. No deployment was performed. App management dashboard: https://dashboard.appdeploy.ai .

## Ranked findings (VERIFIED unless qualified)

1. Snapshot mutation protection is incomplete on main; existing PR #10 owns its fix. No duplicate patch created.
2. NFL missing-score coercion and unmatched calibration comparisons exist on main; existing PR #11 owns its fix. House Model remains HOLD: correctedReceiving.ts:58-59 explicitly discloses consumed holdout and calibration selection limitations. No performance/promotion claim is justified.
3. New: edgeodds/price_intelligence.py:106 only rejected conflicting prices when the entire history had one timestamp. At final simultaneous prices 1.8 and 2.2 after 2.0, ordering changed reported movement. This PR rejects conflicts at every timestamp. app.py:64 has a related import-order latest-selection issue, still open.
4. New: price_intelligence.py:129 included kickoff timestamps in pregame close. This PR requires strictly earlier timestamps; it does not establish source publication/finality provenance or complete operational CLV.
5. altOdds.ts:450-451 requests us × spreads,totals = 2 credits/call. No measured production frequency is available. fetch/body errors at :456-457 escape the parser catch and can reject the aggregate Promise.all at :626. Public keyed requests default off at :595-597.
6. integrations/adapters.py:16-28 retains timezone offsets and namespaces provider event IDs. Cross-provider canonical merging is not wired; explicit identity resolver uses 20 minutes at edgeodds/identity.py:160. Increasing tolerance alone is unsafe for ambiguous fixtures.
7. app.py:55 scans/parses the complete archive per state read: algorithmic O(N), latency unmeasured. web/app.js:7-8 retains BEST/FRESH eligibility until reload; server expiry checks app.py:68-70 cannot expire an already rendered board. Other DailyDashboard/LiveResearchPage visibility and clock controls already exist.

## CI and existing work

main 719a9e0 Validate run 40242786160 succeeded. Historical main 8c4d067 run40242643455 failed the shared source deadline assertion; #5 fixes the tight timing. Current heads #6 b5dc7c8, #7 2865336, #8 f95d8e6, #9 1816e77, #10 1a77b44, #11 c3fa909 all have successful Validate runs. PR descriptions' past local counts are author-reported evidence, not rerun claims from this audit. #7 depends on #6; #8 overlaps workflow scope, so they require sequential integration review. #9 parks the Decisions sidecar. No merge authorized.

## Dependency-ordered next steps

1. Review existing #10/#11 exact heads; M/high, no dependency; done when tests and invariants are checked. Parallel with 2.
2. Fix price time boundaries in price_intelligence.py and its tests; S/high, no dependency; done when kickoff, all conflict permutations and duplicate re-polls pass. Completed locally: 143 EdgeOdds tests pass, source verification 8 repositories/995 hashes, diff check clean.
3. Compare #6/#7/#8 file overlap and select integration order; M/high, no dependency; done when nonduplicated candidate tree passes checks. Shared files sequential; merge approval required.
4. Isolate provider failures and enforce quota admission/default us/h2h; M/high, depends 3 overlap review; done when fake-provider failures preserve healthy sources and denied budget admission makes no request. Durable budget needs a shared storage contract; URL changes alone are insufficient.
5. Trace UTC persistence and integrate explicit canonical bindings; M/high, depends storage contract/#10 review; done when offset-equivalence, two-book one-event, ambiguous doubleheader, 30-minute boundary and append-only re-poll tests pass. Shared storage edits sequential.
6. Benchmark archive reads then address stale board labels; M/medium, depends confirmed runtime paths; done when synthetic growth measurements and deterministic expiry/visibility tests pass. Separate-file work can run in parallel.
7. Integrate selected branches and record deploy provenance; M/high, depends selected fixes; done when mock end-to-end flow, source verification and full relevant suites pass, with source SHA reviewable. Production merge/deploy waits for explicit approval.

Later: deliberate target-stack migration, fresh prospective frozen model evidence, complete operational CLV provenance.

## Validation and budget

This PR's focused changes: 3 new regression test methods, covering 72 conflict permutations plus identical re-polls and exact kickoff. Full EdgeOdds suite: 143 passed. First attempt failed on loopback socket creation under restricted command permissions; rerun with network permission passed. No external feed requested by these tests. Archived source hashes unchanged, diff whitespace check clean.

Run provider spend: 0 credits. Incremental projected monthly burn from this mock-only run: 0. Production burn UNKNOWN, not assumed zero. At current explicit real-call settings burn = 2 × requests/month; 250 calls exhaust 500 credits. Required us/h2h default would cost 1 × requests/month; historical multiplier remains 10. No unattended paid polling enabled by this run.
