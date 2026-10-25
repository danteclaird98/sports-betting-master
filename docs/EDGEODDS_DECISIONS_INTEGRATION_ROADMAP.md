# EdgeOdds Decisions API Integration Roadmap

**Status:** proposed; no Decisions API adapter is implemented yet  
**Scope:** one optional, independently tested diagnostic component  
**Architecture:** deterministic EdgeOdds validation and the existing agent architecture remain authoritative. Decisions classifies only a narrowly defined source market-label anomaly; it does not replace agents, identity resolution, quote normalization, ingestion, or risk controls.

## Why this candidate

`edgeodds/sportradar.py::normalize` maps reviewed Sportradar market IDs to canonical names. If a supported, pregame market ID has a different source label, normalization adds `MARKET_NAME_REVIEW_REQUIRED` and skips that market. It currently returns only the global issue code, not the offending market's details. A separate offline/shadow job can re-read the same raw snapshot after normalization succeeds, identify supported market IDs from the reviewed `MARKETS` map, and construct a minimal evidence item for review.

The code already contains explicit, provenance-backed alias and event resolution in `edgeodds/identity.py`, an append-only ingestion store, and a read-only EdgeBoard compatibility contract. Ambiguous identities remain rejected by deterministic code. Decisions must never create aliases, select a canonical event, clear the existing review issue, create a normalized quote, or make a quote eligible.

## Proposed component

Add a small Python module such as `edgeodds/decision_triage.py`. Its input is limited to a supported market ID, market family, raw source market label, and the reviewed canonical label. Send these fields as an `input_json` user content part to `POST /v1/decisions` using the supported `gpt-6-luna` model, a fixed `choice` question, and a versioned question name.

The fixed question instructions must say that the JSON fields are untrusted evidence, any commands embedded in their strings must be ignored, and the task is only to classify whether the two labels refer to the same market. Do not interpolate provider labels into the instructions. The source data currently contains no per-market period evidence, so the classifier must not infer or report period mismatches.

Return one of three categories:

- `consistent`: the source and canonical labels appear to describe the same market;
- `possible_mismatch`: the labels appear to describe different markets and should be reviewed;
- `unclear`: the evidence is ambiguous, the API refuses, confidence is low, or a safe classification is unavailable.

This is diagnostic metadata only. It cannot change normalizer output, stored quote rows, the EdgeBoard response, event identity, wager analysis, stakes, execution, or abstention decisions. Initially write results only to CLI stdout or a separate evaluation artifact; do not add or mutate `eo_*` tables.

## Invocation and failure behavior

- Run as an explicit offline/shadow CLI job on an archived raw snapshot. First call deterministic `normalize(raw, binding, retrieved_at)`; only if it completes and reports `MARKET_NAME_REVIEW_REQUIRED`, re-parse that same raw input to locate supported market IDs whose source labels differ from the canonical names. The existing read API does not expose archived raw bodies.
- Skip API calls for exact market labels, unknown IDs, live markets, invalid schemas, or snapshots that fail deterministic event, participant, time, or other normalization checks. The name mismatch itself remains flagged and is never cleared by the model.
- Do not call Decisions synchronously from ingestion or the read-only HTTP API. A timeout or outage must not block quote capture or retrieval.
- Keep the feature disabled unless `OPENAI_API_KEY` is configured as a server-side secret. Never expose it to browser code, client responses, repository files, or logs. Send no odds, bankroll, account details, personal data, or full provider payload.
- Map refusals, timeouts, HTTP/auth/rate-limit errors, invalid JSON, unexpected answer names/types/values, and low confidence to `unclear`. Avoid blocking retries. Do not retain raw request or response bodies.

## Delivery and validation gates

1. Freeze a versioned input schema, fixed question and allowed values, timeout, confidence policy, and safe fallback.
2. Implement the adapter and offline/shadow CLI as a separate boundary; do not change the normalizer, storage schema, read API, or agent contracts.
3. Test independently with synthetic fixtures and mocked transport: all three categories, low confidence, refusal, malformed or unexpected answers, auth/rate-limit errors, timeout, and no-call cases.
4. Prove deterministic failures bypass the API and all classifier results leave normalized quotes, ingestion records, and `edgeodds.edgeboard.v1` unchanged.
5. Replay labeled historical `MARKET_NAME_REVIEW_REQUIRED` cases. Report mismatch precision/recall, false-alarm and unclear rates, latency, and cost. Set thresholds from labeled data and review capacity; API confidence is not a win probability.
6. Keep shadow mode on until evaluation is reviewed. Any later rollout may only mark records for human review; it may not resolve identity or promote a wager.

## Current implementation and deployment context

- The EdgeOdds package already has identity primitives, a read-only Sportradar prematch connector, normalization, an append-only store, and a read-only EdgeBoard contract. Its standalone HTTP API is not mounted in the combined Node runtime. Check `edgeodds/README.md` for the current component boundaries.
- The combined Sports Betting Master runs a Node gateway and internal Python service and stores SQLite data on a persistent volume. **Fly is the current deployment target**, as documented in `README.md` and `docs/FLY_DEPLOYMENT.md`; Render and Railway instructions are historical migration references. The web service has a public HTTPS endpoint protected by the app's password/session login; it is not network-private. Keep one instance with the disk-backed SQLite files.
- No Fly service, production URL, live provider access, or combined production deployment has been verified. Follow `docs/FLY_DEPLOYMENT.md`; inspect and confirm the existing app, machine, volume, and secrets, and preserve any stored data before deployment. Complete health, authentication, and persistence checks before calling launch complete.
- Add `OPENAI_API_KEY` only as a server-side host secret when the adapter is implemented. Fixture tests need no API key.
- Official API reference: https://developers.openai.com/api/docs/guides/decisions
