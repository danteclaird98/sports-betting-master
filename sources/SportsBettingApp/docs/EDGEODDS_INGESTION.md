# EdgeOdds v0.4 — first read-only ingestion slice

## Status

This extends `edgeodds/` in SportsBettingApp; it is not a replacement deployment
for EdgeBoard Lab. Base inspected: `d564f027b9a9db8e64d67c5ba7e21ec583fbf65d`.
Existing application files, old quote tables, wagers, and forecasting code are
unchanged. No paid account, subscription, hosting deployment, or wager is created.

Implemented and locally tested: Sportradar OC Prematch v2 request client; strict
NFL moneyline/spread/total normalization; raw SHA-256 archive; transactional
snapshots; explicit native-event mapping; bounded read API; EdgeBoard research
view; one-shot CLI. Network source activation and deployed EdgeBoard integration
remain unverified. No real event or live odds were captured during this build.

## Critical timestamp finding

The reviewed Sport Event Markets schema supplies `generated_at` for the feed,
not a guaranteed last-update timestamp for each bookmaker outcome. The event
change log reports that *something* changed; it is not a quote-level clock.
Therefore this connector deliberately sets `source_updated_at` and exported
`observed_at` to null. Feed generation time and retrieval time remain separate.

**SCHEMA_VALID is not SOURCE_FRESH or LIVE_VERIFIED.** Current odds can be shown
as unverified observations, but cannot pass the existing strict EdgeBoard
freshness/EV gate. Activation needs provider-confirmed timestamp semantics or a
separately reviewed observation-based policy with measured latency and clear
labels. Do not fix this by copying `generated_at` into `source_updated_at`.

The previous provider register is a strategy document, not measured access,
coverage, approval, or per-quote timestamp verification. This implementation note
supersedes optimistic assumptions about automatic freshness in that register.

## Scope and identity

The reviewed market IDs are 219 (winner including overtime), 223 (handicap
including overtime), and 225 (total including overtime). Both native ID and
exact supported market name are checked. Half/period, live, props and unsupported
markets are explicitly excluded. Consensus book 25080 is excluded from book
quotes because it is an aggregate, not an independent sportsbook.

`EventBinding` requires: canonical event ID, native event ID, canonical home/away
IDs, native home/away IDs, exact UTC-aware scheduled start, and a public mapping
reference. Names do not establish identity. A changed start, replacement event,
reversed participants, or remapping requires review; it cannot silently merge.
Only NFL is enabled in this slice. Broader all-sport/all-market goals remain.

Bookmaker settlement rules, limits, account-level availability, probability
models, profitability and quote-level source clocks are not invented. They remain
unverified/unavailable even after a successful credentialed response.

## Operation

Requires Python 3.11+ and only the standard library. From the repository root:

```sh
python -m unittest discover -s edgeodds/tests -v
python -m edgeodds status
```

Store an authorized provider key in the **server process environment**, named
`SPORTRADAR_API_KEY`. Do not place it in source, command arguments, issue comments,
chat, frontend variables or a committed environment file. Trial is the default;
production requires `--access production` and the appropriate existing entitlement.
The `--authorized-source` flag records an operator decision; it cannot confer
licensing rights or create an account.

Discover one page of American Football schedules (not automatically NFL-only):

```sh
python -m edgeodds discover --date YYYY-MM-DD --start 0 --authorized-source
```

The result is explicitly one page. Use returned pagination information and
`--start` for the next page; check adjacent UTC dates for Pacific evening events.
Review the competition/event and native participant IDs, then create a private
JSON mapping with the `EventBinding` fields. No real event mapping is bundled.

```sh
python -m edgeodds fetch --mapping /private/path/event-mapping.json --authorized-source
```

This is a bounded, one-event request, not an installed poller. Maximum three
attempts, 12-second request timeout, response-size limit, sanitized errors,
redirect refusal, and bounded Retry-After handling are implemented. Long
Retry-After values stop the request rather than retrying earlier than permitted.
HTTP error bodies are not archived. Known credential echoes are rejected.

