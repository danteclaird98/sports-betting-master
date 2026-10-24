# EdgeOdds settlement-rule registry

This lane defines versioned settlement semantics; it does not grade wagers.

A market is execution-equivalent only when both rule records are:
- explicitly verified from a source;
- fully specified for overtime, push, and postponement treatment;
- identical by versioned semantic fingerprint.

Unknown or unverified rules fail closed. The initial scope is full-game
moneyline, spread, and total semantics. Book/provider-specific rules must be
added only with source provenance.
