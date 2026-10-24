# Sports Betting Master validation

Validation date: October 24, 2026 UTC (October 23, 2026 America/Los_Angeles).

## Scope

Eight source repositories were combined into this public master. EdgeFusion's independent runtime is the base; the hosted EdgeBoard source trees were refreshed to its latest checked-out research release. The original source revisions remain separately preserved in filtered snapshots.

## Automated checks

| Check | Result |
| --- | --- |
| Production application build on Node 24 | PASS |
| Source provenance verification | PASS: 8 repositories, 995 file hashes |
| Node consolidation/runtime tests | 4 passed |
| Node model/cohort tests | 8 passed, 1 skipped |
| EdgeOdds Python tests | 140 passed |
| Application/hosting/import/research Python tests | 27 passed |
| Receiving pipeline Python tests | 2 passed |
| JavaScript syntax check | PASS |
| Bundled optional SDK installation | PASS, installed from `sources/sports-odds-api-python` |
| SDK alias serialization | PASS, checked without live provider requests |
| Final tracked-source Gitleaks 8.30.1 scan | PASS: no findings |

Total: **181 tests passed, 1 skipped**. The skipped cohort test requires the external `NFL_HISTORY_DIR` dataset; it is not counted as a passing historical-data reproduction. Python 3.14 reported inherited SQLite connection ResourceWarnings during tests; no test failed from these warnings.

The build output is ignored and is not part of the public source release. A generic-key detector flags a generated bundle constant, so the final public-release check scans the exact staged source tree rather than ignored generated output. No source-secret suppression rule was added.

## Browser checks

- Root workspace loaded with the master name and five supported import formats.
- American +150 odds produced decimal 2.500 and raw implied 40.00%.
- Sample import added six historical demo snapshots; no demo best-price eligibility was asserted.
- Malformed JSON import returned a visible error without deleting existing records.
- A fictional manual $10 record at decimal 2.5 saved, settled as a win and showed $15 profit with 150% settled ROI. This was QA data, not a betting return claim.
- Journal JSON export downloaded successfully.
- All six EdgeBoard top-level workspaces and all three advanced research sections rendered.
- Independent-model hash routing survived reload, and the return link opened the master.
- Root and EdgeBoard rendered at desktop and 375px with no horizontal page overflow.
- No browser page errors were recorded in the tested navigation flows.

QA used only disposable local databases, which are ignored and not included in GitHub.

## Not verified or enabled

The combined Docker image was not rebuilt because no Docker engine was available. No Render service was provisioned, and no production URL or live provider feed was verified. A published source repository is not a hosted application.

AppDeploy private records were not migrated. Telegram, payment systems, outbound alerts and unattended scraping were not activated. No wagers were submitted, models promoted, provider credentials configured or profitable results asserted.
