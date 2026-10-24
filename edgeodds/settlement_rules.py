"""Versioned settlement-rule primitives for EdgeOdds.

Rules are evidence-bearing metadata. They do not grade wagers and they do not
infer bookmaker behavior. Unknown or mismatched rules fail equivalence checks.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import hashlib
import json

from .models import MarketType


class OvertimeTreatment(str, Enum):
    INCLUDED = "included"
    EXCLUDED = "excluded"
    UNKNOWN = "unknown"


class PushTreatment(str, Enum):
    REFUND = "refund"
    LOSS = "loss"
    UNKNOWN = "unknown"


class PostponementTreatment(str, Enum):
    ACTION = "action"
    VOID = "void"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class SettlementRule:
    rule_id: str
    version: str
    market_type: MarketType
    period: str
    overtime: OvertimeTreatment
    push: PushTreatment
    postponement: PostponementTreatment
    source_ref: str
    verified: bool = False

    def __post_init__(self) -> None:
        for name in ("rule_id", "version", "period", "source_ref"):
            if not str(getattr(self, name)).strip():
                raise ValueError(f"{name} is required")
        if type(self.verified) is not bool:
            raise ValueError("verified must be boolean")

    @property
    def fingerprint(self) -> str:
        payload = {
            "market_type": self.market_type.value,
            "period": self.period,
            "overtime": self.overtime.value,
            "push": self.push.value,
            "postponement": self.postponement.value,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def unresolved_fields(self) -> tuple[str, ...]:
        missing = []
        if self.overtime == OvertimeTreatment.UNKNOWN:
            missing.append("overtime")
        if self.push == PushTreatment.UNKNOWN:
            missing.append("push")
        if self.postponement == PostponementTreatment.UNKNOWN:
            missing.append("postponement")
        return tuple(missing)

    def execution_equivalent(self, other: "SettlementRule") -> bool:
        """True only for verified, fully specified, identical rule semantics."""
        if not isinstance(other, SettlementRule):
            return False
        if not self.verified or not other.verified:
            return False
        if self.unresolved_fields() or other.unresolved_fields():
            return False
        return self.fingerprint == other.fingerprint


class SettlementRegistry:
    def __init__(self, rules=()):
        self._rules: dict[tuple[str, str], SettlementRule] = {}
        for rule in rules:
            self.add(rule)

    def add(self, rule: SettlementRule) -> None:
        key = (rule.rule_id, rule.version)
        existing = self._rules.get(key)
        if existing is not None and existing != rule:
            raise ValueError("settlement rule version conflict")
        self._rules[key] = rule

    def get(self, rule_id: str, version: str) -> SettlementRule:
        try:
            return self._rules[(rule_id, version)]
        except KeyError:
            raise KeyError("unknown settlement rule version") from None

    def verified_equivalent(
        self,
        left: tuple[str, str],
        right: tuple[str, str],
    ) -> bool:
        return self.get(*left).execution_equivalent(self.get(*right))
