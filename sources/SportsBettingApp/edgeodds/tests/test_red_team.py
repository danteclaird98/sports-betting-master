from datetime import datetime, timedelta, timezone
import unittest

from edgeodds.models import (
    MarketKey,
    MarketStatus,
    MarketType,
    NormalizedQuote,
    evaluate_freshness,
)
from edgeodds.price_intelligence import (
    PriceIntelligenceError,
    best_price,
    closing_quote,
    price_movement,
    proportional_no_vig,
)
from edgeodds.settlement_rules import (
    OvertimeTreatment,
    PostponementTreatment,
    PushTreatment,
    SettlementRule,
)


NOW = datetime(2026, 10, 23, 20, 0, tzinfo=timezone.utc)


def quote(selection="A", price=2.0, *, market=MarketType.MONEYLINE, line=None,
          rules="rules-v1", source_at=None, retrieved_at=None,
          status=MarketStatus.OPEN, book="book-a", provider="fixture"):
    return NormalizedQuote(
        provider=provider,
        bookmaker=book,
        source_event_id="native-event",
        source_market_id=f"{book}:{selection}:{line}:{source_at}:{price}",
        key=MarketKey(
            event_id="event-1",
            market_type=market,
            selection=selection,
            line=line,
            period="full_game",
            settlement_rules_hash=rules,
        ),
        decimal_price=price,
        retrieved_at=retrieved_at or NOW,
        source_updated_at=source_at,
        status=status,
        source_payload_hash="sha256:red-team",
    )


def rule(**overrides):
    data = dict(
        rule_id="book:nfl:full",
        version="v1",
        market_type=MarketType.SPREAD,
        period="full_game",
        overtime=OvertimeTreatment.INCLUDED,
        push=PushTreatment.REFUND,
        postponement=PostponementTreatment.VOID,
        source_ref="https://example.invalid/rules",
        verified=True,
    )
    data.update(overrides)
    return SettlementRule(**data)


class RedTeamTests(unittest.TestCase):
    def test_fresh_retrieval_cannot_revive_stale_provider_quote(self):
        q = quote(source_at=NOW - timedelta(minutes=20), retrieved_at=NOW)
        result = evaluate_freshness(q, now=NOW, max_age_seconds=60)
        self.assertFalse(result.eligible)
        self.assertIn("freshness threshold", result.reason)

    def test_future_provider_clock_fails_closed(self):
        q = quote(source_at=NOW + timedelta(minutes=2), retrieved_at=NOW)
        result = evaluate_freshness(q, now=NOW, max_age_seconds=300)
        self.assertFalse(result.eligible)
        self.assertIn("future", result.reason)

    def test_suspended_better_price_does_not_win(self):
        open_q = quote(price=1.95, status=MarketStatus.OPEN)
        suspended = quote(price=9.0, status=MarketStatus.SUSPENDED)
        self.assertEqual(best_price([open_q, suspended]).decimal_price, 1.95)

    def test_cross_rule_best_price_is_rejected_even_if_selection_matches(self):
        with self.assertRaises(PriceIntelligenceError):
            best_price([
                quote(price=1.9, rules="rules-a", book="a"),
                quote(price=2.1, rules="rules-b", book="b"),
            ])

    def test_alternate_spreads_cannot_form_one_two_way_market(self):
        rows = [
            quote("A", 1.91, market=MarketType.SPREAD, line=-3.5),
            quote("B", 1.91, market=MarketType.SPREAD, line=4.5),
        ]
        with self.assertRaises(PriceIntelligenceError):
            proportional_no_vig(rows)

    def test_total_threshold_mismatch_cannot_be_devigged(self):
        rows = [
            quote("Over", 1.91, market=MarketType.TOTAL, line=44.5),
            quote("Under", 1.91, market=MarketType.TOTAL, line=45.5),
        ]
        with self.assertRaises(PriceIntelligenceError):
            proportional_no_vig(rows)

    def test_missing_quote_clock_blocks_closing_quote(self):
        start = NOW + timedelta(hours=1)
        with self.assertRaisesRegex(PriceIntelligenceError, "timestamped"):
            closing_quote([quote(source_at=None)], start_at=start)

    def test_post_start_quote_cannot_be_selected_as_close(self):
        start = NOW + timedelta(hours=1)
        rows = [quote(source_at=start + timedelta(seconds=1), retrieved_at=start + timedelta(seconds=2))]
        with self.assertRaisesRegex(PriceIntelligenceError, "pre-start"):
            closing_quote(rows, start_at=start)

    def test_same_time_conflicting_movement_fails_closed(self):
        rows = [
            quote(price=2.0, source_at=NOW),
            quote(price=2.2, source_at=NOW),
        ]
        with self.assertRaisesRegex(PriceIntelligenceError, "conflicting"):
            price_movement(rows)

    def test_unverified_rule_cannot_be_equivalent_to_verified_rule(self):
        self.assertFalse(rule(verified=False).execution_equivalent(rule()))

    def test_unknown_semantics_cannot_be_equivalent(self):
        unknown = rule(overtime=OvertimeTreatment.UNKNOWN)
        self.assertFalse(unknown.execution_equivalent(unknown))

    def test_same_semantics_different_provenance_remain_equivalent(self):
        left = rule(rule_id="book-a", version="a", source_ref="https://a.invalid")
        right = rule(rule_id="book-b", version="b", source_ref="https://b.invalid")
        self.assertTrue(left.execution_equivalent(right))


if __name__ == "__main__":
    unittest.main()
