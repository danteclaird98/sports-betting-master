import unittest
from datetime import datetime, timedelta, timezone

from core import (
    CoverageEntry, CoverageRegistry, MarketStatus, Outcome, Quote, Verification,
    WagerKey, american_to_decimal, check_quote_freshness, decimal_to_american,
    estimate_ev, exact_wager_match, implied_probability, net_win_per_unit,
    proportional_no_vig,
)


class OddsTests(unittest.TestCase):
    def test_american_decimal_round_trip_and_implied_probability(self):
        self.assertAlmostEqual(american_to_decimal(150), 2.5)
        self.assertAlmostEqual(american_to_decimal(-200), 1.5)
        self.assertAlmostEqual(decimal_to_american(2.5), 150)
        self.assertAlmostEqual(decimal_to_american(1.5), -200)
        self.assertAlmostEqual(implied_probability(-110), 110 / 210)

    def test_invalid_odds_rejected(self):
        for value in (0, float("inf"), float("nan")):
            with self.assertRaises(ValueError):
                american_to_decimal(value)
        with self.assertRaises(ValueError):
            decimal_to_american(1)

    def test_no_vig_requires_matched_complete_market(self):
        p = proportional_no_vig([-110, -110])
        self.assertAlmostEqual(sum(p), 1)
        self.assertAlmostEqual(p[0], 0.5)
        with self.assertRaises(ValueError):
            proportional_no_vig([-110])


class EVTests(unittest.TestCase):
    def test_binary_ev_and_break_even(self):
        r = estimate_ev([
            Outcome("win", .5, net_win_per_unit(2.1)),
            Outcome("loss", .5, -1),
        ], probability_source="synthetic test fixture")
        self.assertAlmostEqual(r.ev_per_unit, .05)
        self.assertAlmostEqual(r.break_even_probability, 1 / 2.1)
        self.assertEqual(r.probability_source, "synthetic test fixture")

    def test_push_void_and_dead_heat_settlements(self):
        self.assertAlmostEqual(net_win_per_unit(2.1, dead_heat_fraction=.5), .05)
        self.assertEqual(net_win_per_unit(2.1, dead_heat_fraction=0), -1)
        r = estimate_ev([
            Outcome("win", .4, 1.1), Outcome("push", .1, 0), Outcome("loss", .5, -1)
        ], probability_source="test")
        self.assertAlmostEqual(r.ev_per_unit, -.06)
        self.assertTrue(r.break_even_probability != r.break_even_probability)  # undefined with push

    def test_coherent_uncertainty_bounds(self):
        r = estimate_ev([
            Outcome("win", .5, 1), Outcome("loss", .5, -1)
        ], probability_source="model-v1",
            probability_bounds={"win": (.45, .55), "loss": (.45, .55)})
        self.assertAlmostEqual(r.low_ev, -.1)
        self.assertAlmostEqual(r.high_ev, .1)
        with self.assertRaises(ValueError):
            estimate_ev([Outcome("win", 1, 1)], probability_source="bad",
                        probability_bounds={"win": (.1, .2)})

    def test_probability_must_be_exhaustive(self):
        with self.assertRaises(ValueError):
            estimate_ev([Outcome("win", .7, 1), Outcome("loss", .2, -1)], probability_source="x")


class MatchingAndFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.key = WagerKey("event-1", "spread", "home", "-2.5", "full game", "overtime included; pushes on 2")

    def test_exact_market_identity_includes_line_segment_rules(self):
        self.assertTrue(exact_wager_match(self.key, WagerKey("EVENT-1", "Spread", "HOME", "-2.5", "Full Game", "overtime included; pushes on 2")))
        self.assertFalse(exact_wager_match(self.key, WagerKey("event-1", "spread", "home", "-3.0", "full game", "overtime included; pushes on 2")))
        self.assertFalse(exact_wager_match(self.key, WagerKey("event-1", "spread", "home", "-2.5", "full game", "regulation only")))

    def test_stale_suspended_and_unstamped_quotes_are_rejected(self):
        now = datetime.now(timezone.utc)
        base = Quote("feed", "book", now, now - timedelta(seconds=20), None,
                     MarketStatus.OPEN, self.key, -110, "american", 1)
        self.assertFalse(check_quote_freshness(base, now=now, max_age_seconds=10).eligible)
        suspended = Quote("feed", "book", now, now, None, MarketStatus.SUSPENDED, self.key, -110, "american", 1)
        self.assertFalse(check_quote_freshness(suspended, now=now, max_age_seconds=10).eligible)
        unknown_time = Quote("feed", "book", now, None, None, MarketStatus.OPEN, self.key, -110, "american", 1)
        self.assertFalse(check_quote_freshness(unknown_time, now=now, max_age_seconds=10).eligible)

    def test_missing_live_latency_fails_closed_when_required(self):
        now = datetime.now(timezone.utc)
        q = Quote("feed", "book", now, now, None, MarketStatus.OPEN, self.key, -110, "american")
        self.assertFalse(check_quote_freshness(q, now=now, max_age_seconds=10,
                                               max_latency_seconds=3).eligible)


class CoverageTests(unittest.TestCase):
    def test_coverage_is_not_operational_until_live_verified(self):
        reg = CoverageRegistry([CoverageEntry("NBA", "NBA", "provider", "book", "moneyline", "pregame")])
        self.assertEqual(len(reg.entries()), 1)
        self.assertEqual(reg.operational(), ())
        reg.add(CoverageEntry("NBA", "NBA", "provider", "book", "moneyline", "pregame",
                              Verification.LIVE_VERIFIED))
        self.assertEqual(len(reg.operational()), 1)


if __name__ == "__main__":
    unittest.main()
