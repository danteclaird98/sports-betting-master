# EdgeOdds Provider Evidence Matrix

Reviewed: 2026-10-23

This document records what current provider documentation actually establishes.
It is evidence for connector design, not proof that EdgeOdds has credentialed
access or live-verified data.

| Provider | Access / auth | Relevant coverage | Timestamp / freshness evidence | Historical support | Quota / polling evidence | Licensing / suitability | EdgeOdds role |
|---|---|---|---|---|---|---|---|
| Sportradar Odds Comparison v2 | API key in `x-api-key`; trial and production access levels; key must remain server-side | Prematch, Player Props, Futures, Live Odds; shared IDs and mapping feeds. Prematch includes moneyline/spread/total and period splits. Player Props docs list NFL/NBA/MLB/NHL among covered leagues. | Integration docs expose UTC feed timestamps and update-frequency guidance; live player-props documentation states 60s cache/TTL and 15s bookmaker-price refresh while in play. The reviewed prematch event-market schema still does not establish a guaranteed per-outcome update clock, so EdgeOdds must not substitute retrieval/feed-generation time for quote-update time. | Package-specific feeds plus change logs; current docs emphasize change-log driven refresh. | Pagination must compare `X-Max-Results` and `X-Result`; 429 means slow/retry. Update-frequency guidance recommends change logs rather than blind fixed polling. | Commercial/product entitlement depends on key configuration. No live claim without credentialed response and terms review. | Preferred first independent live connector; retain raw IDs, mapping evidence, package/tier, quota/pagination metadata. |
| Pinnacle bespoke API | Access by application; available to business partners and individual customers | Pre-match and in-play odds; sports offering and latency/call rates are individualized | Public landing page does not provide enough timestamp/schema detail for EdgeOdds freshness verification. Must obtain integration docs/credentialed evidence before implementation claims. | Not established by the public access page reviewed here. | Custom latency and call-rates are negotiated/individualized. | Direct-source target, but access/terms must be approved first. | High-value second independent source after access; do not build against guessed schema. |
| The Odds API v4 | Subscription API key | Current/upcoming/live bookmaker odds; featured h2h/spreads/totals plus event-specific additional markets | Market-level `last_update` is the authoritative freshness field in current docs. Bookmaker-level `last_update` is deprecated. Suspended/closed markets can remain temporarily and stop advancing. | Paid historical odds; event snapshots; additional markets historical support documented from 2023-05-03. | Response headers expose `x-requests-remaining`, `x-requests-used`, `x-requests-last`; quota cost varies by markets/regions. | Useful comparator/fallback if licensed. Do not let native schema leak into EdgeBoard. | Best benchmark for testing market-level timestamp semantics and historical/CLV workflows; optional provider, not canonical dependency. |
| SportsDataIO | API access varies by product; commercial access through sales; Discovery Lab self-serve for personal use | NFL/NBA/MLB/NHL and other sports; odds products available | Discovery Lab data is real but next-day delayed, so it is unsuitable for live/freshness verification. | Free tier gives last season; paid Discovery Lab provides delayed real data useful for historical/model work. | Discovery Lab tiers document 100–1,000 calls/day depending on tier; commercial program differs. | Discovery Lab is personal/non-commercial and not licensed for commercial redistribution; commercial terms require a commercial license. | Secondary historical/model source unless a commercial live feed is explicitly licensed. |

## Official documentation reviewed

### Sportradar
- API Basics: https://developer.sportradar.com/odds/docs/oc-ig-api-basics
- Odds Comparison v2 Overview: https://developer.sportradar.com/odds/docs/oc-ig-overview
- Player Props Overview: https://developer.sportradar.com/odds/reference/oc-player-props-overview
- Live Sport Event Player Props: https://developer.sportradar.com/odds/reference/oc-live-odds-sport-event-player-props
- October 6, 2026 integration-guide changelog: https://developer.sportradar.com/sportradar-updates/changelog/odds-comparison-v2-probabilities-and-mapping-apis-integration-guides

### Pinnacle
- API access page: https://www.pinnacle.com/en/api

### The Odds API
- V4 documentation: https://the-odds-api.com/liveapi/guides/v4/

### SportsDataIO
- Developers / Discovery Lab: https://sportsdata.io/developers
- Data rights and licensing: https://sportsdata.io/help/data-rights-and-licensing-questions

## Evidence rules for EdgeOdds

1. A provider may be `CONFIGURED` or `RESPONDING` without being `LIVE_VERIFIED`.
2. Retrieval time never substitutes for a missing provider quote-update time.
3. A feed-level generation timestamp is not automatically an outcome-level quote timestamp.
4. Historical/delayed data cannot satisfy live-freshness requirements.
5. Source availability, price freshness, market completeness, settlement equivalence, and model availability are separate gates.
6. Provider coverage claims must be scoped to the package/key/plan actually observed.
7. Licensing/display/redistribution permission must be tracked separately from technical access.
8. Empty or degraded provider results are data unavailability, not evidence of “no +EV opportunities.”

## Recommended source order

1. Sportradar credentialed NFL prematch vertical slice.
2. The Odds API, if already licensed/available, as a timestamp/price comparator during validation.
3. Pinnacle direct API after access approval.
4. SportsDataIO for historical/model validation or later commercial feed if licensed.

No source in this document is currently promoted to `LIVE_VERIFIED` by documentation alone.
