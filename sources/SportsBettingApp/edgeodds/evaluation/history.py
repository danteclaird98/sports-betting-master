"""Chronological evaluation boundary for EdgeOdds research history.

This module audits historical records. It does not fit, calibrate, or promote
models, and it never turns missing model evidence into a betting recommendation.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math
import random
from typing import Iterable


class EvaluationError(ValueError):
    pass


def _aware(value: datetime, name: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise EvaluationError(f"{name} must be timezone-aware")
    return value


def _probability(value: float | None, name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise EvaluationError(f"{name} must be numeric probability")
    try:
        p = float(value)
    except (TypeError, ValueError, OverflowError):
        raise EvaluationError(f"{name} must be numeric probability") from None
    if not math.isfinite(p) or not 0 <= p <= 1:
        raise EvaluationError(f"{name} must be between 0 and 1")
    return p


@dataclass(frozen=True)
class EvaluationRecord:
    record_id: str
    event_id: str
    sport: str
    market: str
    season: str
    decision_at: datetime
    features_available_at: datetime
    result_available_at: datetime
    outcome: int
    model_probability: float | None
    market_probability: float | None = None
    market_observed_at: datetime | None = None
    selected: bool = False
    executable: bool = False
    abstained: bool = False
    closing_quote_available: bool = False

    def __post_init__(self) -> None:
        for name in ("record_id", "event_id", "sport", "market", "season"):
            if not isinstance(getattr(self, name), str) or not getattr(self, name).strip():
                raise EvaluationError(f"{name} is required")
        decision = _aware(self.decision_at, "decision_at")
        features = _aware(self.features_available_at, "features_available_at")
        result = _aware(self.result_available_at, "result_available_at")
        if features > decision:
            raise EvaluationError("future feature information")
        if result <= decision:
            raise EvaluationError("result must become available after decision")
        if self.outcome not in (0, 1) or isinstance(self.outcome, bool):
            raise EvaluationError("outcome must be binary 0/1")
        model = _probability(self.model_probability, "model_probability")
        market = _probability(self.market_probability, "market_probability")
        object.__setattr__(self, "model_probability", model)
        object.__setattr__(self, "market_probability", market)
        if market is not None:
            if self.market_observed_at is None:
                raise EvaluationError("market_observed_at required with market_probability")
            observed = _aware(self.market_observed_at, "market_observed_at")
            if observed > decision:
                raise EvaluationError("future market information")
        elif self.market_observed_at is not None:
            _aware(self.market_observed_at, "market_observed_at")
        for name in ("selected", "executable", "abstained", "closing_quote_available"):
            if type(getattr(self, name)) is not bool:
                raise EvaluationError(f"{name} must be boolean")
        if self.selected and self.abstained:
            raise EvaluationError("record cannot be selected and abstained")


def _metric_rows(records: Iterable[EvaluationRecord], attr: str) -> list[tuple[EvaluationRecord, float]]:
    result = []
    for row in records:
        p = getattr(row, attr)
        if p is not None:
            result.append((row, p))
    return result


def _event_bootstrap_brier_ci(pairs: list[tuple[EvaluationRecord, float]], *, iterations: int = 500) -> list[float] | None:
    groups: dict[str, list[tuple[EvaluationRecord, float]]] = {}
    for row, p in pairs:
        groups.setdefault(row.event_id, []).append((row, p))
    if len(groups) < 2:
        return None
    keys = sorted(groups)
    rng = random.Random(20261023)
    values = []
    for _ in range(iterations):
        sample = [pair for key in rng.choices(keys, k=len(keys)) for pair in groups[key]]
        values.append(sum((p - row.outcome) ** 2 for row, p in sample) / len(sample))
    values.sort()
    return [values[int(.025 * len(values))], values[min(len(values) - 1, int(.975 * len(values)))]]


def _metrics(records: Iterable[EvaluationRecord], attr: str) -> dict:
    pairs = _metric_rows(records, attr)
    if not pairs:
        return {"n": 0, "events": 0, "brier": None, "log_loss": None, "calibration_bins": [], "event_bootstrap_brier_95_ci": None}
    brier = sum((p - row.outcome) ** 2 for row, p in pairs) / len(pairs)
    loss = 0.0
    for row, p in pairs:
        q = min(1 - 1e-12, max(1e-12, p))
        loss -= row.outcome * math.log(q) + (1 - row.outcome) * math.log(1 - q)
    bins = []
    for i in range(10):
        bucket = [(row, p) for row, p in pairs if min(9, int(p * 10)) == i]
        if bucket:
            bins.append({
                "bin": i,
                "n": len(bucket),
                "mean_prediction": sum(p for _, p in bucket) / len(bucket),
                "observed_frequency": sum(row.outcome for row, _ in bucket) / len(bucket),
            })
    return {
        "n": len(pairs),
        "events": len({row.event_id for row, _ in pairs}),
        "brier": brier,
        "log_loss": loss / len(pairs),
        "calibration_bins": bins,
        "event_bootstrap_brier_95_ci": _event_bootstrap_brier_ci(pairs),
    }


def _paired_brier_delta(records: Iterable[EvaluationRecord]) -> dict:
    rows = [r for r in records if r.model_probability is not None and r.market_probability is not None]
    if not rows:
        return {"n": 0, "events": 0, "model_minus_market_brier": None, "event_bootstrap_95_ci": None}
    deltas = [
        (r.model_probability - r.outcome) ** 2 - (r.market_probability - r.outcome) ** 2
        for r in rows
    ]
    groups: dict[str, list[float]] = {}
    for row, delta in zip(rows, deltas):
        groups.setdefault(row.event_id, []).append(delta)
    ci = None
    if len(groups) >= 2:
        keys = sorted(groups)
        rng = random.Random(20261023)
        draws = []
        for _ in range(500):
            values = [x for key in rng.choices(keys, k=len(keys)) for x in groups[key]]
            draws.append(sum(values) / len(values))
        draws.sort()
        ci = [draws[int(.025 * len(draws))], draws[min(len(draws) - 1, int(.975 * len(draws)))]]
    return {
        "n": len(rows),
        "events": len(groups),
        "model_minus_market_brier": sum(deltas) / len(deltas),
        "event_bootstrap_95_ci": ci,
    }


def _coverage(records: list[EvaluationRecord]) -> dict:
    n = len(records)
    actionable = [r for r in records if r.selected and r.executable]
    closes = [r for r in actionable if r.closing_quote_available]
    return {
        "records": n,
        "events": len({r.event_id for r in records}),
        "model_available": sum(r.model_probability is not None for r in records),
        "model_missing_rate": (sum(r.model_probability is None for r in records) / n) if n else None,
        "market_available": sum(r.market_probability is not None for r in records),
        "market_missing_rate": (sum(r.market_probability is None for r in records) / n) if n else None,
        "abstained": sum(r.abstained for r in records),
        "abstention_rate": (sum(r.abstained for r in records) / n) if n else None,
        "selected": sum(r.selected for r in records),
        "executable_selected": len(actionable),
        "clv_eligible_with_close": len(closes),
        "clv_coverage_rate": (len(closes) / len(actionable)) if actionable else None,
    }


def evaluate_history(records: Iterable[EvaluationRecord], *, train_end: datetime, validation_end: datetime) -> dict:
    train_end = _aware(train_end, "train_end")
    validation_end = _aware(validation_end, "validation_end")
    if train_end >= validation_end:
        raise EvaluationError("chronological boundaries invalid")

    rows = list(records)
    ids = set()
    event_partition: dict[str, str] = {}
    parts = {"train": [], "validation": [], "test": []}

    for row in rows:
        if row.record_id in ids:
            raise EvaluationError("duplicate prediction record")
        ids.add(row.record_id)
        partition = "train" if row.decision_at < train_end else "validation" if row.decision_at < validation_end else "test"
        prior = event_partition.get(row.event_id)
        if prior is not None and prior != partition:
            raise EvaluationError("event spans chronological partitions")
        event_partition[row.event_id] = partition
        if partition == "train" and row.result_available_at > train_end:
            raise EvaluationError("training label unavailable by train boundary")
        if partition == "validation" and row.result_available_at > validation_end:
            raise EvaluationError("validation label unavailable by validation boundary")
        parts[partition].append(row)

    report = {
        "status": "HELD_OUT_IMPROVEMENT_UNESTABLISHED",
        "promotion_allowed": False,
        "boundaries": {
            "train_end": train_end.isoformat(),
            "validation_end": validation_end.isoformat(),
        },
        "partitions": {},
        "test_matched_model_vs_market": _paired_brier_delta(parts["test"]),
        "limitations": [
            "Audit only: this module does not fit or calibrate models.",
            "Event-cluster bootstrap does not capture every temporal dependence structure.",
            "Brier/log-loss quality does not prove betting profitability.",
            "CLV coverage records availability only; it does not convert changed lines or infer missing closes.",
        ],
    }
    for name, part in parts.items():
        report["partitions"][name] = {
            "coverage": _coverage(part),
            "model": _metrics(part, "model_probability"),
            "market_baseline": _metrics(part, "market_probability"),
        }
    return report
