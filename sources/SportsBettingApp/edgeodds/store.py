"""Append-only SQLite snapshot store for normalized EdgeOdds quotes."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Iterable, Iterator

from .models import NormalizedQuote


SCHEMA = """
CREATE TABLE IF NOT EXISTS odds_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    bookmaker TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    source_market_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    market_type TEXT NOT NULL,
    selection TEXT NOT NULL,
    line REAL,
    period TEXT NOT NULL,
    settlement_rules_hash TEXT NOT NULL,
    decimal_price REAL NOT NULL,
    retrieved_at TEXT NOT NULL,
    source_updated_at TEXT,
    status TEXT NOT NULL,
    source_payload_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_odds_event_time
ON odds_snapshots(event_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_provider_book_time
ON odds_snapshots(provider, bookmaker, retrieved_at DESC);
"""


def snapshot_fingerprint(quote: NormalizedQuote) -> str:
    """Stable identity for an exact normalized snapshot, including NULL line values."""
    payload = [
        quote.provider,
        quote.bookmaker,
        quote.source_event_id,
        quote.source_market_id,
        quote.key.event_id,
        quote.key.market_type.value,
        quote.key.selection,
        quote.key.line,
        quote.key.period,
        quote.key.settlement_rules_hash,
        float(quote.decimal_price),
        quote.retrieved_at.isoformat(),
        quote.source_updated_at.isoformat() if quote.source_updated_at else None,
        quote.status.value,
        quote.source_payload_hash,
    ]
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class SnapshotStore:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        with self._connect() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path)
        try:
            db.row_factory = sqlite3.Row
            with db:
                yield db
        finally:
            db.close()

    def append(self, quote: NormalizedQuote) -> bool:
        """Append a quote snapshot. Returns False only for an exact duplicate."""
        values = (
            snapshot_fingerprint(quote),
            quote.provider,
            quote.bookmaker,
            quote.source_event_id,
            quote.source_market_id,
            quote.key.event_id,
            quote.key.market_type.value,
            quote.key.selection,
            quote.key.line,
            quote.key.period,
            quote.key.settlement_rules_hash,
            float(quote.decimal_price),
            quote.retrieved_at.isoformat(),
            quote.source_updated_at.isoformat() if quote.source_updated_at else None,
            quote.status.value,
            quote.source_payload_hash,
        )
        with self._connect() as db:
            cur = db.execute(
                """
                INSERT OR IGNORE INTO odds_snapshots (
                    fingerprint, provider, bookmaker, source_event_id, source_market_id,
                    event_id, market_type, selection, line, period,
                    settlement_rules_hash, decimal_price, retrieved_at,
                    source_updated_at, status, source_payload_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
            return cur.rowcount == 1

    def append_many(self, quotes: Iterable[NormalizedQuote]) -> int:
        return sum(1 for quote in quotes if self.append(quote))

    def latest(self, *, event_id: str | None = None, limit: int = 100) -> list[dict]:
        if limit <= 0 or limit > 5000:
            raise ValueError("limit must be between 1 and 5000")
        sql = "SELECT * FROM odds_snapshots"
        args: list[object] = []
        if event_id is not None:
            sql += " WHERE event_id = ?"
            args.append(event_id)
        sql += " ORDER BY retrieved_at DESC, id DESC LIMIT ?"
        args.append(limit)
        with self._connect() as db:
            return [dict(row) for row in db.execute(sql, args).fetchall()]
