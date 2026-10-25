# EdgeOdds

EdgeOdds is the normalized sportsbook market-data layer for EdgeBoard / MarketEdge OS.

## Integration roadmap

See [Decisions API integration roadmap](../docs/EDGEODDS_DECISIONS_INTEGRATION_ROADMAP.md) for the proposed isolated evidence-triage component, its limits, and test gates.

## Current implementation

Implemented:
- canonical event and market identity primitives;
- explicit, provenance-backed team/event alias resolution that rejects ambiguity;
- moneyline, spread, and total market types;
- provider-native IDs alongside canonical IDs;
- a read-only Sportradar prematch connector and strict normalization for its supported markets;
- provider update time kept separate from retrieval time;
- freshness gating that does not substitute retrieval time for a missing provider timestamp;
- append-only SQLite quote snapshots with exact-repeat deduplication;
- a read-only EdgeBoard compatibility contract and standalone read API;
- standard-library regression tests.

Not implemented or not connected in the combined runtime:
- additional sportsbook adapters and broader provider coverage beyond the existing Sportradar connector;
- player props and official roster/injury adapters;
- consensus/no-vig service;
- mounting the standalone EdgeOdds read API inside the combined Node runtime;
- a separately deployed EdgeOdds service;
- betting, sportsbook account login, or order execution.

## Design rule

A connector outage is data unavailability, not evidence that there are no positive-EV opportunities. Unknown fields stay unknown. Provider names and display labels never establish market equivalence by themselves.

## Run tests

From the repository root:

```bash
python -m unittest discover -s edgeodds/tests -v
```

## Next vertical slice

Use the [Decisions API integration roadmap](../docs/EDGEODDS_DECISIONS_INTEGRATION_ROADMAP.md) only after confirming the deterministic normalization path and its archived evidence. Keep the classifier offline/shadow and advisory until its labeled evaluation passes review.
