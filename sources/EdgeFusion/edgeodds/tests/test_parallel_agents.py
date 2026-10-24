import unittest

from edgeodds.agents.contracts import (
    AgentReport,
    EvidenceClaim,
    protected_contracts_touched,
)


BASE = "1" * 40
HEAD = "2" * 40


class ParallelAgentContractTests(unittest.TestCase):
    def test_valid_lane_report(self):
        report = AgentReport(
            agent="price-intelligence",
            task_id="price-001",
            base_sha=BASE,
            head_sha=HEAD,
            changed_paths=("edgeodds/price_intelligence.py",),
            tests_run=("python -m unittest edgeodds.tests.test_price_intelligence",),
            claims=(EvidenceClaim("best-price ties are deterministic", "test_best_price_tie"),),
        )
        report.validate()
        self.assertEqual(report.ownership_violations(), ())

    def test_protected_contract_change_must_be_declared(self):
        report = AgentReport(
            agent="provider-builder",
            task_id="provider-001",
            base_sha=BASE,
            head_sha=HEAD,
            changed_paths=("edgeodds/models.py",),
        )
        with self.assertRaisesRegex(ValueError, "protected contract changes"):
            report.validate()

    def test_declared_contract_change_still_requires_orchestrator_review(self):
        report = AgentReport(
            agent="provider-builder",
            task_id="provider-002",
            base_sha=BASE,
            head_sha=HEAD,
            changed_paths=("edgeodds/models.py",),
            changed_contracts=("normalized-quote", "verification-state"),
        )
        report.validate()
        self.assertEqual(report.ownership_violations(), ("edgeodds/models.py",))

    def test_unsafe_paths_rejected(self):
        report = AgentReport(
            agent="source-scout",
            task_id="bad-path",
            base_sha=BASE,
            head_sha=HEAD,
            changed_paths=("../secrets.env",),
        )
        with self.assertRaisesRegex(ValueError, "unsafe repository path"):
            report.validate()

    def test_claim_requires_evidence(self):
        report = AgentReport(
            agent="source-scout",
            task_id="claim-001",
            base_sha=BASE,
            head_sha=HEAD,
            changed_paths=("docs/providers/matrix.md",),
            claims=(EvidenceClaim("provider is live", ""),),
        )
        with self.assertRaisesRegex(ValueError, "evidence is required"):
            report.validate()

    def test_provider_builder_owns_existing_sportradar_adapter_and_tests(self):
        report = AgentReport(
            agent="provider-builder",
            task_id="provider-scope",
            base_sha=BASE,
            head_sha=HEAD,
            changed_paths=("edgeodds/sportradar.py", "edgeodds/tests/test_ingestion.py"),
        )
        report.validate()
        self.assertEqual(report.ownership_violations(), ())

    def test_evidence_report_path_is_not_an_ownership_violation(self):
        report = AgentReport(
            agent="source-scout",
            task_id="report-path",
            base_sha=BASE,
            head_sha=HEAD,
            changed_paths=(
                "docs/providers/matrix.md",
                "edgeodds/agents/reports/source-scout.json",
            ),
        )
        report.validate()
        self.assertEqual(report.ownership_violations(), ())

    def test_contract_touch_detection(self):
        self.assertEqual(
            protected_contracts_touched(["edgeodds/store.py", "docs/x.md"]),
            {"ingestion-semantics"},
        )


if __name__ == "__main__":
    unittest.main()