Offline replay is always isolated as **fixture**, even when replaying a real
archived response. Supply its actual capture timestamp; replay does not make it
live or grant source verification:

```sh
python -m edgeodds replay --mapping /private/path/event-mapping.json \
  --input /private/path/response.json --at CAPTURE_TIME_WITH_TIMEZONE
```

The default database is `~/.edgeodds/edgeodds.sqlite3`, outside the repository.
New directory/file permissions are private. Existing database permissions are
not silently changed. Respect the provider's retention and data-use agreement.

## Read API

Set a distinct, random, server-side `EDGEODDS_READ_TOKEN` of at least 32 characters.
Then run `python -m edgeodds serve`. It binds **only to 127.0.0.1:8766**. Every
endpoint requires `Authorization: Bearer <token>`; it is not a public hosting
solution. TLS, production identity, rate limiting and deployment controls remain
separate launch gates. The API makes no upstream requests and cannot place bets.

| Route | Result |
|---|---|
| `GET /v1/health` | Configuration, capture counts, last network attempt; never an automatic live-verification claim |
| `GET /v1/sports` | Leagues actually observed in the selected capture mode |
| `GET /v1/events` | Bound events, bounded by `limit` |
| `GET /v1/odds?event_id=...` | One latest complete provider snapshot, not older best-looking prices |
| `GET /v1/history?event_id=...` | Bounded quote history with `before_id` pagination in ingestion order |
| `GET /v1/edgeboard?event_id=...` | Research-shaped view with explicit missing evidence and no unsupported EV |

Default mode is `network`; synthetic data requires explicit `mode=fixture`.
The EdgeBoard view is read-only. `importable=false` remains until required source
time and other evidence exist; no fake timestamp is submitted to the existing
Research Desk quote-import endpoint. Access to the deployed EdgeBoard Lab remains
blocked; it has not been altered or replaced.

## Persistence and failure semantics

New append-only `eo_*` tables preserve raw bytes, bindings, batches, normalized
quotes, repeated observations and attempts. State is keyed independently of
retrieval time; repeated identical payloads do not duplicate quote history.
Each accepted batch commits atomically. SQLite transactions coordinate concurrent
ingestion; evidence tables reject UPDATE/DELETE through triggers. This is not
cryptographic tamper-proof storage against a database administrator.

Latest state is selected by parsed provider generation time. Out-of-order
responses cannot overwrite a newer board. Equal-time conflicting normalized
payloads fail closed. A newer empty board or removed market cannot revive an old
open quote. Failed refreshes retain history and show degraded health, not "no edge".
Feed age defaults to a configurable 300-second engineering threshold, **not a
provider guarantee** and not a substitute for missing quote timestamps.

## Verification and remaining work

63 new local tests passed against the connector-read foundation models on Python
3.13.5. They cover the synthetic three-market path, persistence, concurrent replay,
conflicts, suspension/empty responses, timezones, mapping errors, credential
redaction, retries, HTTP authentication and CLI modes. GitHub CI is the authority
for the full repository suite on Python 3.11–3.13. Synthetic fixtures are explicit;
the tests do not establish actual feed coverage or a profitable strategy.

Next activation gates: authorized Sportradar access; one real event reconciled
against an official schedule and provider response; provider timestamp-policy
review; sportsbook settlement-rule provenance; access to the existing EdgeBoard
runtime; deployment/authentication review. Then expand through additional sources,
leagues, complete-market comparison, no-vig benchmarks and audited closing lines.
No scheduler or ongoing monitoring has been installed by this change.

## Official references reviewed

- https://developer.sportradar.com/odds/docs/oc-ig-api-basics
- https://developer.sportradar.com/odds/reference/oc-prematch-overview
- https://developer.sportradar.com/odds/reference/oc-prematch-sport-event-markets
- https://developer.sportradar.com/odds/docs/oc-ig-fundamentals
- https://developer.sportradar.com/odds/docs/oc-ig-monitoring-odds-changes
- https://developer.sportradar.com/odds/docs/oc-ig-update-frequencies
- https://developer.sportradar.com/odds/reference/oc-prematch-daily-schedules
