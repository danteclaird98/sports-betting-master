import copy
import unittest

from edgeodds.integrations.edgeboard import EdgeBoardContractError, edgeboard_contract


def board(provider="provider-a"):
    return {
        "event_id": "event-1",
        "mode": "fixture",
        "checked_at": "2026-10-23T20:00:00+00:00",
        "data_status": "OBSERVED_UNVERIFIED",
        "live_verified": False,
        "model_status": "MODEL_UNAVAILABLE",
        "model_probability": None,
        "ev_per_unit": None,
        "event": {
            "sport": "american_football",
            "league": "NFL",
            "starts_at": "2026-10-25T20:00:00+00:00",
        },
        "quotes": [{
            "provider": provider,
            "sportsbook": "book-a",
            "provider_event_id": "native-event",
            "source_market_id": "native-market",
            "external_market_id": "must-not-leak",
            "external_outcome_id": "must-not-leak",
            "bookmaker_name": "Must Not Define Schema",
            "market": "moneyline",
            "selection": "team-a",
            "line": None,
            "period": "full_game",
            "rules": "unknown",
            "rules_verified": False,
            "decimal_odds": 1.91,
            "status": "open",
            "source_updated_at": None,
            "source_snapshot_at": "2026-10-23T19:59:00+00:00",
            "retrieved_at": "2026-10-23T20:00:00+00:00",
            "raw_sha256": "abc",
            "source_ref": "edgeodds:sha256:abc",
            "price_fresh": False,
            "analysis_eligible": False,
            "qualification": "unevaluable",
            "model_probability": None,
            "ev_per_unit": None,
            "exclusion_reasons": [
                "SOURCE_QUOTE_TIMESTAMP_UNAVAILABLE",
                "SETTLEMENT_RULES_UNVERIFIED",
                "MODEL_UNAVAILABLE",
            ],
        }],
        "reasons": ["SOURCE_QUOTE_TIMESTAMP_UNAVAILABLE"],
        "empty_response_is_not_no_edge": True,
    }


class EdgeBoardContractTests(unittest.TestCase):
    def test_contract_does_not_mutate_source(self):
        source = board()
        before = copy.deepcopy(source)
        edgeboard_contract(source)
        self.assertEqual(source, before)

    def test_schema_is_provider_independent(self):
        left = edgeboard_contract(board("provider-a"))
        right = edgeboard_contract(board("provider-b"))
        self.assertEqual(set(left), set(right))
        self.assertEqual(set(left["quotes"][0]), set(right["quotes"][0]))
        self.assertEqual(set(left["quotes"][0]["source"]), set(right["quotes"][0]["source"]))

    def test_provider_native_extras_do_not_leak(self):
        output = edgeboard_contract(board())
        text = repr(output)
        self.assertNotIn("external_market_id", text)
        self.assertNotIn("external_outcome_id", text)
        self.assertNotIn("bookmaker_name", text)

    def test_missing_quote_clock_and_model_stay_missing(self):
        output = edgeboard_contract(board())
        quote = output["quotes"][0]
        self.assertIsNone(quote["timestamps"]["quote_updated_at"])
        self.assertIsNone(quote["analysis"]["model_probability"])
        self.assertIsNone(quote["analysis"]["ev_per_unit"])
        self.assertEqual(output["model"]["status"], "MODEL_UNAVAILABLE")
        self.assertFalse(quote["analysis"]["eligible"])

    def test_unverified_rules_stay_unverified(self):
        output = edgeboard_contract(board())
        self.assertFalse(output["quotes"][0]["market"]["settlement_rules"]["verified"])

    def test_contract_is_read_only_and_execution_disabled(self):
        output = edgeboard_contract(board())
        self.assertTrue(output["read_only"])
        self.assertEqual(output["execution"], "DISABLED")

    def test_bad_shapes_fail_closed(self):
        with self.assertRaises(EdgeBoardContractError):
            edgeboard_contract({"quotes": {}})
        with self.assertRaises(EdgeBoardContractError):
            edgeboard_contract({"quotes": [], "event": []})


if __name__ == "__main__":
    unittest.main()
