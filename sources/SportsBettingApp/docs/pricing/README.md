# EdgeOdds price intelligence

This module operates only on normalized quotes. It does not fetch prices and it
does not estimate model probabilities.

Implemented primitives:
- deterministic best price for one exact selection;
- complete two-way market validation;
- proportional no-vig benchmark for a complete matched market;
- same-book exact-selection price movement;
- last verified pre-start exact-selection closing quote.

Failure boundaries:
- incomplete markets are not de-vigged;
- cross-book outcomes are not combined into one two-way market;
- spread thresholds must be exact opposites;
- settlement-rule hashes must match;
- missing provider timestamps prevent movement/closing calculations;
- conflicting prices at the same provider timestamp fail closed.
