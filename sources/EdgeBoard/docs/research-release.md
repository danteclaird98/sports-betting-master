# EdgeBoard Research deployment

Live app: https://edgeboard-research-ai9jat.v2.appdeploy.ai/

Direct model workspace: https://edgeboard-research-ai9jat.v2.appdeploy.ai/#model

This release extends merged source commit 04612cba1552a07447059099b8683e51be852385. It is a new user-owned AppDeploy application, not an update to the inaccessible shared edgeboard-kshzox deployment. Existing databases, records and provider credentials were not migrated.

## Improvements

- Independent model is directly accessible in the main navigation, with hash routes that support refresh and browser back.
- Inspection reads model readiness and the frozen report together, verifies the response identity and research-only flags, and fails closed. A failed integrity check disables scoring.
- Cohort cards explain eligible/scored/warmup counts and the original 2,777-row gap. The report shows raw/calibrated/baseline diagnostics, calibration deterioration and consumed-2025 limitations.
- Audit JSON can be downloaded from the already loaded responses. Its generated object URL is revoked on replacement or unmount. Provenance links to the nflverse source release.
- The obsolete assistant-report link to the shared deployment is removed. Generate/copy/download use this app's SDK transport.
- Public legacy scans no longer fall back to keyed Parlay, SharpAPI, Odds API or ClearSports requests. Provider authorization is a server-controlled argument that request JSON cannot enable. Public Caesars returns OPT_IN_REQUIRED. Separate existing signed-in, explicit provider workflows remain.
- Fixed two inherited strict TypeScript errors and an unused tracker variable. Model weights, calibration and frozen evidence are unchanged.

## Verification

Before publishing: 9 model tests passed with all five SHA-matching raw historical files, 2 Python checks passed, full frontend and backend strict type checks passed using official SDK declarations, and both application bundles passed with platform-injected SDK imports externalized. Seven mocked public provider paths made zero provider-secret reads and zero keyed-provider requests.

AppDeploy reported snapshot 1792814667842 ready, with empty frontend/backend error lists and empty QA frontend/network error lists. Live central API checks passed:

- GET corrected-receiving-readiness: artifactVerified=true, HOLD, no live approval.
- GET corrected-receiving-report: expected train13,344 / selection2,419 / calibration2,490 / consumed-diagnostic5,064.
- POST corrected-receiving-score with {}: INVALID_REQUEST_SCHEMA, null probability, HOLD.
- GET wager-ledger anonymously: HTTP401.
- GET caesars-feed: OPT_IN_REQUIRED without provider requests.

AppDeploy normalized source formatting, including JSON whitespace. Canonical artifact integrity is verified by the running service; original training-file SHA values remain provenance of the original frozen bytes. Do not treat the original byte SHA as a digest of reformatted hosted JSON.

The five UI workflows are delivered in tests/tests.json. AppDeploy's returned ready snapshot supplied basic QA/error evidence, not per-workflow completion results for all five scenarios. Independent interactive browser verification was blocked by a browser permission denial. Do not claim the complete UI suite or signed-in persistence was independently verified.

## Model scope

Receiving60 is a conditional historical research model for regular-season WR/RB/TE recorded-player rows. No untouched forward holdout, current participation verification or bookmaker EV advantage has been established. The calibrated probability worsened both consumed-2025 diagnostic losses. Every model response remains HOLD; no financial execution is enabled.
