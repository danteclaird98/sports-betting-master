# Repository integration review

All seven sources are pinned in `sources.json`. AppDeploy runtime imports have been replaced. This table describes executed code versus external dependencies; preserving a screen does not verify its provider.

## SportsBettingApp

Revision `2da4740bb889d5d217ecf79e4142b00b39063f2c`. **Integrated core**: Original EdgeOdds and research.py retained; versioned EdgeBoard output can now import into the board.

## EdgeBoard

Revision `04612cba1552a07447059099b8683e51be852385`. **Migrated application**: All src/backend/shared modules plus model tests and receiving60 pipeline copied into apps/edgeboard. Runtime SDK/client replaced; hard-coded report URL migrated to same origin. Original model states preserved.

## edgeboard-appdeploy

Revision `e6d6ae3ac913fb3b6d028849c372008618ab9f35`. **Compared duplicate export**: Compared backend export against EdgeBoard. The EdgeBoard revision includes newer research fixes and corrected receiving artifacts; older duplicate modules not substituted.

## OddsHarvester

Revision `b401809986762f0690d2a976c1d63a6b12e3e60e`. **Integrated export adapter**: Supported home/away, 1X2 and totals JSON import. Real upstream first-quarter fixture tested. Missing provider timestamps remain null; blocked outcomes suspended. Scraper itself is not launched.

## alexbet-sharp-bot

Revision `aa1ba4a2aebcbc699543ec9abcafd8a5138e552b`. **Integrated converter and feed import**: Original odds-conversion module copied unchanged as CJS, validated by gateway and used by hosted calculator. The Odds API responses import directly. Telegram/subscriptions not launched.

## live-odds-tracker

Revision `e6e55acba89e07cad8297a5a2ac4263b30150ba7`. **Integrated movement workflow**: SportsGameOdds native snapshot shape imports; significant source price/line movement detected with timestamp conflict rejection and zero-line support. No outbound webhooks or unattended polling.

## sports-odds-api-python

Revision `e1e244b820f5830530470584c36eab8f8ab575b3`. **Integrated official SDK**: Pinned user-repository commit installed in Docker. On-demand bounded event fetch feeds the SportsGameOdds adapter. Actual SDK model serialization tested; no live provider request verified.

## Scope and rights

The consolidated app does not automatically run upstream Telegram bots, billing systems, webhook notifications or scrapers. Provider-backed EdgeBoard routes still need their keys and plans. AppDeploy data and secrets were not exported. No new license is asserted for user-owned private application code; the copied AlexBET utility has a separate provenance notice, and the imported OddsHarvester test fixture retains its upstream MIT license. The SDK package retains its Apache-2.0 license.
