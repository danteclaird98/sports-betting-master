"""Canonical EdgeOdds domain model.

The contract intentionally separates:
- canonical event/market identity,
- provider-native identifiers,
- provider timestamps,
- retrieval timestamps,
- market status,
- price.

No quote is considered execution-eligible merely because it exists.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from math import isfinite
from typing import Optional


def _require_tz(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")


class MarketType(str, Enum):
    MONEYLINE = "moneyline"
    SPREAD = "spread"
    TOTAL = "total"


class MarketStatus(str, Enum):
    OPEN = "open"
    SUSPENDED = "suspended"
    CLOSED = "closed"
    UNKNOWN = "unknown"


class ConnectorHealth(str, Enum):
    NOT_CONFIGURED = "not_configured"
    CONFIGURED = "configured"
    AUTHENTICATED = "authenticated"
    RESPONDING = "responding"
    SCHEMA_VALID = "schema_valid"
    SOURCE_FRESH = "source_fresh"
    LIVE_VERIFIED = "live_verified"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"
    UNSUPPORTED = "unsupported"


@dataclass(frozen=True)
class CanonicalEvent:
    event_id: str
    sport: str
    league: str
    season: str
    away: str
    home: str
    starts_at: datetime

    def __post_init__(self) -> None:
        for name in ("event_id", "sport", "league", "season", "away", "home"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"{name} is required")
        if self.away.strip().casefold() == self.home.strip().casefold():
            raise ValueError("home and away participants must differ")
        _require_tz(self.starts_at, "starts_at")


@dataclass(frozen=True)
class MarketKey:
    event_id: str
    market_type: MarketType
    selection: str
    line: Optional[float] = None
    period: str = "full_game"
    settlement_rules_hash: str = "unknown"

    def __post_init__(self) -> None:
        if not self.event_id.strip():
            raise ValueError("event_id is required")
        if not self.selection.strip():
            raise ValueError("selection is required")
        if not self.period.strip():
            raise ValueError("period is required")
        if not self.settlement_rules_hash.strip():
            raise ValueError("settlement_rules_hash is required")
        if self.market_type == MarketType.MONEYLINE and self.line is not None:
            raise ValueError("moneyline must not carry a line")
        if self.market_type in {MarketType.SPREAD, MarketType.TOTAL}:
            if self.line is None or not isfinite(float(self.line)):
                raise ValueError("spread/total requires a finite line")


@dataclass(frozen=True)
class NormalizedQuote:
    provider: str
    bookmaker: str
    source_event_id: str
    source_market_id: str
    key: MarketKey
    decimal_price: float
    retrieved_at: datetime
    source_updated_at: Optional[datetime]
    status: MarketStatus
    source_payload_hash: str

    def __post_init__(self) -> None:
        for name in (
            "provider",
            "bookmaker",
            "source_event_id",
            "source_market_id",
            "source_payload_hash",
        ):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"{name} is required")
        if not isfinite(float(self.decimal_price)) or float(self.decimal_price) <= 1.0:
            raise ValueError("decimal_price must be finite and greater than 1")
        _require_tz(self.retrieved_at, "retrieved_at")
        if self.source_updated_at is not None:
            _require_tz(self.source_updated_at, "source_updated_at")


@dataclass(frozen=True)
class FreshnessResult:
    eligible: bool
    reason: str
    age_seconds: Optional[float]


def evaluate_freshness(
    quote: NormalizedQuote,
    *,
    now: datetime,
    max_age_seconds: float,
    future_tolerance_seconds: float = 5.0,
) -> FreshnessResult:
    """Determine whether a normalized quote is fresh enough for downstream analysis.

    A missing provider timestamp is not silently replaced with retrieval time.
    """
    _require_tz(now, "now")
    if not isfinite(float(max_age_seconds)) or max_age_seconds < 0:
        return FreshnessResult(False, "invalid freshness threshold", None)
    if quote.status != MarketStatus.OPEN:
        return FreshnessResult(False, f"market status is {quote.status.value}", None)
    if quote.source_updated_at is None:
        return FreshnessResult(False, "provider source timestamp unavailable", None)

    age = (now - quote.source_updated_at).total_seconds()
    if age < -future_tolerance_seconds:
        return FreshnessResult(False, "provider source timestamp is in the future", age)
    if age > max_age_seconds:
        return FreshnessResult(False, "quote exceeds freshness threshold", age)
    if quote.retrieved_at + timedelta(seconds=future_tolerance_seconds) < quote.source_updated_at:
        return FreshnessResult(False, "retrieval predates provider source timestamp", age)
    return FreshnessResult(True, "fresh open quote", max(age, 0.0))
