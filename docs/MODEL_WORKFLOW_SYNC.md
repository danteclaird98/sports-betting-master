# Receiving model workflow synchronization

The live source snapshot `1792961655063` of `edgeboard-research-ai9jat` contains source-backed conditional receiving forecasts, separate frozen 2026 retrospective evidence, and a per-owner forward forecast log. These workflows were missing from the consolidated master at `1a085fdb831c809ac9bb5e6e5e1ff20e4c56eb99`.

This migration adds the minimum module/route closure and preserves the independent Node/Python runtime. Frontend API/auth imports use `runtime/client.ts`; the existing master gateway/router supplies identity and protects private routes. The root return link and existing workspaces remain.

## Models and evidence

The frozen artifact, report, manifest, coefficients, calibration and model approval are unchanged. The forecast module reuses the master's existing canonicalization/readiness and CSV parser. The compact historical seed contains 992 players through 2025 and its canonical SHA-256 is `995a1f266c0bfba209b12f4d3bfb80641f42af99e8de5cc3aca82add66bcfe3c`.

The 2026 report is copied as retrospective evidence, not recomputed or promoted. Its metrics do not establish executable value, prospective validation or an independently timestamped pregame publication.

## Persistent forward log

The independent runtime stores future saved forecasts in a dedicated `eo_receiving_forward_receipts` table in `EDGEBOARD_DB` (default `data/edgeboard.sqlite3`). Existing generic records, AppDeploy records and private exports are not migrated or replaced.

- `(owner,id)` is unique; conflict inserts retain the first receipt and trigger a strong read.
- UPDATE and DELETE triggers reject ordinary SQL mutations; administrators could still change the database or schema, so hashes are not tamper-proof external timestamps.
- Every read is owner scoped; cursor tokens include an owner hash and reject cross-owner reuse.
- The core rechecks receipt hashes, protocol/model identity, server clocks and minimum 120-second lead time.
- Unconfirmed writes are reconciled with one read; a missing response requires reloading history before retrying the same selection.
- No outcome scoring, betting approval or automatic wager execution is added.

No existing data file was opened or migrated during fixture testing. The adapter lazily opens storage only when the authenticated forward-log route is used.

## Routes

Public research reads/calculations: `GET /api/receiving-forecast-options`, `POST /api/receiving-forecast`, `GET /api/receiving-validation`, `GET /api/receiving-forward-protocol`.

Authenticated and owner-matched log access: `POST /api/receiving-forward?owner=...`, `GET /api/receiving-forward?owner=...&nextToken=...`.

The independent gateway exposes these under `/edgeboard-api/`; frontend transport handles that translation. Provider keys are not required for these public-source workflows, and source loading remains explicitly user initiated.

## Deterministic verification

Tests use synthetic schedules/history, isolated temporary databases and injected clocks. Six forecast/seed tests cover frozen-artifact math parity, next-team fixtures, malformed and mismatched requests, integrity-before-source gating, outage/seed tampering and Eastern DST ambiguity. One frozen-validation test checks evidence integrity/HOLD separation. Two storage/core tests cover duplicates, restart, pagination, two owners, cross-owner cursors, mutation rejection and uncertain writes. These nine checks pass locally; they do not measure actual provider availability or profitability.

Release acceptance also requires the consolidated production build, existing regression suites, and host deployment checks. No production deployment or private historical record migration is established merely by this source synchronization.


## Blocker guidance and release checks

The forecast panel includes plain-language explanations and next actions for source, selection, model-integrity, participation, market and forward-validation blockers. Original evidence codes and exported receipts remain unchanged. The baseline workflow comes from live snapshot `1792961655063`; the guidance update is deployed as `1792962032682`.

Six additional deterministic presentation tests cover known and unknown evidence codes. A built-gateway smoke test exercises actual authenticated routes, owner mismatch denial, validation, invalid-request abstention and empty private history without public-source requests; run `npm run build` before it. The gateway test is skipped explicitly if no build is present. Neither local fixtures nor software checks establish live feed availability or profitable predictions.
