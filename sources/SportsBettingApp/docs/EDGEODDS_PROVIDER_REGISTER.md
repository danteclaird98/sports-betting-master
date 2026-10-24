# EdgeOdds Provider Register

Last reviewed: 2026-10-22

This register controls which external market-data sources EdgeOdds may integrate and what evidence is required before a connector can be called live.

## Policy

EdgeOdds is provider-independent. No upstream EdgeBoard logic may depend directly on a vendor payload.

Every provider must document:
- access method and authentication;
- market and league coverage;
- update/timestamp semantics;
- historical-data capability;
- rate limits and quotas;
- redistribution/display restrictions;
- outage behavior;
- source IDs and mapping strategy;
- evidence required for LIVE_VERIFIED status.

Do not bypass authentication, anti-bot controls, geographic restrictions, or contractual access controls.

## Candidate providers

### 1. Sportradar Odds Comparison v2 — preferred first independent live source

Status: NOT_CONFIGURED

Role:
- first independent live sportsbook-odds connector;
- primary candidate for NFL/NBA/MLB/NHL moneyline, spread, and total;
- later candidate for live odds and player props.

Verified documentation characteristics:
- API-key authentication via x-api-key;
- separate Prematch, Player Props, Futures, and Live Odds packages;
- US-focused and global coverage tiers;
- bookmaker IDs and bookmaker-native external market/event IDs;
- sport-event IDs and competitor IDs;
- current/opening decimal, American, and fractional prices;
- spread/handicap and total values;
- sport-event markets change log for odds changes;
- mapping feeds for joining Sportradar entity IDs to other Sportradar products.

EdgeOdds requirement:
- do not mark LIVE_VERIFIED until a real credentialed response is archived and manually reconciled;
- preserve Sportradar IDs and bookmaker external IDs;
- derive freshness from documented provider/update timestamps, never from retrieval time alone;
- retain raw payload hash and provider health.

Credential needed:
- Sportradar developer/trial or production API key.

### 2. Pinnacle bespoke API — direct-source target

Status: NOT_CONFIGURED / ACCESS_REQUIRES_APPROVAL

Role:
- high-value direct odds source and independent reference;
- useful for price comparison and market movement if access is approved.

Verified documentation characteristics:
- API access offered to business partners and individual customers by application;
- pre-match and in-play odds;
- latency/call-rate access is individualized.

EdgeOdds requirement:
- obtain explicit API access before implementation is marked operational;
- document permitted use and redistribution terms;
- keep independent from any sportsbook account/execution logic.

Credential/access needed:
- Pinnacle API approval and credentials.

### 3. The Odds API v4 — optional bootstrap comparator/fallback

Status: OPTIONAL

Role:
- regression comparator while EdgeOdds is being built;
- temporary fallback if already licensed/available;
- never the canonical EdgeOdds schema.

Verified documentation characteristics:
- current/live upcoming events and bookmaker odds;
- moneyline (h2h), spreads, and totals;
- per-book/market update fields in documented responses;
- quota headers and API-key authentication.

EdgeOdds requirement:
- isolate behind the same provider adapter boundary;
- no EdgeBoard code should depend on its native schema;
- may be removed without changing EdgeBoard analytics.

Credential needed:
- existing The Odds API key if this adapter is enabled.

### 4. SportsDataIO — secondary historical/model source

Status: NOT_CONFIGURED

Role:
- historical odds, line-movement, resulting/graded market research;
- possible commercial live feed only under an appropriate licensed plan.

Verified documentation characteristics:
- NFL/NBA/MLB/NHL odds endpoints;
- pregame and in-game moneyline/spread/total products;
- line-movement and resulting endpoints;
- hobby Discovery Lab uses real but next-day-delayed data and is not suitable for live applications;
- Discovery Lab is not licensed for commercial redistribution.

EdgeOdds requirement:
- do not use delayed Discovery Lab data as a live feed;
- label delayed/historical feeds explicitly;
- keep historical/model datasets separate from decision-time executable quotes.

Credential needed:
- appropriate SportsDataIO subscription if used.

## First live-source acceptance gate

A provider may advance to LIVE_VERIFIED only after all of these pass:

1. Authorized credential obtained.
2. Real provider response captured.
3. Raw response archived with hash.
4. Provider/event/market/outcome IDs retained.
5. Provider update time semantics verified.
6. Moneyline, spread, and total normalize deterministically.
7. Removed/suspended markets map to non-open status.
8. Connector outage maps to DEGRADED/UNAVAILABLE, not "no edge".
9. One real event is manually reconciled against provider documentation or UI.
10. Regression fixture created from the real response with secrets removed.
11. Rate-limit and quota telemetry recorded.
12. Data-use/redistribution restrictions recorded.

## Recommended order

1. Connect Sportradar trial/production credential.
2. Normalize one NFL prematch event end-to-end.
3. Add raw payload archive and health telemetry.
4. Expose read-only EdgeOdds endpoints.
5. Connect EdgeBoard to EdgeOdds compatibility output.
6. Use The Odds API, if available, only as an independent comparison during validation.
7. Pursue Pinnacle access for a direct independent source.
8. Expand to NBA, MLB, NHL only after the NFL vertical slice is reconciled.
