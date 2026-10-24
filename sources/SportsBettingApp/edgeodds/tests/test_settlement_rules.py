import unittest

from edgeodds.models import MarketType
from edgeodds.settlement_rules import (
    OvertimeTreatment,
    PostponementTreatment,
    PushTreatment,
    SettlementRegistry,
    SettlementRule,
)


def rule(**overrides):
    values = dict(
        rule_id="book:nfl:full-game-spread",
        version="2026-10-23",
        market_type=MarketType.SPREAD,
        period="full_game",
        overtime=OvertimeTreatment.INCLUDED,
        push=PushTreatment.REFUND,
        postponement=PostponementTreatment.VOID,
        source_ref="https://example.invalid/rules",
        verified=True,
    )
    values.update(overrides)
    return SettlementRule(**values)


class SettlementRulesTests(unittest.TestCase):
    def test_identical_verified_rules_are_equivalent(self):
        self.assertTrue(rule().execution_equivalent(rule()))

    def test_unknown_semantics_fail_closed(self):
        unknown = rule(overtime=OvertimeTreatment.UNKNOWN)
        self.assertFalse(unknown.execution_equivalent(unknown))
        self.assertEqual(unknown.unresolved_fields(), ("overtime",))

    def test_unverified_rules_are_not_execution_equivalent(self):
        self.assertFalse(rule(verified=False).execution_equivalent(rule()))

    def test_different_record_ids_with_same_semantics_are_equivalent(self):
        left = rule(rule_id="book-a:nfl:spread", version="2026-a", source_ref="https://a.invalid")
        right = rule(rule_id="book-b:nfl:spread", version="2026-b", source_ref="https://b.invalid")
        self.assertEqual(left.fingerprint, right.fingerprint)
        self.assertTrue(left.execution_equivalent(right))

    def test_rule_mismatch_is_not_equivalent(self):
        self.assertFalse(
            rule(overtime=OvertimeTreatment.INCLUDED).execution_equivalent(
                rule(overtime=OvertimeTreatment.EXCLUDED)
            )
        )
        self.assertFalse(
            rule(push=PushTreatment.REFUND).execution_equivalent(
                rule(push=PushTreatment.LOSS)
            )
        )

    def test_version_conflict_rejected(self):
        registry = SettlementRegistry([rule()])
        with self.assertRaisesRegex(ValueError, "version conflict"):
            registry.add(rule(push=PushTreatment.LOSS))

    def test_registry_requires_explicit_version(self):
        registry = SettlementRegistry([rule()])
        self.assertTrue(
            registry.verified_equivalent(
                ("book:nfl:full-game-spread", "2026-10-23"),
                ("book:nfl:full-game-spread", "2026-10-23"),
            )
        )
        with self.assertRaises(KeyError):
            registry.get("book:nfl:full-game-spread", "latest")


if __name__ == "__main__":
    unittest.main()
