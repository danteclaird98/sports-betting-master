# Corrected receiving60 research integration

This change extends the recovered `edgeboard-kshzox` export in `danteclaird98/EdgeBoard`, based on commit `f4c288a2e55ba49318d291f10614b9450fe3b35f`. It does not replace existing independent reception/halftime models or grant live approval. Source export and repository access do not establish hosted deployment access or exact live byte identity.

## Behavior

- Historical fixed/line-aware yardage cohorts now retain finite negative receiving, rushing and passing yards; invalid negative/fractional reception counts remain rejected. Shared identity validation rejects duplicate player-week/player-game rows before both consumers.
- Fixed-model reports show eligible/scored/warmup counts. Receiving cohort from the pinned source:26,097 eligible,23,317 scored,2,780 warmup. The earlier25,798/23,021 totals came from299 excluded negative outcomes and2,777 warmup records.
- Advanced Research → Models & history includes a distinct corrected receiving60 panel. Frozen report exposes train13,344; early2024 selection2,419; late2024 calibration2,490; consumed2025 diagnostic5,064. No retraining or provider calls occur when inspecting this report.
- `GET /api/corrected-receiving-readiness`, `GET /api/corrected-receiving-report`, `POST /api/corrected-receiving-score` expose the immutable installed candidate. Strict target/identity/UTC/history/artifact-availability guards abstain on unsupported data. Caller-supplied histories are explicitly unverified; every response remains HOLD, liveApproved=false and verifiedPositiveEv=false. This route does not write a ledger or execute a wager.

Request schema: `{request:{playerId,gameId,kickoffAt,decisionAt,league:'NFL',position:'WR'|'RB'|'TE',seasonType:'REG',period:'FULL_GAME',stat:'receiving_yards',threshold:60,comparison:'>='},history:[{playerId,gameId,kickoffAt,resolvedAt,observedAt,receivingYards}]}`. Use UTC timestamps with seconds and optional three-digit milliseconds ending Z. Decision cannot be future, after kickoff, or before artifact availability. History must be strictly earlier and resolved/observed before decision, with at least three prior unique games. No current-game stats, odds, alternate lines or second-half forecasts are accepted.

## Model and limitations

Five prior-history features, training-only standardization, logistic L2 chosen early2024 and Platt fit/choice late2024. Negative-yard outcomes remain in history. The artifact, report and manifest are installed under backend/ with SHA-256 checks. Exact retained source hashes and pipeline hash are embedded in the artifact.

2025 has already been inspected. Corrected2025 metrics are reused retrospective diagnostics, not a new untouched test. Raw Brier/log loss:0.081281/0.271798; calibrated:0.082593/0.273671; training-base-rate baseline:0.102104/0.358419. Calibration worsens both diagnostic losses; the late2024 choice is retained rather than retuned using2025. The calibration comparison used to select it is in sample. No predictive uncertainty or contemporaneous sportsbook advantage has been validated. Revised historical archives and weekly ordering do not prove original availability, current eligibility, participation or settlement. Forward validation must use immutable pre-kickoff receipts under a frozen protocol.

The frozen candidate uses player identity across seasons. The legacy rolling-backtest pipeline retains its existing player_id|position convention; these are separate experiments, not identical estimators. Their recalculated metrics must not be substituted for the installed artifact report.

## Verification and reproduction

Node24 or later:

```sh
npm run test:model
python3 -B -m unittest discover -s research/receiving60 -p test_pipeline.py -v
```

The default Node run skips the real-data audit unless `NFL_HISTORY_DIR` points to the five original hash-matching weekly CSVs. Download their URLs from the public nflverse `stats_player` release (`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_YEAR.csv`, YEAR2021–2025) and check artifact.source_hashes before use. Mutable release URLs may change: do not update expected hashes merely to make tests pass.

With pinned raw files, set `NFL_HISTORY_DIR=/absolute/path/to/raw` before the test command to execute all9 groups, including the exact cohort assertion. The Python inference/unit checks use only the standard library. Training needs numpy:

```sh
python3 research/receiving60/pipeline.py train --raw-dir /absolute/path/to/raw --output /tmp/receiving60-reproduction
```

Compare generated artifact/report hashes to the manifest and independently inspect predictions.jsonl. Do not silently update the frozen artifacts or availability timestamp after model changes. A new model/version needs a new forward evaluation.

Checks completed before PR:9backend tests with pinned raw data;2Python tests; independent all23,317-feature/probability/loss reconstruction; repeated deterministic training; frontend Vite bundle and complete backend esbuild bundle with platform SDK imports externalized; focused TypeScript check for new component/service using official SDK declarations. Full-project typecheck still encounters unrelated existing SDK-module declarations and an unused todayKey in WagerTracker. Those are not claimed fixed here.

Local browser check used the real source frontend and corrected service through a temporary test transport; external sources/authentication were disabled. It verified rendered metrics, malformed JSON error, backend INVALID_REQUEST_SCHEMA/HOLD and edit invalidation. This is local integration evidence, not hosted QA. Existing tests/tests.json now covers these workflows for a later AppDeploy QA run.

## Publishing

Before applying to the existing app, obtain authorized source/deployment access for app_id `edgeboard-kshzox`, retrieve its current snapshot and compare changes since this export. Apply only reviewed diffs and new files; preserve secrets, databases, resources and newer reception/halftime models. Do not deploy a clone or overwrite a divergent live snapshot. Check new API routes, artifact identity, input abstention and UI after deployment. The connected AppDeploy links still returned Unauthorized when this integration was prepared; no hosted publication is claimed.
