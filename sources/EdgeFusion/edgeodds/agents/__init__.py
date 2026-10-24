"""Parallel-agent coordination helpers for EdgeOdds."""
from .contracts import (
    AgentReport,
    EvidenceClaim,
    PROTECTED_CONTRACTS,
    WORKERS,
    protected_contracts_touched,
)

__all__ = [
    "AgentReport",
    "EvidenceClaim",
    "PROTECTED_CONTRACTS",
    "WORKERS",
    "protected_contracts_touched",
]
