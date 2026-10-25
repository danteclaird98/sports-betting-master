# Read-only evaluation of saved receiving forecasts

The Independent model workspace can evaluate the signed-in owner's archived pregame forecasts against published 2026 regular-season player outcomes. This is descriptive probability monitoring under the unchanged `receiving60-forward-v1` protocol. It does not calculate betting returns, change predictions, refit calibration, approve a model or place wagers.

## Use

1. Sign in and select a genuine future player/game in the existing receiving forecast workflow.
2. Save its server-calculated forecast at least 120 seconds before kickoff. The first saved receipt remains authoritative; no fake or retrospective receipt is created by evaluation.
3. If a saved game's kickoff is still in the future, evaluation shows the waiting forecast count and next scheduled kickoff in UTC, as of the evaluation timestamp. These rows use `GAME_NOT_STARTED` and remain unresolved with no performance score. For a future-only archive no public outcome sources are requested. After outcomes are published, click **Evaluate saved forecasts**. An empty or future-only archive makes no public-source requests. No production forecasts were seeded by the implementation or its tests.
4. Inspect included, scored, unresolved and unique-game counts. The selected model, raw model and frozen training base rate are scored on the same resolved rows using Brier and clipped log loss (clip `1e-15`). No score is shown when no rows can be scored.
5. Download the evaluation evidence. For larger logs, explicitly continue to the next archive batch or next set of final-game checks. Reports are separate snapshots; the application does not silently pool overlapping windows or different owners/models.

## Outcome evidence and scope

The loader reads NFLverse's games.csv and follows its documented `espn` event identifier to the ESPN game summary. It requires exact event identity, 2026 regular-season identity, matching home/away teams, matching kickoff and scores, and `completed: true` with state `post`. A past kickoff or nonblank score alone never establishes finality.

Only after these checks does it fetch NFLverse's published weekly player file. The exact player ID and game ID must have one REG WR/RB/TE row. The frozen target is receiving yards >=60, conditional on a recorded player row. Missing players are unresolved, not assumed to have zero yards. Malformed CSV quoting is rejected before values are interpreted. Multiple rows for the same player/game remain ambiguous even when their season type or position differs. Duplicate, invalid, unsupported, nonfinal and unchecked outcomes remain unresolved. Negative recorded yards are valid; missing yards are not fabricated.

These are public data observations, not bookmaker settlement confirmations. Retrieval clocks and text SHA-256 values are retained for the schedule, finality summaries and outcome file. Original publication clocks remain unverified. Signed release-asset redirect URLs are neither logged nor exported. Raw public files are not persisted by this first read-only iteration; retaining a report alone does not archive the underlying dataset.

## Bounds and failure behavior

- Each request verifies at most 20 private history pages / 200 receipts. Failed history verification aborts evaluation; invalid stored records are not silently excluded.
- At most eight due-game IDs are checked in a deterministic sorted window, with at most four concurrent requests. Explicit continuation can check later game windows in the same private archive batch.
- The entire evaluation has a 26-second deadline covering protocol loading, verified archive reads, public sources and scoring. A request timeout returns an explicit retryable failure with no partial report. Late archive reads cannot start source requests or produce scores. Public fetches receive the shared cancellation signal.
- Within that request, the public-source stage retains its 24-second maximum and per-request body and time limits. An unavailable outcome file leaves outcomes unresolved; no older substitute is used. The request-wide deadline takes precedence if the archive consumed part of the budget.
- CSV responses are bounded at 16 MB and ESPN summaries at 2 MB. GitHub release redirects are followed manually only to approved HTTPS release-asset destinations; schedule and ESPN redirects are rejected.
- A partial private archive batch never claims full-cohort coverage. A fully loaded archive can still have unresolved outcomes or incomplete finality coverage; the two concepts are separate.
- Account capture/acceptance and request generations prevent a delayed response or private download from crossing an account switch.

## API and independent runtime

`POST /api/receiving-forward-evaluation?owner=...` requires authentication and matching owner identity. The only optional request fields are a validated saved-history `nextToken` and a bounded `finalGameOffset`. Client predictions, probabilities and outcomes are rejected. The independent gateway exposes the route under `/edgeboard-api/`.

The same evaluation modules are used in AppDeploy and the independent Node/Python master; the existing storage adapter supplies verified history in each runtime. Existing frozen model artifacts, protocol JSON, saved forecast records and source snapshots are unchanged. The master also receives the newer archive integrity verifier already live in AppDeploy, which checks probabilities against the frozen artifact and verifies source/timing/scope flags.

## Verification

Deterministic synthetic fixtures cover exact and mismatched finality, threshold boundaries, negative/missing yards, duplicate and missing rows, source failures, allowed/rejected redirects, overall deadlines, large archive/window continuation, owner switching and malformed responses. Temporary SQLite fixtures verify unchanged first-write records and stronger integrity checks. The built-gateway smoke test checks authentication, owner denial, rejected client outcomes and an empty evaluation without public-source calls. These tests establish software behavior, not real forward model performance.

## Remaining work

Collect genuine pregame receipts and wait for published outcomes. Evaluate the resulting manually selected cohort with unresolved coverage disclosed; do not infer general population performance or profitability. A later reproducibility improvement can archive authorized raw outcome snapshots and corrections without changing the original predictions. Confidence intervals and calibration summaries require an explicit sample/cohort plan and sufficient data; no automatic promotion threshold is introduced here.
