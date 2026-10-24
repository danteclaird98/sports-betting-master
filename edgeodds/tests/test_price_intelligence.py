from datetime import datetime, timedelta, timezone
import unittest

from edgeodds.models import MarketKey, MarketStatus, MarketType, NormalizedQuote
from edgeodds.price_intelligence import (
    PriceIntelligenceError,
    best_price,
    closing_quote,
    complete_two_way_market,
    price_movement,
    proportional_no_vig,
)


T0 = datetime(2026, 10, 25, 20, 0, tzinfo=timezone.utc)


def q(selection, price, *, market=MarketType.MONEYLINE, line=None, book="a",
      provider="fixture", at=None, status=MarketStatus.OPEN, rules="rules-v1"):
    return NormalizedQuote(
        provider=provider,
        bookmaker=book,
        source_event_id="native-event",
        source_market_id=f"{book}:{selection}:{line}:{at}",
        key=MarketKey(
            event_id="event-1",
            market_type=market,
            selection=selection,
            line=line,
            period="full_game",
            settlement_rules_hash=rules,
        ),
        decimal_price=price,
        retrieved_at=(at or T0) + timedelta(seconds=1),
        source_updated_at=at,
        status=status,
        source_payload_hash="sha256:test",
    )


class PriceIntelligenceTests(unittest.TestCase):
    def test_best_price_requires_exact_selection(self):
        winner = best_price([q("A", 1.9, book="x"), q("A", 2.0, book="y")])
        self.assertEqual(winner.decimal_price, 2.0)
        with self.assertRaises(PriceIntelligenceError):
            best_price([q("A", 2.0), q("B", 2.0)])

    def test_complete_market_rejects_missing_or_cross_book_outcome(self):
        with self.assertRaises(PriceIntelligenceError):
            complete_two_way_market([q("A", 1.9)])
        with self.assertRaises(PriceIntelligenceError):
            complete_two_way_market([q("A", 1.9, book="x"), q("B", 2.0, book="y")])

    def test_spread_lines_must_be_exact_opposites(self):
        good = [
            q("A", 1.91, market=MarketType.SPREAD, line=-3.5),
            q("B", 1.91, market=MarketType.SPREAD, line=3.5),
        ]
        complete_two_way_market(good)
        bad = [
            q("A", 1.91, market=MarketType.SPREAD, line=-3.5),
            q("B", 1.91, market=MarketType.SPREAD, line=4.5),
        ]
        with self.assertRaises(PriceIntelligenceError):
            complete_two_way_market(bad)

    def test_settlement_rules_must_match(self):
        with self.assertRaises(PriceIntelligenceError):
            complete_two_way_market([q("A", 1.9, rules="r1"), q("B", 2.0, rules="r2")])

    def test_no_vig_requires_complete_matched_two_way_market(self):
        result = proportional_no_vig([q("A", 1.91), q("B", 1.91)])
        self.assertAlmostEqual(result["A"], 0.5)
        self.assertAlmostEqual(result["B"], 0.5)

    def test_suspended_outcome_cannot_complete_market(self):
        with self.assertRaises(PriceIntelligenceError):
            proportional_no_vig([q("A", 1.91), q("B", 1.91, status=MarketStatus.SUSPENDED)])

    def test_price_movement_requires_provider_timestamps_and_one_book(self):
        rows = [q("A", 2.0, at=T0), q("A", 1.8, at=T0 + timedelta(minutes=5))]
        movement = price_movement(rows)
        self.assertAlmostEqual(movement.decimal_ratio_minus_one, -0.1)
        with self.assertRaises(PriceIntelligenceError):
            price_movement([q("A", 2.0), q("A", 1.8, at=T0)])

    def test_closing_quote_is_last_exact_prestart_quote(self):
        start = T0 + timedelta(hours=1)
        rows = [
            q("A", 2.1, at=T0),
            q("A", 2.0, at=T0 + timedelta(minutes=55)),
            q("A", 1.9, at=T0 + timedelta(hours=1, minutes=1)),
        ]
        close = closing_quote(rows, start_at=start)
        self.assertEqual(close.decimal_price, 2.0)

    def test_conflicting_same_time_close_fails_closed(self):
        start = T0 + timedelta(hours=1)
        with self.assertRaisesRegex(PriceIntelligenceError, "conflicting closing"):
            closing_quote(
                [q("A", 2.0, at=T0), q("A", 2.1, at=T0)],
                start_at=start,
            )


if __name__ == "__main__":
    unittest.main()
