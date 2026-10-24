# EdgeOdds v0.4 validation addendum

The initial ingestion change added 63 synthetic/local-HTTP tests. Its first GitHub
run executed 75 tests successfully on Python 3.11, 3.12 and 3.13, including the
12 preexisting EdgeOdds tests. Run: 39884987584, commit d4cd57a.

Reading the Python 3.13 log exposed ResourceWarnings from the foundation snapshot
store: sqlite3's connection context manager commits/rolls back but does not close
the connection. The follow-up change explicitly closes each SnapshotStore
connection in finally, preserving schema, quote history and public methods.

Two additional regression tests verify closure after successful operations and
rollback/closure after failure. The 65 new tests pass locally on Python 3.13.5
with ResourceWarning promoted to errors. The final CI run must execute 77 tests
per Python version before merge. This addendum does not imply the final CI run
has already succeeded; use the PR checks and job logs as the authority.

Old application source, wagers, deployment and forecasts remain unchanged. The
SnapshotStore connection-lifecycle repair is the only modified preexisting
Python source file in this PR.

No live odds/provider credential was used; no real event reconciliation or
production integration has been established. See EDGEODDS_INGESTION.md for
operation, strict timestamp handling and remaining activation gates.
