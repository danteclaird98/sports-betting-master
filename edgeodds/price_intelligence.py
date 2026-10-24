"""Deterministic price-intelligence primitives for normalized EdgeOdds quotes."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from typing import Iterable, Sequence

from .models import MarketStatus, MarketType, NormalizedQuote


class PriceIntelligenceError(ValueError):
    pass


def market_signature(quote: NormalizedQuote) -> tuple:
    """Provider-independent exact market boundary, excluding selection."""
    key = quote.key
    if key.market_type == MarketType.SPREAD:
        boundary = abs(float(key.line))
    else:
        boundary = key.line
    return (
        key.event_id,
        key.market_type.value,
        boundary,
        key.period,
        key.settlement_rules_hash,
    )


def exact_selection_signature(quote: NormalizedQuote) -> tuple:
    return market_signature(quote) + (quote.key.selection, quote.key.line)


def best_price(quotes: Iterable[NormalizedQuote]) -> NormalizedQuote:
    rows = [q for q in quotes if q.status == MarketStatus.OPEN]
    if not rows:
        raise PriceIntelligenceError("no open quotes")
    sig = exact_selection_signature(rows[0])
    if any(exact_selection_signature(q) != sig for q in rows):
        raise PriceIntelligenceError("quotes do not represent one exact selection")
    # Deterministic tie-break; a tie is not treated as additional evidence.
    return sorted(
        rows,
        key=lambda q: (-q.decimal_price, q.bookmaker.casefold(), q.provider.casefold(), q.source_market_id),
    )[0]


def complete_two_way_market(quotes: Sequence[NormalizedQuote]) -> tuple[NormalizedQuote, NormalizedQuote]:
    rows = list(quotes)
    if len(rows) != 2:
        raise PriceIntelligenceError("complete two-way market requires exactly two outcomes")
    if any(q.status != MarketStatus.OPEN for q in rows):
        raise PriceIntelligenceError("two-way market contains non-open outcome")
    if rows[0].provider != rows[1].provider or rows[0].bookmaker != rows[1].bookmaker:
        raise PriceIntelligenceError("two-way market must come from one provider/bookmaker")
    if market_signature(rows[0]) != market_signature(rows[1]):
        raise PriceIntelligenceError("outcomes are not the same exact market")
    if rows[0].key.selection.casefold() == rows[1].key.selection.casefold():
        raise PriceIntelligenceError("two-way market requires distinct selections")
    if rows[0].key.market_type == MarketType.SPREAD:
        if rows[0].key.line != -rows[1].key.line:
            raise PriceIntelligenceError("spread outcomes must have opposing exact lines")
    if rows[0].key.market_type == MarketType.TOTAL:
        if rows[0].key.line != rows[1].key.line:
            raise PriceIntelligenceError("total outcomes must share exact threshold")
    return rows[0], rows[1]


def proportional_no_vig(quotes: Sequence[NormalizedQuote]) -> dict[str, float]:
    left, right = complete_two_way_market(quotes)
    raw = [1.0 / left.decimal_price, 1.0 / right.decimal_price]
    total = sum(raw)
    if not isfinite(total) or total <= 0:
        raise PriceIntelligenceError("invalid implied probability total")
    return {
        left.key.selection: raw[0] / total,
        right.key.selection: raw[1] / total,
    }


@dataclass(frozen=True)
class PriceMovement:
    first_price: float
    last_price: float
    first_at: datetime
    last_at: datetime
    decimal_ratio_minus_one: float


def price_movement(quotes: Sequence[NormalizedQuote]) -> PriceMovement:
    rows = list(quotes)
    if len(rows) < 2:
        raise PriceIntelligenceError("price movement requires at least two quotes")
    sig = exact_selection_signature(rows[0])
    provider_book = (rows[0].provider, rows[0].bookmaker)
    if any(exact_selection_signature(q) != sig for q in rows):
        raise PriceIntelligenceError("movement quotes are not exact-selection equivalent")
    if any((q.provider, q.bookmaker) != provider_book for q in rows):
        raise PriceIntelligenceError("movement must use one provider/bookmaker")
    if any(q.source_updated_at is None for q in rows):
        raise PriceIntelligenceError("provider quote timestamp unavailable")
    ordered = sorted(rows, key=lambda q: q.source_updated_at)
    first, last = ordered[0], ordered[-1]
    if first.source_updated_at == last.source_updated_at and first.decimal_price != last.decimal_price:
        raise PriceIntelligenceError("conflicting prices at identical provider time")
    return PriceMovement(
        first.decimal_price,
        last.decimal_price,
        first.source_updated_at,
        last.source_updated_at,
        last.decimal_price / first.decimal_price - 1.0,
    )


def closing_quote(quotes: Sequence[NormalizedQuote], *, start_at: datetime) -> NormalizedQuote:
    if start_at.tzinfo is None or start_at.utcoffset() is None:
        raise PriceIntelligenceError("start_at must be timezone-aware")
    rows = [q for q in quotes if q.status == MarketStatus.OPEN and q.source_updated_at is not None]
    if not rows:
        raise PriceIntelligenceError("no timestamped open closing candidates")
    sig = exact_selection_signature(rows[0])
    provider_book = (rows[0].provider, rows[0].bookmaker)
    if any(exact_selection_signature(q) != sig for q in rows):
        raise PriceIntelligenceError("closing candidates are not exact-selection equivalent")
    if any((q.provider, q.bookmaker) != provider_book for q in rows):
        raise PriceIntelligenceError("closing quote must use one provider/bookmaker")
    eligible = [q for q in rows if q.source_updated_at <= start_at]
    if not eligible:
        raise PriceIntelligenceError("no verified pre-start quote")
    latest_at = max(q.source_updated_at for q in eligible)
    latest = [q for q in eligible if q.source_updated_at == latest_at]
    prices = {q.decimal_price for q in latest}
    if len(prices) != 1:
        raise PriceIntelligenceError("conflicting closing prices at identical provider time")
    return sorted(latest, key=lambda q: q.source_market_id)[0]
