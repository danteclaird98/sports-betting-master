# EdgeOdds Architecture

## Product role

EdgeOdds is a provider-independent market-data service for EdgeBoard / MarketEdge OS. It is not a forecasting model and it is not a wagering executor.

Its job is:

```
authorized data source
    -> provider adapter
    -> raw payload archive + provenance
    -> event/entity resolution
    -> canonical market normalization
    -> immutable quote snapshots
    -> freshness / connector health
    -> EdgeOdds read API
    -> EdgeBoard analytics (de-vig, model comparison, EV, CLV, calibration)
```

## Initial scope

Leagues: NFL, NBA, MLB, NHL.

Markets: pregame moneyline, spread, total.

Explicitly deferred until the base layer is proven: player props, same-game parlays, live micro-markets, automated sportsbook login, bet placement, and broad scraping.

## Canonical identity

An EdgeOdds quote must preserve enough identity to prevent false equivalence:

- canonical event ID;
- provider event ID;
- provider market ID;
- sport, league, season, participants, start/reschedule history;
- market family;
- selection/side;
- exact line where applicable;
- period;
- settlement-rules hash/version;
- bookmaker;
- provider;
- source timestamp;
- retrieval timestamp;
- market status;
- normalized decimal price;
- raw-payload hash.

Display names are never sufficient for execution-grade matching.

## Connector evidence states

`NOT_CONFIGURED -> CONFIGURED -> AUTHENTICATED -> RESPONDING -> SCHEMA_VALID -> SOURCE_FRESH -> LIVE_VERIFIED`

Temporary states: `DEGRADED`, `UNAVAILABLE`.

Capability state: `UNSUPPORTED`.

These are evidence milestones, not authorization to wager.

## Storage

The first implementation uses append-only SQLite snapshots because it is local, auditable, dependency-light, and sufficient to prove the contract.

Production migration target should preserve:
- immutable quote history;
- raw payload references/hashes;
- provider/event/market indexes;
- idempotent ingestion;
- retention policy;
- clock/freshness diagnostics;
- source-license metadata.

PostgreSQL/TimescaleDB is a likely later target when ingestion volume or deployment requires it. Migration should happen after the normalized contract is stable, not before.

## Source policy

Every provider adapter must document:
- access method;
- authentication;
- allowed leagues/markets;
- rate limits;
- timestamp semantics;
- historical-data capability;
- redistribution/display restrictions;
- known gaps;
- health checks.

Do not bypass authentication, anti-bot controls, geographic restrictions, or contractual access controls.

## EdgeBoard integration

EdgeBoard should consume EdgeOdds, not vendor-specific payloads.

The first compatibility route should produce a quote object containing EdgeBoard's required identity, source, timestamp, settlement, and freshness fields. EV and forecasting remain downstream. If model probability is unavailable, EdgeBoard must say `MODEL_UNAVAILABLE`; EdgeOdds does not manufacture one.

## Acceptance gate for first live provider

A provider is not marked `LIVE_VERIFIED` until all of the following are demonstrated:

1. documented and authorized access;
2. real response captured;
3. schema parsed without silent fallback;
4. provider-native event and market IDs retained;
5. provider update time retained;
6. raw response hash/archive recorded;
7. deterministic normalization for moneyline/spread/total;
8. freshness behavior tested;
9. source outage surfaces as outage;
10. at least one real event manually reconciled against the source UI/documentation.

## Roadmap

### E0 — Foundation
Canonical models, provider protocol, append-only store, regression tests.

### E1 — Identity
League/team alias registry, canonical event resolver, reschedule/doubleheader handling, settlement-rule versions.

### E2 — First authorized odds source
One live provider, raw archive, health telemetry, moneyline/spread/total.

### E3 — Read API
Sports, events, odds, latest, history, connector health.

### E4 — EdgeBoard compatibility
Adapter into existing Desk/EdgeBoard quote contract; no vendor payload leakage upstream.

### E5 — Consensus
Best price, market completeness, proportional no-vig benchmark, source diversity.

### E6 — Historical/CLV
Verified pre-start reference quote, same-market strict matching, movement history.

### E7 — Provider expansion
Add sources one at a time with independent health, licensing notes, fixtures, and failure tests.

### E8 — Advanced markets
Props/live markets only after identity and settlement semantics are proven.
