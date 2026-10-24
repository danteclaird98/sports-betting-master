# Validation — 2026-10-24

- EdgeOdds inherited suite: 140 tests passed.
- Research controls and app integration suite: 18 tests passed.
- JavaScript syntax: `node --check web/app.js` passed.
- Chromium browser: empty state, historical demo import, three-book quote table, wager entry, win settlement and profit rendering passed.
- Mobile browser at 390 × 844: no document horizontal overflow.
- Browser page errors: none observed.
- Integration checks cover atomic import rollback, repeat deduplication, out-of-order provider timestamps, exact-rule separation, stale/demo/missing-time exclusions, SQLite persistence, profit/ROI arithmetic, duplicate-settlement refusal and cross-origin rejection.

Tests use fixtures, temporary databases and loopback HTTP. No live sportsbook provider or deployed service was verified. Screenshot: `../EdgeFusion-preview.png` in the workspace, outside the repository.

GitHub publication attempt: `gh repo create danteclaird98/EdgeFusion --private ...` returned `Get https://api.github.com/users/danteclaird98: Forbidden`. No GitHub repository was created. Existing source repositories and deployments were not modified.

Follow-up diagnosis: a standard proxied HTTPS connection to `api.github.com` fails at CONNECT with 403. The enforced network policy omits that hostname. CLI credential validity remains unverified until network access is enabled. `scripts/publish-github.sh` passes Bash syntax validation; publication remains blocked.

Publication resolved: the user created the private `danteclaird98/EdgeFusion` repository through GitHub. Authenticated Git HTTPS successfully pushed `main`. GitHub connector confirmed private visibility and push permission. Previous API-network diagnosis remains historical; publication used the working Git transport.

## Independent hosting and full EdgeBoard migration

- Production Vite/esbuild build passed with Node 24.
- 179 automated tests passed: 140 EdgeOdds, 27 application/provider/hosted-gateway, 2 receiving-pipeline, 2 Node runtime, 8 model tests. One inherited real-cohort test remains skipped because its external historical dataset is unavailable.
- Migrated EdgeBoard model artifact hashes verify; its readiness remains HOLD.
- Real OddsHarvester first-quarter export fixture preserves periods, missing source time and blocked outcomes.
- Official SportsGameOdds SDK was installed from the pinned user-repository revision inside Docker. Its real typed Event serialization was passed through the adapter successfully, without making a live API request.
- Hosted browser checks passed: password login, full EdgeBoard React application rendering, native database CRUD probe, return navigation, EdgeFusion sample import, and 390-pixel mobile width. No JavaScript page exceptions were observed.
- Host/origin rejection, unauthenticated API denial, session logout and refusal to start publicly with a missing password passed.
- Docker build passed. A fresh container accepted an authenticated wager; after replacing the container on the same named volume, the wager remained. The EdgeBoard storage probe passed both before and after replacement. Test containers and their test-only volume were removed.
- No `@appdeploy` imports or AppDeploy API URLs remain in executable runtime/frontend/backend source. Historical manifests retain their provenance.
- React review applied to changed integration points: hooks and component structure were retained, requests use the same-origin client, navigation uses a normal accessible anchor, and authentication is enforced server-side.

Render provisioning and a live Render URL are not verified. No live paid-provider request, automatic notification, wager placement, subscription or scrape was initiated. AppDeploy production records and provider secrets were not accessible and were not migrated. See `RENDER_MIGRATION.md` for the exact remaining setup.
