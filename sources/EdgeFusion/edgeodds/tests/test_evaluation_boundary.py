from datetime import datetime, timedelta, timezone
import unittest

from edgeodds.evaluation import EvaluationError, EvaluationRecord, evaluate_history


T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
TRAIN_END = T0 + timedelta(days=10)
VAL_END = T0 + timedelta(days=20)


def row(i, decision, *, event=None, result=None, features=None, model=.6, market=.55,
        market_at=None, outcome=1, selected=False, executable=False, abstained=False,
        close=False):
    return EvaluationRecord(
        record_id=f"r{i}",
        event_id=event or f"e{i}",
        sport="NFL",
        market="moneyline",
        season="2026",
        decision_at=decision,
        features_available_at=features or decision,
        result_available_at=result or (decision + timedelta(hours=4)),
        outcome=outcome,
        model_probability=model,
        market_probability=market,
        market_observed_at=(market_at if market_at is not None else decision if market is not None else None),
        selected=selected,
        executable=executable,
        abstained=abstained,
        closing_quote_available=close,
    )


class EvaluationBoundaryTests(unittest.TestCase):
    def test_future_feature_rejected(self):
        decision = T0 + timedelta(days=1)
        with self.assertRaisesRegex(EvaluationError, "future feature"):
            row(1, decision, features=decision + timedelta(seconds=1))

    def test_future_market_observation_rejected(self):
        decision = T0 + timedelta(days=1)
        with self.assertRaisesRegex(EvaluationError, "future market"):
            row(1, decision, market_at=decision + timedelta(seconds=1))

    def test_market_probability_requires_observation_time(self):
        decision = T0 + timedelta(days=1)
        with self.assertRaisesRegex(EvaluationError, "market_observed_at"):
            EvaluationRecord(
                "r1","e1","NFL","moneyline","2026",decision,decision,
                decision + timedelta(hours=1),1,.6,.55,None
            )

    def test_event_cannot_span_partitions(self):
        rows = [
            row(1, T0 + timedelta(days=1), event="same"),
            row(2, T0 + timedelta(days=11), event="same"),
        ]
        with self.assertRaisesRegex(EvaluationError, "event spans"):
            evaluate_history(rows, train_end=TRAIN_END, validation_end=VAL_END)

    def test_training_label_must_be_available_by_boundary(self):
        bad = row(
            1, T0 + timedelta(days=9),
            result=TRAIN_END + timedelta(seconds=1),
        )
        with self.assertRaisesRegex(EvaluationError, "training label unavailable"):
            evaluate_history([bad], train_end=TRAIN_END, validation_end=VAL_END)

    def test_validation_label_must_be_available_by_boundary(self):
        bad = row(
            1, T0 + timedelta(days=19),
            result=VAL_END + timedelta(seconds=1),
        )
        with self.assertRaisesRegex(EvaluationError, "validation label unavailable"):
            evaluate_history([bad], train_end=TRAIN_END, validation_end=VAL_END)

    def test_metrics_and_market_baseline_are_separate(self):
        rows = [
            row(1, T0 + timedelta(days=1), model=.8, market=.6, outcome=1),
            row(2, T0 + timedelta(days=2), model=.2, market=.4, outcome=0),
            row(3, T0 + timedelta(days=11), model=.7, market=.55, outcome=1),
            row(4, T0 + timedelta(days=21), model=.9, market=.6, outcome=1),
            row(5, T0 + timedelta(days=22), model=.1, market=.4, outcome=0),
        ]
        report = evaluate_history(rows, train_end=TRAIN_END, validation_end=VAL_END)
        self.assertAlmostEqual(report["partitions"]["test"]["model"]["brier"], .01)
        self.assertAlmostEqual(report["partitions"]["test"]["market_baseline"]["brier"], .16)
        self.assertLess(report["test_matched_model_vs_market"]["model_minus_market_brier"], 0)

    def test_missing_model_is_coverage_not_fabricated_probability(self):
        rows = [
            row(1, T0 + timedelta(days=1), model=None, abstained=True),
            row(2, T0 + timedelta(days=11), model=.5),
            row(3, T0 + timedelta(days=21), model=None, abstained=True),
        ]
        report = evaluate_history(rows, train_end=TRAIN_END, validation_end=VAL_END)
        test = report["partitions"]["test"]
        self.assertEqual(test["model"]["n"], 0)
        self.assertEqual(test["coverage"]["model_missing_rate"], 1.0)
        self.assertEqual(test["coverage"]["abstention_rate"], 1.0)

    def test_clv_coverage_only_counts_executable_selected_rows(self):
        rows = [
            row(1, T0 + timedelta(days=1)),
            row(2, T0 + timedelta(days=11)),
            row(3, T0 + timedelta(days=21), selected=True, executable=True, close=True),
            row(4, T0 + timedelta(days=22), selected=True, executable=True, close=False),
            row(5, T0 + timedelta(days=23), selected=True, executable=False, close=True),
        ]
        report = evaluate_history(rows, train_end=TRAIN_END, validation_end=VAL_END)
        coverage = report["partitions"]["test"]["coverage"]
        self.assertEqual(coverage["executable_selected"], 2)
        self.assertEqual(coverage["clv_eligible_with_close"], 1)
        self.assertEqual(coverage["clv_coverage_rate"], .5)

    def test_evaluation_never_auto_promotes(self):
        rows = [
            row(1, T0 + timedelta(days=1)),
            row(2, T0 + timedelta(days=11)),
            row(3, T0 + timedelta(days=21)),
        ]
        report = evaluate_history(rows, train_end=TRAIN_END, validation_end=VAL_END)
        self.assertEqual(report["status"], "HELD_OUT_IMPROVEMENT_UNESTABLISHED")
        self.assertFalse(report["promotion_allowed"])


if __name__ == "__main__":
    unittest.main()
