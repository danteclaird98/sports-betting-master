"""Provider boundary for EdgeOdds.

Concrete adapters must normalize provider-native data into NormalizedQuote
without inventing missing timestamps, market rules, prices, or identities.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Protocol, Sequence

from .models import ConnectorHealth, MarketType, NormalizedQuote


@dataclass(frozen=True)
class FetchRequest:
    league: str
    market_types: Sequence[MarketType]
    event_ids: Sequence[str] = ()
    include_live: bool = False


@dataclass(frozen=True)
class ConnectorStatus:
    provider: str
    health: ConnectorHealth
    detail: str
    last_success_at: str | None = None


class ProviderAdapter(Protocol):
    name: str

    def status(self) -> ConnectorStatus:
        """Return evidence-backed connector health."""

    def fetch_quotes(self, request: FetchRequest) -> Iterable[NormalizedQuote]:
        """Fetch and normalize quotes for the requested scope."""
