# EdgeOdds Decisions API Integration Roadmap

**Status:** proposed for the combined Sports Betting Master repository  
**Scope:** one small, optional, independently tested diagnostic component  
**Architecture:** the existing EdgeOdds contracts and orchestration remain authoritative. The Decisions API adds a sidecar classification for ambiguous source market labels; it does not replace agents, identity resolution, quote normalization, or risk controls.

## Why this is the first candidate

The EdgeOdds normalizer already maps reviewed provider market IDs to canonical market names. When a known market ID arrives with a different source label, it emits `MARKET_NAME_REVIEW_REQUIRED` and excludes that market from normalized quotes. That is a narrow, observable ambiguity where a fixed-choice classifier could help prioritize human review.

Exact identity and data rules must stay deterministic. The existing alias and event resolver requires explicit, provenance-backed mappings and rejects ambiguity. Decisions must never create aliases, select a canonical event, clear a review issue, create a normalized quote, or make a quote eligible.

## Proposed component

Add an isolated Python module such as `edgeodds/decision_triage.py`. It accepts only a mismatch emitted by a successful deterministic normalization pass: native market ID, market family, raw source label, and the reviewed canonical label. It sends a fixed `choice` question to `POST /v1/decisions` and returns one of:

- `consistent`: labels appear to describe the same market;
- `possible_mismatch`: labels may indicate a different market or period and need human review;
- `unclear`: evidence is ambiguous, the API refuses, or a safe classification is unavailable.

Treat provider-supplied labels as untrusted data in the question instructions. Send no odds, bankroll, account details, personal data, or full provider payload. Do not retain or log raw API request/response bodies.

The result is diagnostic metadata only. It cannot alter the normalizer output, stored quote rows, EdgeBoard compatibility response, or any wager, stake, execution, or abstention decision.

## Invocation and failure behavior

- Run this as an explicit offline or shadow CLI job after normalizing an archived snapshot. Do not call the API synchronously from ingestion or the read-only HTTP API.
- Skip the API call for exact supported market labels, unknown/live markets, and any snapshot that fails deterministic event, participant, time, market, or schema checks.
- Keep the feature disabled unless `OPENAI_API_KEY` is set server-side. Never expose the key to browser code, client responses, repository files, or logs.
- Map refusals, timeouts, HTTP/auth/rate-limit errors, invalid JSON, unexpected answer names/types/values, and low confidence to `unclear`. Do not retry in a way that blocks ingestion.
- Record only bounded result fields needed for offline evaluation: market ID, classification, confidence when valid, model/question version, and fixed failure code.

## Delivery and validation gates

1. Freeze a versioned input schema, fixed question and choices, confidence policy, timeout, and safe fallback.
2. Implement the standalone adapter and shadow/CLI entry point without changing the normalization, storage, read API, or agent contracts.
3. Add fixture-based unit tests with mocked transport for all three classes, low confidence, refusals, malformed and unexpected answers, auth/rate limits, timeouts, and no-call cases.
4. Assert that deterministic failures bypass the API and that every result leaves normalized quotes, ingestion records, and `edgeodds.edgeboard.v1` unchanged.
5. Replay labeled historical market-name mismatches. Report precision/recall for mismatch flags, false-alarm rate, unclear rate, latency, and cost. Set any confidence threshold from labeled data and review capacity; never interpret confidence as win probability.
6. Keep shadow mode on until the evaluation is reviewed. A later advisory rollout may only mark records for human review; it must not resolve identity or promote a wager.

## Current prerequisites and hosting

- The current EdgeOdds package is a foundation: its README lists live sportsbook adapters, event/entity matching, EdgeBoard routes, and deployment as unfinished. Build the existing deterministic pipeline before broadening the classifier.
- The top-level combined application runs a Node gateway and an internal Python service, with SQLite data expected on persistent storage. For a private production deployment, follow the repository's Render Blueprint and [Render migration guide](./RENDER_MIGRATION.md); do not deploy this Docker-plus-SQLite app to an ephemeral or multi-replica host.
- Add `OPENAI_API_KEY` only as a server-side hosting secret if and when the adapter is implemented. No provider key is required for offline fixture tests.
- Official API reference: https://developers.openai.com/api/docs/guides/decisions
