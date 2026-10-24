"""Conservative, source-agnostic primitives for sports-betting research."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from math import isfinite
from typing import Iterable, Mapping, Sequence
import re


def _finite_number(value: float, name: str) -> float:
    value = float(value)
    if not isfinite(value):
        raise ValueError(f"{name} must be finite")
    return value


def american_to_decimal(odds: int | float) -> float:
    odds = _finite_number(odds, "American odds")
    if odds == 0:
        raise ValueError("American odds cannot be zero")
    return 1.0 + odds / 100.0 if odds > 0 else 1.0 + 100.0 / abs(odds)


def decimal_to_american(decimal_odds: int | float) -> float:
    d = _finite_number(decimal_odds, "decimal odds")
    if d <= 1:
        raise ValueError("decimal odds must exceed 1")
    return (d - 1.0) * 100.0 if d >= 2 else -100.0 / (d - 1.0)


def implied_probability(odds: int | float, format: str = "american") -> float:
    if format == "american":
        return 1.0 / american_to_decimal(odds)
    if format == "decimal":
        d = _finite_number(odds, "decimal odds")
        if d <= 1:
            raise ValueError("decimal odds must exceed 1")
        return 1.0 / d
    raise ValueError("format must be 'american' or 'decimal'")


def proportional_no_vig(odds: Sequence[int | float], format: str = "american") -> list[float]:
    """Normalize a complete and exactly matched market; benchmark only."""
    if len(odds) < 2:
        raise ValueError("at least two complete market outcomes are required")
    raw = [implied_probability(x, format) for x in odds]
    total = sum(raw)
    if total <= 0:
        raise ValueError("market implied-probability total must be positive")
    return [p / total for p in raw]


@dataclass(frozen=True)
class Outcome:
    name: str
    probability: float
    net_per_unit: float

    def __post_init__(self) -> None:
        p = _finite_number(self.probability, "outcome probability")
        r = _finite_number(self.net_per_unit, "net return")
        if not 0 <= p <= 1:
            raise ValueError("outcome probability must be between 0 and 1")
        object.__setattr__(self, "probability", p)
        object.__setattr__(self, "net_per_unit", r)


def net_win_per_unit(decimal_odds: float, *, dead_heat_fraction: float = 1.0,
                     commission_on_profit: float = 0.0) -> float:
    d = _finite_number(decimal_odds, "decimal odds")
    f = _finite_number(dead_heat_fraction, "dead-heat fraction")
    c = _finite_number(commission_on_profit, "commission")
    if d <= 1 or not 0 <= f <= 1 or not 0 <= c < 1:
        raise ValueError("invalid odds, dead-heat fraction, or commission")
    gross_profit = f * (d - 1.0)
    returned_stake = f
    return gross_profit * (1.0 - c) - (1.0 - returned_stake)


@dataclass(frozen=True)
class EVResult:
    ev_per_unit: float
    break_even_probability: float
    low_ev: float | None
    high_ev: float | None
    probability_source: str
    outcome_count: int


def estimate_ev(outcomes: Sequence[Outcome], *, probability_source: str,
                probability_bounds: Mapping[str, tuple[float, float]] | None = None) -> EVResult:
    """Compute EV from supplied, exhaustive outcome probabilities; never infer them."""
    if not outcomes:
        raise ValueError("at least one outcome is required")
    if len({o.name for o in outcomes}) != len(outcomes):
        raise ValueError("outcome names must be unique")
    p_total = sum(o.probability for o in outcomes)
    if abs(p_total - 1.0) > 1e-8:
        raise ValueError("outcome probabilities must sum to 1")
    ev = sum(o.probability * o.net_per_unit for o in outcomes)
    wins = [o for o in outcomes if o.net_per_unit > 0]
    losses = [o for o in outcomes if o.net_per_unit < 0]
    # Break-even probability is only unambiguous for a binary win/loss wager.
    bep = float("nan")
    if len(outcomes) == 2 and len(wins) == 1 and len(losses) == 1:
        win_return = wins[0].net_per_unit
        lose_return = losses[0].net_per_unit
        bep = -lose_return / (win_return - lose_return)
    low_ev = high_ev = None
    if probability_bounds is not None:
        if set(probability_bounds) != {o.name for o in outcomes}:
            raise ValueError("bounds must be supplied for every outcome")
        lows, highs = [], []
        for o in outcomes:
            lo, hi = probability_bounds[o.name]
            lo, hi = _finite_number(lo, "lower probability bound"), _finite_number(hi, "upper probability bound")
            if not 0 <= lo <= hi <= 1:
                raise ValueError("probability bounds must satisfy 0 <= low <= high <= 1")
            if not lo <= o.probability <= hi:
                raise ValueError("point probability must lie inside its bounds")
            lows.append((lo, hi))
        # For a coherent probability vector, solve the linear extrema by
        # allocating residual probability to returns in ascending/descending order.
        low_ev = _bound_extreme(outcomes, lows, maximize=False)
        high_ev = _bound_extreme(outcomes, lows, maximize=True)
    return EVResult(ev, bep, low_ev, high_ev, probability_source, len(outcomes))


def _bound_extreme(outcomes: Sequence[Outcome], bounds: Sequence[tuple[float, float]], *, maximize: bool) -> float:
    ps = [lo for lo, _ in bounds]
    residual = 1.0 - sum(ps)
    if residual < -1e-8 or residual > sum(hi - lo for lo, hi in bounds) + 1e-8:
        raise ValueError("probability bounds do not contain a coherent probability vector")
    order = sorted(range(len(outcomes)), key=lambda i: outcomes[i].net_per_unit, reverse=maximize)
    for i in order:
        add = min(max(residual, 0.0), bounds[i][1] - bounds[i][0])
        ps[i] += add
        residual -= add
    if residual > 1e-7:
        raise ValueError("probability bounds cannot sum to one")
    return sum(p * o.net_per_unit for p, o in zip(ps, outcomes))


def normalize_identity(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


@dataclass(frozen=True)
class WagerKey:
    event_id: str
    market_type: str
    selection: str
    line: str | None
    segment: str
    settlement_rules: str

    def canonical(self) -> tuple[str, ...]:
        return tuple(normalize_identity(x or "") for x in (
            self.event_id, self.market_type, self.selection, self.line,
            self.segment, self.settlement_rules,
        ))


def exact_wager_match(left: WagerKey, right: WagerKey) -> bool:
    return left.canonical() == right.canonical()


class MarketStatus(str, Enum):
    OPEN = "open"
    SUSPENDED = "suspended"
    CLOSED = "closed"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Quote:
    source: str
    sportsbook: str
    retrieved_at: datetime
    odds_timestamp: datetime | None
    event_time: datetime | None
    status: MarketStatus
    key: WagerKey
    odds: float
    odds_format: str
    latency_seconds: float | None = None


@dataclass(frozen=True)
class FreshnessDecision:
    eligible: bool
    reason: str
    effective_age_seconds: float | None


def check_quote_freshness(quote: Quote, *, now: datetime, max_age_seconds: float,
                          max_latency_seconds: float | None = None) -> FreshnessDecision:
    if quote.status != MarketStatus.OPEN:
        return FreshnessDecision(False, f"market status is {quote.status.value}", None)
    if not isfinite(max_age_seconds) or max_age_seconds < 0:
        return FreshnessDecision(False, "invalid freshness threshold", None)
    if quote.odds_timestamp is None:
        return FreshnessDecision(False, "odds timestamp unavailable", None)
    for dt in (now, quote.retrieved_at, quote.odds_timestamp):
        if dt.tzinfo is None:
            return FreshnessDecision(False, "timestamps must include timezone", None)
    age = (now - quote.odds_timestamp).total_seconds()
    if (quote.retrieved_at - now).total_seconds() > 5:
        return FreshnessDecision(False, "retrieval timestamp is in the future", age)
    if quote.latency_seconds is not None and (not isfinite(quote.latency_seconds) or quote.latency_seconds < 0):
        return FreshnessDecision(False, "invalid measured latency", age)
    if age < -5:
        return FreshnessDecision(False, "odds timestamp is in the future", age)
    if age > max_age_seconds:
        return FreshnessDecision(False, "odds exceed freshness threshold", age)
    if quote.retrieved_at < quote.odds_timestamp and (quote.odds_timestamp - quote.retrieved_at).total_seconds() > 5:
        return FreshnessDecision(False, "retrieval predates odds timestamp; clock/order mismatch", age)
    if max_latency_seconds is not None:
        if quote.latency_seconds is None:
            return FreshnessDecision(False, "latency unavailable", age)
        if quote.latency_seconds > max_latency_seconds:
            return FreshnessDecision(False, "feed latency exceeds threshold", age)
    return FreshnessDecision(True, "fresh open quote", age)


class Verification(str, Enum):
    UNVERIFIED = "unverified"
    CONFIGURED = "configured"
    LOCALLY_TESTED = "locally_tested"
    LIVE_VERIFIED = "live_verified"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class CoverageEntry:
    sport: str
    league: str
    provider: str
    sportsbook: str
    market: str
    temporal_scope: str  # historical, pregame, live
    status: Verification = Verification.UNVERIFIED
    limitations: tuple[str, ...] = field(default_factory=tuple)


class CoverageRegistry:
    """Coverage claims are data-backed; no implicit operational support."""
    def __init__(self, entries: Iterable[CoverageEntry] = ()):
        self._entries = list(entries)

    def add(self, entry: CoverageEntry) -> None:
        if entry.temporal_scope not in {"historical", "pregame", "live"}:
            raise ValueError("temporal_scope must be historical, pregame, or live")
        self._entries.append(entry)

    def entries(self) -> tuple[CoverageEntry, ...]:
        return tuple(self._entries)

    def operational(self) -> tuple[CoverageEntry, ...]:
        return tuple(e for e in self._entries if e.status == Verification.LIVE_VERIFIED)
