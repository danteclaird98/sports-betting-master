# Sports Research Desk — local continuation candidate

This application extends the recovered `sports_betting_core_changes.zip` Python calculation core. It is a **separate local candidate**, not a replacement deployment or a patch applied to EdgeBoard Lab. A fresh status/source check for `edgeboard-lab-o28tdu` returned Unauthorized. Its implementation, working features, production data and integrations remain uninspected. The earlier EdgeBoard instruction brief and audit report were read; the latest all-sports scope takes precedence over their initial NFL/MLB focus.

## Start

Requires Python 3.10+; no third-party Python dependencies. Unzip, enter the application folder, and run:

```bash
python3 -c 'import secrets,json; print(json.dumps({"dante":secrets.token_urlsafe(32)}))'
# Copy the resulting JSON into the environment variable below.
export BETTING_USERS='{"dante":"YOUR_GENERATED_TOKEN_AT_LEAST_32_CHARACTERS"}'
python3 server.py --db research.sqlite3 --port 8765
```

Open http://127.0.0.1:8765 and enter the generated token. It is held only in page memory. Additional users need distinct tokens in the server-side JSON. Use a private environment configuration and private directory permissions; never commit secrets or your database. Server intentionally binds to loopback. **Do not expose this standard-library server to the internet.** Public deployment requires the existing app's authentication, session management, hosting and security integration. Run only one application process per database; per-process serialization protects concurrent entry/settlement operations within this supported mode.

## Usable workflows

- Discovery/Pregame: import an exact timestamped quote using the editable JSON template; browse and filter research facts, snapshots, exclusions and expiration. Price imports never create a probability model. Manual evidence remains unverified. `authorized_import` labels claimed import provenance, not independent verification of source truth.
- Live: choose Live state in Record type to record source/retrieval timestamps, score, clock, period and feed mode; import matching live quotes separately. Out-of-order state updates are rejected. Disconnects, missing state, stale state and state/price misalignment suppress eligibility. No upstream feed is actually running.
- Wagers: choose Wager, fill required fields and use proposed, paper or actual. This records user-entered information; actual means the user says the wager was placed. It is not confirmation from a bookmaker. Combination entries require leg records. External IDs deduplicate within a sportsbook/user.
- Settlements: choose Settlement and reference the saved wager ID. Payout **includes returned stake**. Profit = payout − stake − fees. Mark provisional until confirmed. Repeating the identical revision does nothing; corrections require a higher revision and retain audit history. Pushes/voids must return stake. Partial, cashout and dead-heat payouts are recorded explicitly, not inferred from unverified rules. Individual leg status remains as imported; no automatic leg grading.
- Performance: confirmed settled stake, profit, ROI, sample counts, record and drawdown; breakdowns by sport, league, market, sportsbook and UTC placement date. Separate currencies/modes. Provisional entries remain open exposure. Deposits, withdrawals and bonuses are not wager profit and have no cash-account ledger here.
- Limits: configurable maximum open stake, per-group stake and daily stake, by currency. Applies to new actual tracking entries. Daily boundaries use UTC, disclosed in the UI. Exposure groups are user-specified; no inferred correlation engine. This is a tracking constraint, not a sportsbook spending enforcement mechanism.
- Coverage/health/audit: visible unavailable feeds/models, designed market list, and persistent record/revision history.

## Calculation and evidence boundaries

Core retains American/decimal conversions, implied probability, proportional no-vig normalization, explicit exhaustive payout EV, dead-heat fractions and coherent probability-bound extrema. EV is sum(probability × net-per-unit), so push/void can have zero return and partial outcomes can be represented explicitly. Binary break-even is only defined for binary win/loss. Undefined break-even in the core is NaN; callers must render it as unavailable rather than serialize as JSON. These helpers are not model inference.

No-vig callers must establish a complete, exactly matched market before using `proportional_no_vig`; the numeric helper alone cannot verify completeness. Market probabilities are benchmarks. The board **never qualifies an opportunity**, because no suitable evaluated model exists. It shows EV/model probability as unavailable, even if a record contains a claimed probability. No ranking, calibrated uncertainty, monetary EV or qualifying price is produced from unsupported assumptions.

Quote snapshots preserve provider and canonical event IDs, publication time when supplied, observation/retrieval/start times, raw source reference, exact market/participant/selection/line/period/rules and a content hash. Canonical mappings and settlement-rule verification are still manual. Quote IDs are immutable; new prices need new IDs. Exact comparisons require identical identity, rules and fresh prices. Quotes are observed offers, not confirmed account-level availability. No alternate-line interpolation or independence multiplication is performed.

Safety defaults: pregame quote age ≤300 seconds; live quote/state age ≤15 seconds; live reported latency ≤5 seconds; state/price alignment ≤5 seconds. These are conservative **local engineering placeholders**, not measured sport/provider guarantees. They must be replaced with provider/sport configuration before connecting live feeds. Supporting event rescheduling, cancellation and rules changes requires a new source snapshot; automated reconciliation is unavailable.

`evaluation.py` offers a descriptive binary prediction audit with explicit chronological boundaries, as-of checks, event-partition isolation, Brier/log loss, calibration bins, baseline comparison, selected/executable returns and sport/market/season counts. It is a callable developer utility, not connected to the UI. Inputs must include the full candidate universe and execution prices/availability. It cannot prove records are complete or that claimed historical facts are true. Model fitting, preprocessing, held-out freeze manifests, clustered uncertainty, selection-bias corrections and multi-outcome simulations remain unavailable. No historical dataset was available, so **held-out improvement is unestablished**.

CLV helper: placed decimal / exact-wager closing decimal − 1, same bookmaker and identity, quote after placement and at/before event start. Changed lines are rejected. Calling code must select and verify the actual last closing quote; the helper does not fetch it. CLV is not populated in the UI.

## Coverage and dependencies

| Capability | Implemented locally | Live verified / dependencies |
|---|---|---|
| 12 market families including props, segments, futures and combinations | Generic import, display and tracking schema | No sport-specific verified adapter or model |
| Deterministic EV and settlements | Core tested; ledger explicit returned payout | Book-specific automatic grading unavailable |
| Discovery / pregame | Manual evidence board and exclusions | Provider discovery/scanning, odds, injuries, lineups, statistics missing |
| Live | Manual state ingestion and stale/order checks | Polling/streaming, recovery, scheduler and alerts missing |
| Wager tracking | Token-isolated SQLite ledger and revisions | Book imports/reconciliation missing |
| Performance | Confirmed results, exposure, ROI and breakdowns | No historical profitability or model-performance evidence |
| Real-money execution | Denied | No execution connector; requires separate exact-wager authorization design |
| Existing deployed app | Not modified | Authorized source export/access required |

## Verification

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile core.py engine.py server.py evaluation.py
node --check web/ui.js  # optional syntax check if Node is installed
```

See VERIFICATION.md for the exact run scope and limitations. No live provider data or real wagers were used. UI templates are placeholders, not current facts. The delivered database begins empty.
