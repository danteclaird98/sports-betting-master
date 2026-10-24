# Private interactive preview

The combined app can run inside a private Computer app preview. This is a preview deployment backed by a running sandbox server, not a permanent public website or a production backup service.

## Start the preview

Use Node 24 or newer and Python 3. Install the root dependencies, then run:

```sh
npm ci
npm run build:preview
npm run start:preview
```

The `dist/preview` directory is the deployable frontend. It preserves the actual market board, journal, imports and EdgeBoard research application. The preview adapter listens on loopback port 8080, and the frontend receives its authenticated proxy URL through the `__PORT_8080__` deployment placeholder.

Do not deploy the repository root or include `data/`, `.env`, the source snapshots or server credentials in the frontend bundle.

## Authentication and storage

The adapter requires the private platform proxy's `X-Visitor-Id`. It hashes that identifier and starts a separate original Node/Python workspace for each visitor, with separate SQLite files and a random internal password. Browser-provided cookies and credentials are not forwarded as identity.

The original gateway's application authentication remains enabled; only the adapter holds its session cookie. Provider secrets, connector tokens and `.env` are not inherited by visitor runtimes. The adapter does not accept arbitrary upstream URLs and only forwards the app's supported API paths.

This identity scheme is valid only behind the authenticated private preview proxy. Do not publish the raw adapter on the internet, trust an unvalidated header from a public client, or substitute `Origin: null` for authentication.

Idle visitor processes stop after 30 minutes and can restart using their existing preview files. The adapter caps active visitor workspaces at 12. A session restart, lost visitor identity or backend shutdown can interrupt access; export important journal records.

Preview files live in ignored `data/private-preview/`. They are not committed to GitHub and are not a permanent backup. Permanent hosting should use the original password-protected gateway, persistent storage and a reviewed hosting configuration.

Slip drafts and risk-limit preferences use tab-lifetime memory rather than browser storage, which the embedded preview does not support. They reset on a full reload; copy checked reports and recheck limits before use. The actual wager ledger remains server-backed and is not replaced with temporary tab state.

## Validation

The production build and all automated suites pass locally: 183 tests passed and one historical-data test skipped because its external dataset is absent. Additional preview tests verify mandatory identity, distinct visitor routing, rejection of caller-supplied cookies, restricted routes and coalesced startup.

The actual preview adapter was checked locally: missing visitor identity returns HTTP 401, and model integrity inspection succeeds with the model still marked HOLD. After six snapshots were imported by synthetic visitor A, visitor B still had zero snapshots and zero markets.

## Hosted preview checks

The private app preview was deployed on October 24, 2026 UTC (October 23 in America/Los_Angeles). Its artifact ID is `4324457f-1aa3-41f5-8a87-f1e708166a3d`, and its canonical viewer is https://www.perplexity.ai/computer/a/sports-betting-master-QyRFfxqjQfWKh_HnCBZqPQ.

The hosted app content was opened in a fresh browser context using the platform's signed private-preview route. The canonical Perplexity viewer challenged the automated browser with Cloudflare verification; the signed app route loaded and its real backend operations passed.

- Hosted reads, odds conversion, sample import, league filtering and refresh passed.
- A fictional QA journal entry saved, settled, persisted on reload and exported with the expected values.
- Malformed JSON showed an error while preserving saved data.
- The full EdgeBoard app opened, all six workspaces and all three advanced sections rendered, and model hash routing survived reload.
- Model artifact inspection returned verified integrity, while approval correctly remained HOLD.
- The return link opened the master workspace.
- Both applications rendered at desktop and 375px without horizontal page overflow; no app page errors were recorded.
- A sandboxed iframe without same-origin/storage access also passed backend reads, sample import, odds conversion, model inspection, a journal write and JSON download.
- Provider sync was disabled because no key was configured.

All records created during these checks were fictional QA data in isolated preview workspaces. No real wager, paid feed, production record migration or deployment to an external hosting account occurred.

Live sportsbook credentials are not configured. The preview does not enable paid feeds, billing, automated wagers, bot messaging or unattended scraping.
