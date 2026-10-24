# EdgeOdds Parallel-Agent Operating Model

Baseline: EdgeOdds v0.4 at `2e7d67bce715609dadfab8fd59314d4048ed34c7`.

## Purpose

Parallel workers accelerate independent provider, correctness, pricing, evaluation, security, and integration work without allowing multiple agents to redefine the same market truth.

## Rule of authority

Workers produce candidate changes and evidence. The orchestrator owns integration and release decisions.

No worker may independently:
- merge to `main`;
- promote a connector to `LIVE_VERIFIED`;
- change canonical event semantics, normalized quote schema, ingestion semantics, or verification-state semantics without declaring the contract change;
- treat synthetic tests as proof of live provider behavior or predictive profitability.

## Worker lanes

1. source-scout — provider capability, timestamp, quota, licensing, and source evidence.
2. provider-builder — provider adapters and transport behavior.
3. identity-guardian — event/team identity, aliases, reschedules, neutral sites, doubleheaders, ambiguity.
4. market-rules — settlement semantics, periods, pushes/voids, rule versions.
5. price-intelligence — market completeness, best price, no-vig, movement, closing quote and CLV.
6. model-evaluation — chronological evaluation, leakage, calibration, Brier/log loss, abstention.
7. reliability-security — concurrency, idempotency, stale/malformed data, auth, secrets, adversarial tests.
8. edgeboard-integration — read-only API and EdgeBoard compatibility.

## Serialized resources

The following remain orchestrator-controlled:
- `edgeodds/models.py`
- `edgeodds/identity.py`
- `edgeodds/ingestion.py`
- `edgeodds/store.py`
- database migrations
- release-state promotion
- merges into `main`

Ownership violations are not automatically forbidden because cross-cutting fixes can be valid, but they require explicit orchestrator review.

## Required worker report

Each worker must report:
- agent ID and task ID;
- exact base and head SHA;
- changed paths;
- any protected contracts changed;
- test commands executed;
- whether live data was used;
- claims paired with machine-checkable evidence;
- blockers.

A claim without evidence is invalid.

## Integration gate

The orchestrator accepts a candidate only when:
1. the worker report validates;
2. ownership violations are understood;
3. protected-contract changes are explicitly reviewed;
4. branch tests pass;
5. full EdgeOdds regression tests pass after integration;
6. adversarial tests pass for identity, clocks, duplicate/out-of-order data, suspended/removed markets and malformed prices;
7. live/provider claims are supported by archived live evidence, not fixture data.

## Initial branches

After this coordination layer is merged, create all worker branches from that same merge SHA:
- `agents/source-scout`
- `agents/provider-sportradar`
- `agents/event-identity`
- `agents/market-rules`
- `agents/price-intelligence`
- `agents/model-evaluation`
- `agents/reliability-security`
- `agents/edgeboard-integration`

This keeps every first-wave worker on an identical baseline.
