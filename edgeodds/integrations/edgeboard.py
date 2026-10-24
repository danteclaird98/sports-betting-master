"""Stable provider-independent compatibility contract for EdgeBoard."""
from __future__ import annotations

from copy import deepcopy


SCHEMA = "edgeodds.edgeboard.v1"


class EdgeBoardContractError(ValueError):
    pass


def _reasons(values) -> list[str]:
    result: list[str] = []
    if values is None:
        return result
    if not isinstance(values, list):
        raise EdgeBoardContractError("reasons must be a list")
    for value in values:
        if not isinstance(value, str) or not value:
            raise EdgeBoardContractError("reason must be nonempty text")
        if value not in result:
            result.append(value)
    return result


def _quote(row: dict, board: dict) -> dict:
    if not isinstance(row, dict):
        raise EdgeBoardContractError("quote must be an object")
    rules_verified = row.get("rules_verified") is True
    analysis_eligible = row.get("analysis_eligible") is True
    price_fresh = row.get("price_fresh") is True
    reasons = _reasons(row.get("exclusion_reasons", []))

    return {
        "market": {
            "family": row.get("market"),
            "selection": row.get("selection"),
            "line": row.get("line"),
            "period": row.get("period"),
            "settlement_rules": {
                "id": row.get("rules"),
                "verified": rules_verified,
            },
        },
        "book": row.get("sportsbook"),
        "price": {
            "decimal": row.get("decimal_odds"),
            "status": row.get("status"),
            "fresh": price_fresh,
        },
        "timestamps": {
            "quote_updated_at": row.get("source_updated_at"),
            "feed_snapshot_at": row.get("source_snapshot_at"),
            "retrieved_at": row.get("retrieved_at"),
        },
        "source": {
            "provider": row.get("provider"),
            "event_id": row.get("provider_event_id"),
            "market_id": row.get("source_market_id"),
            "raw_sha256": row.get("raw_sha256"),
            "ref": row.get("source_ref"),
        },
        "analysis": {
            "eligible": analysis_eligible,
            "qualification": row.get("qualification") or "unevaluable",
            "market_probability": row.get("market_probability"),
            "model_probability": row.get("model_probability", board.get("model_probability")),
            "ev_per_unit": row.get("ev_per_unit"),
            "uncertainty": row.get("uncertainty"),
            "clv": row.get("clv"),
            "exclusion_reasons": reasons,
        },
    }


def edgeboard_contract(board: dict) -> dict:
    """Return a versioned read-only EdgeBoard contract without mutating input."""
    if not isinstance(board, dict):
        raise EdgeBoardContractError("board must be an object")
    rows = board.get("quotes", [])
    if not isinstance(rows, list):
        raise EdgeBoardContractError("quotes must be a list")
    snapshot = deepcopy(board)
    event = snapshot.get("event")
    if event is None:
        event = {}
    if not isinstance(event, dict):
        raise EdgeBoardContractError("event must be an object")

    return {
        "schema": SCHEMA,
        "read_only": True,
        "execution": "DISABLED",
        "checked_at": snapshot.get("checked_at"),
        "mode": snapshot.get("mode"),
        "data_status": snapshot.get("data_status"),
        "live_verified": snapshot.get("live_verified") is True,
        "event": {
            "event_id": snapshot.get("event_id"),
            "sport": event.get("sport"),
            "league": event.get("league"),
            "starts_at": event.get("starts_at"),
        },
        "model": {
            "status": snapshot.get("model_status") or "MODEL_UNAVAILABLE",
            "probability": snapshot.get("model_probability"),
            "ev_per_unit": snapshot.get("ev_per_unit"),
        },
        "quotes": [_quote(row, snapshot) for row in rows],
        "reasons": _reasons(snapshot.get("reasons", [])),
        "empty_response_is_not_no_edge": snapshot.get("empty_response_is_not_no_edge") is True,
    }
