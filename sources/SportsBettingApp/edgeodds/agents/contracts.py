"""Machine-checkable contracts for EdgeOdds parallel workers."""
from __future__ import annotations

from dataclasses import dataclass, field
from fnmatch import fnmatch
from pathlib import PurePosixPath
import re
from typing import Iterable


WORKERS = {
    "source-scout": ("docs/providers/**", "edgeodds/providers/**"),
    "provider-builder": (
        "edgeodds/providers/**",
        "edgeodds/adapters.py",
        "edgeodds/sportradar.py",
        "edgeodds/tests/test_ingestion.py",
    ),
    "identity-guardian": ("edgeodds/identity.py", "edgeodds/tests/test_identity.py", "docs/identity/**"),
    "market-rules": ("edgeodds/settlement_rules.py", "edgeodds/rules/**", "docs/rules/**"),
    "price-intelligence": ("edgeodds/price_intelligence.py", "edgeodds/tests/test_price_intelligence.py", "docs/pricing/**"),
    "model-evaluation": ("edgeodds/evaluation/**", "edgeodds/tests/test_evaluation*.py", "docs/evaluation/**"),
    "reliability-security": ("edgeodds/tests/**", "docs/security/**", ".github/workflows/**"),
    "edgeboard-integration": ("edgeodds/read_api.py", "edgeodds/integrations/**", "docs/integration/**"),
}

PROTECTED_CONTRACTS = {
    "canonical-event": ("edgeodds/identity.py",),
    "normalized-quote": ("edgeodds/models.py",),
    "ingestion-semantics": ("edgeodds/ingestion.py", "edgeodds/store.py"),
    "verification-state": ("edgeodds/models.py", "edgeodds/read_api.py"),
}

SHA_RE = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class EvidenceClaim:
    claim: str
    evidence: str

    def validate(self) -> None:
        if not self.claim.strip():
            raise ValueError("claim is required")
        if not self.evidence.strip():
            raise ValueError("evidence is required")


@dataclass(frozen=True)
class AgentReport:
    agent: str
    task_id: str
    base_sha: str
    head_sha: str
    changed_paths: tuple[str, ...]
    changed_contracts: tuple[str, ...] = ()
    tests_run: tuple[str, ...] = ()
    live_data_used: bool = False
    claims: tuple[EvidenceClaim, ...] = ()
    blockers: tuple[str, ...] = ()

    def validate(self) -> None:
        if self.agent not in WORKERS:
            raise ValueError(f"unknown agent: {self.agent}")
        if not self.task_id.strip():
            raise ValueError("task_id is required")
        for label, value in (("base_sha", self.base_sha), ("head_sha", self.head_sha)):
            if not SHA_RE.fullmatch(value):
                raise ValueError(f"{label} must be a 40-character lowercase git SHA")
        if self.base_sha == self.head_sha:
            raise ValueError("head_sha must differ from base_sha")
        if type(self.live_data_used) is not bool:
            raise ValueError("live_data_used must be boolean")

        for path in self.changed_paths:
            _validate_path(path)
        for claim in self.claims:
            claim.validate()

        unknown_contracts = set(self.changed_contracts) - set(PROTECTED_CONTRACTS)
        if unknown_contracts:
            raise ValueError(f"unknown protected contracts: {sorted(unknown_contracts)}")

        touched = protected_contracts_touched(self.changed_paths)
        undeclared = touched - set(self.changed_contracts)
        if undeclared:
            raise ValueError(
                "protected contract changes must be declared: "
                + ", ".join(sorted(undeclared))
            )

    def ownership_violations(self) -> tuple[str, ...]:
        """Paths outside a worker's normal lane; orchestrator review is required."""
        patterns = WORKERS[self.agent]
        return tuple(
            path for path in self.changed_paths
            if not path.startswith("edgeodds/agents/reports/")
            and not any(fnmatch(path, pattern) for pattern in patterns)
        )


def _validate_path(path: str) -> None:
    p = PurePosixPath(path)
    if not path or path.startswith("/") or ".." in p.parts:
        raise ValueError(f"unsafe repository path: {path!r}")


def protected_contracts_touched(paths: Iterable[str]) -> set[str]:
    touched: set[str] = set()
    for name, protected_paths in PROTECTED_CONTRACTS.items():
        for path in paths:
            if path in protected_paths:
                touched.add(name)
    return touched
