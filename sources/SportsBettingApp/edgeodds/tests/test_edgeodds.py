from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from edgeodds.models import (
    MarketKey,
    MarketStatus,
    MarketType,
    NormalizedQuote,
    evaluate_freshness,
)
from edgeodds.store import SnapshotStore


NOW = datetime(2026, 10, 22, 20, 0, tzinfo=timezone.utc)


def quote(**overrides):
    values = {
        "provider": "fixture",
        "bookmaker": "book_a",
        "source_event_id": "native-event-1",
        "source_market_id": "native-market-1",
        "key": MarketKey(
            event_id="nfl-2026-ari-sea",
            market_type=MarketType.SPREAD,
            selection="Seattle Seahawks",
            line=-3.5,
            period="full_game",
            settlement_rules_hash="rules-v1",
        ),
        "decimal_price": 1.91,
        "retrieved_at": NOW,
        "source_updated_at": NOW - timedelta(seconds=15),
        "status": MarketStatus.OPEN,
        "source_payload_hash": "sha256:fixture",
    }
    values.update(overrides)
    return NormalizedQuote(**values)


class EdgeOddsContractTests(unittest.TestCase):
    def test_moneyline_rejects_line(self):
        with self.assertRaises(ValueError):
            MarketKey(
                event_id="x",
                market_type=MarketType.MONEYLINE,
                selection="A",
                line=-1.5,
            )

    def test_spread_requires_line(self):
        with self.assertRaises(ValueError):
            MarketKey(
                event_id="x",
                market_type=MarketType.SPREAD,
                selection="A",
            )

    def test_missing_provider_timestamp_is_not_fresh(self):
        result = evaluate_freshness(
            quote(source_updated_at=None),
            now=NOW,
            max_age_seconds=60,
        )
        self.assertFalse(result.eligible)
        self.assertIn("timestamp unavailable", result.reason)

    def test_stale_quote_is_rejected(self):
        result = evaluate_freshness(
            quote(source_updated_at=NOW - timedelta(minutes=3)),
            now=NOW,
            max_age_seconds=60,
        )
        self.assertFalse(result.eligible)
        self.assertIn("freshness threshold", result.reason)

    def test_fresh_open_quote_is_eligible(self):
        result = evaluate_freshness(quote(), now=NOW, max_age_seconds=60)
        self.assertTrue(result.eligible)
        self.assertEqual(result.age_seconds, 15)

    def test_snapshot_store_is_append_only_and_dedupes_exact_repeat(self):
        with TemporaryDirectory() as tmp:
            store = SnapshotStore(Path(tmp) / "edgeodds.sqlite3")
            self.assertTrue(store.append(quote()))
            self.assertFalse(store.append(quote()))

            moneyline = quote(
                key=MarketKey(
                    event_id="nfl-2026-ari-sea",
                    market_type=MarketType.MONEYLINE,
                    selection="Seattle Seahawks",
                ),
                source_market_id="native-moneyline-1",
                source_payload_hash="sha256:moneyline",
            )
            self.assertTrue(store.append(moneyline))
            self.assertFalse(store.append(moneyline))

            changed = quote(
                decimal_price=1.95,
                source_updated_at=NOW - timedelta(seconds=5),
                source_payload_hash="sha256:changed",
            )
            self.assertTrue(store.append(changed))
            rows = store.latest(event_id="nfl-2026-ari-sea")
            self.assertEqual(len(rows), 3)
            self.assertEqual(rows[0]["decimal_price"], 1.95)


if __name__ == "__main__":
    unittest.main()
