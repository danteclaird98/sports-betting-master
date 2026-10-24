"""Strict identity resolution for EdgeOdds.

Identity resolution is deterministic and provenance-backed:
- aliases are explicit records, never fuzzy guesses;
- provider scope may be enforced;
- ambiguous aliases stay ambiguous;
- event matching requires canonical participant IDs plus time proximity.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable
import re
import unicodedata


class IdentityError(ValueError):
    pass


class UnresolvedIdentity(IdentityError):
    pass


class AmbiguousIdentity(IdentityError):
    pass


def normalize_alias(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"\s+", " ", value).strip().casefold()
    if not value:
        raise ValueError("alias cannot be blank")
    return value


@dataclass(frozen=True)
class AliasRecord:
    alias: str
    canonical_id: str
    provider: str
    source_ref: str
    valid_from: datetime | None = None
    valid_to: datetime | None = None

    def __post_init__(self) -> None:
        if not self.canonical_id.strip():
            raise ValueError("canonical_id is required")
        if not self.provider.strip():
            raise ValueError("provider is required")
        if not self.source_ref.strip():
            raise ValueError("source_ref is required")
        normalize_alias(self.alias)
        for name in ("valid_from", "valid_to"):
            dt = getattr(self, name)
            if dt is not None and (dt.tzinfo is None or dt.utcoffset() is None):
                raise ValueError(f"{name} must be timezone-aware")
        if self.valid_from and self.valid_to and self.valid_from >= self.valid_to:
            raise ValueError("valid_from must precede valid_to")

    def active_at(self, at: datetime | None) -> bool:
        if at is None:
            return True
        if at.tzinfo is None or at.utcoffset() is None:
            raise ValueError("at must be timezone-aware")
        if self.valid_from and at < self.valid_from:
            return False
        if self.valid_to and at >= self.valid_to:
            return False
        return True


class AliasRegistry:
    def __init__(self, records: Iterable[AliasRecord] = ()) -> None:
        self._records = list(records)

    def add(self, record: AliasRecord) -> None:
        self._records.append(record)

    def resolve(self, alias: str, *, provider: str | None = None, at: datetime | None = None) -> AliasRecord:
        key = normalize_alias(alias)
        matches = [
            r for r in self._records
            if normalize_alias(r.alias) == key
            and (provider is None or r.provider.casefold() == provider.casefold())
            and r.active_at(at)
        ]
        ids = {r.canonical_id for r in matches}
        if not matches:
            raise UnresolvedIdentity(f"no explicit alias mapping for {alias!r}")
        if len(ids) != 1:
            raise AmbiguousIdentity(f"alias {alias!r} maps to multiple canonical IDs")
        # Keep the actual provenance record; if several identical mappings exist,
        # the most recently added active record wins.
        return matches[-1]


@dataclass(frozen=True)
class ProviderEvent:
    provider: str
    source_event_id: str
    league: str
    away_alias: str
    home_alias: str
    starts_at: datetime
    venue_id: str | None = None
    neutral_site: bool | None = None

    def __post_init__(self) -> None:
        for name in ("provider", "source_event_id", "league", "away_alias", "home_alias"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"{name} is required")
        if self.starts_at.tzinfo is None or self.starts_at.utcoffset() is None:
            raise ValueError("starts_at must be timezone-aware")
        if self.venue_id is not None and not self.venue_id.strip():
            raise ValueError("venue_id cannot be blank")
        if self.neutral_site is not None and type(self.neutral_site) is not bool:
            raise ValueError("neutral_site must be boolean or None")


@dataclass(frozen=True)
class CanonicalEventRef:
    event_id: str
    league: str
    away_id: str
    home_id: str
    starts_at: datetime
    venue_id: str | None = None
    neutral_site: bool | None = None

    def __post_init__(self) -> None:
        for name in ("event_id", "league", "away_id", "home_id"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"{name} is required")
        if self.starts_at.tzinfo is None or self.starts_at.utcoffset() is None:
            raise ValueError("starts_at must be timezone-aware")
        if self.venue_id is not None and not self.venue_id.strip():
            raise ValueError("venue_id cannot be blank")
        if self.neutral_site is not None and type(self.neutral_site) is not bool:
            raise ValueError("neutral_site must be boolean or None")


@dataclass(frozen=True)
class EventMatch:
    event: CanonicalEventRef
    away_alias_record: AliasRecord
    home_alias_record: AliasRecord
    start_delta_seconds: float


class EventResolver:
    def __init__(self, aliases: AliasRegistry, events: Iterable[CanonicalEventRef] = ()) -> None:
        self.aliases = aliases
        self._events = list(events)

    def add_event(self, event: CanonicalEventRef) -> None:
        self._events.append(event)

    def resolve(self, source: ProviderEvent, *, tolerance: timedelta = timedelta(minutes=20)) -> EventMatch:
        if tolerance.total_seconds() < 0:
            raise ValueError("tolerance must be non-negative")
        away = self.aliases.resolve(source.away_alias, provider=source.provider, at=source.starts_at)
        home = self.aliases.resolve(source.home_alias, provider=source.provider, at=source.starts_at)
        candidates: list[tuple[CanonicalEventRef, float]] = []
        for event in self._events:
            if event.league.casefold() != source.league.casefold():
                continue
            if event.away_id != away.canonical_id or event.home_id != home.canonical_id:
                continue
            if source.venue_id is not None and event.venue_id != source.venue_id:
                continue
            if source.neutral_site is not None and event.neutral_site != source.neutral_site:
                continue
            delta = abs((event.starts_at - source.starts_at).total_seconds())
            if delta <= tolerance.total_seconds():
                candidates.append((event, delta))
        if not candidates:
            raise UnresolvedIdentity(
                f"no canonical event for provider event {source.provider}:{source.source_event_id}"
            )
        candidates.sort(key=lambda x: x[1])
        best_delta = candidates[0][1]
        equally_best = [c for c in candidates if c[1] == best_delta]
        if len(equally_best) != 1:
            raise AmbiguousIdentity(
                f"multiple canonical events equally match {source.provider}:{source.source_event_id}"
            )
        # Even a unique closest match is unsafe when multiple games fit the configured
        # tolerance and are not separated enough to prove the intended instance.
        if len(candidates) > 1:
            raise AmbiguousIdentity(
                f"multiple canonical events fall within tolerance for {source.provider}:{source.source_event_id}"
            )
        event, delta = candidates[0]
        return EventMatch(event, away, home, delta)
