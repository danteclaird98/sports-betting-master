# Consolidation verification inventory

## Market board
- Open the root workspace. Expect the market board and empty-state explanation.
- Change American odds from -110 to 150. Expect decimal 2.500 and raw implied 40.00%.
- Open Data sources and load sample data. Return to Market board and choose a league.
- Expect archived demo quotes, no demo best-price eligibility, and working refresh.

## Import and provider boundaries
- Open Data sources. All five import formats remain available.
- Import malformed JSON. Expect a visible error without losing existing snapshots.
- Provider status must not claim a verified connection when no key is configured.

## Manual journal
- Add a fictional QA record through Wager journal. Expect a pending record.
- Settle it as a win. Expect updated profit and ROI after refresh.
- Export JSON. Expect a download containing the record.

## Full EdgeBoard workspace
- Follow Full EdgeBoard workspace. Expect Today's Board.
- Open independent model, account slip, live research, wager tracker and advanced workspaces.
- Open all three advanced sections. Expect the selected section to render.
- Reload a model hash route. Expect the independent-model workspace to remain selected.
- Return to the master workspace using its navigation link.
- No live wagering, provider billing, scraping, messages or subscription billing is initiated.

## Hosted access
- Unauthenticated hosted requests must be rejected or redirected to sign-in.
- Incorrect credentials must fail; a valid owner sign-in must create a protected session.
- Origin and Host validation, login throttling and per-user records retain automated tests.

## Consolidation-specific checks
- Root package and documentation identify Sports Betting Master.
- All eight source snapshots match their commit/hash manifest.
- No tracked ZIPs, HAR captures, logs, non-example environment files or flagged secret files.
- All source licenses and notices remain with their corresponding snapshot.
- The production gateway builds on Node 24; all existing regression suites pass.
- Inspect root and EdgeBoard at desktop and 375px, including console errors.
- Original repositories and existing deployed services remain unchanged.
