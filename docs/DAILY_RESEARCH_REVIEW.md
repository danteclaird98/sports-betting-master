# Daily research review and next steps

Review scope: daily research scan, source/model status separation, and the path to independent model research. The starting master revision was `05f2eb2f727d938b1e17d71497fd7e66196f401c`; the reviewed live snapshot was `1792961225685`.

## Evaluation

The original unconditional warning is fixed. Feed data availability is now separate from model approval, the dashboard exposes per-source diagnostics, and users can open the existing receiving model research. HOLD, zero stake, unknown EV and unchanged model approval remain appropriate.

The follow-up review found five implementation gaps: malformed successful HTTP responses could crash rendering; observations stayed on the upcoming board after kickoff; absent source diagnostics looked like a successful empty result; rejected sport rows omitted `dataStatus`; report generation was mislabeled as data acquisition.

## Small implementation steps completed in this patch

1. Validate scan responses before storing/rendering them. Invalid shapes produce a visible retryable error. Missing or unrecognized diagnostics have an explicit incomplete-evidence state.
2. Give research scans a maximum 60-second display lifetime. Remove games at kickoff, clear displayed candidates and price cards when expired, and block copying expired research. The timer makes no provider requests. This is an engineering display policy, not evidence of sportsbook quote freshness.
3. Add consistent rejected-scan data status and expose report-generation and original source-retrieval times separately. Missing source timestamps stay unavailable.
4. Add deterministic checks for malformed payloads, unknown diagnostics, partial failures, kickoff transitions, expiry boundaries and preserved model guards. Twenty focused tests pass locally. Deployment and GitHub CI are separate release checks.

## Next milestones, in order

### 1. Reconcile model workflow source versions — implemented

The live app has source-backed receiving forecasts and a 2026 validation panel that are absent from the reviewed consolidated master. Inventory the live module/dependency hashes, port only those modules and routes, adapt the master's independent runtime imports, then run forecast parity fixtures and a production build. Do not overwrite source snapshots under `sources/` or claim private records were migrated. The follow-up [model workflow synchronization](MODEL_WORKFLOW_SYNC.md) implements this dependency closure and an isolated owner-scoped append-only SQLite adapter. Existing private records are not migrated.

### 2. Explain model blockers with useful actions — implemented

Translate source-error and approval-blocker codes into plain language while retaining exact codes in exported receipts. Distinguish retryable data retrieval from methodological requirements. A source retry may restore calculation; it cannot grant betting approval. The receiving forecast panel now shows plain-language explanations and next steps while preserving original codes in receipts.

### 3. Establish forward evidence

The forward log now retains the first manually selected server-calculated receipt under a frozen protocol; no prospective outcome evidence is claimed. Choose one exact target (currently the receiving model is conditional full-game receiving 60+), freeze the artifact, define the eligible cohort and record predictions before events. Preserve decision times, feature availability, participation assumptions, model hashes and eventual settlement. Add source-backed accepted prices and verified rules before evaluating betting returns. No retrospective statistic substitutes for this prospective record.

### 4. Evaluate before any approval change

Compare out-of-time probabilities to prespecified baselines and matched market benchmarks, with calibration, proper scores, coverage, uncertainty and execution evidence. Keep missing-data and rejected decisions in the audit. Document failures and sample-size limits; do not automatically promote a model from a positive return or a passing software test.

No profitable wager, live model approval, provider entitlement or automated execution is established by this work.
