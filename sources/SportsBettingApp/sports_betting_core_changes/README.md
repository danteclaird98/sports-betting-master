# Sports betting research core (not integrated)

This package is a standalone implementation change set for the existing sports betting project. It is **not connected to a sportsbook, odds provider, model, database, or user interface**, and it does not produce picks. All coverage entries begin unverified. Do not use demonstration inputs as live research.

## Implemented here

- American and decimal odds conversion with validation.
- Proportional no-vig normalization for a complete, matched market (explicitly a market benchmark, not an independent model).
- Expected net profit per unit from explicit exhaustive settlement outcomes, including pushes, voids, and dead-heat payout fractions.
- Probability uncertainty/sensitivity bounds.
- Exact wager matching on event, market, selection, line, segment, and settlement rules.
- Freshness and market-status eligibility checks.
- A coverage registry whose default is `unverified` and whose status cannot be upgraded by configuration alone.

## Not implemented or verified

Provider adapters, historical snapshots, statistical models, UI, persistence, authentication, imports, alerts, wager ledger, deployment, and live source/price validation remain unimplemented. No numerical probability is produced by this package. `estimate_ev` requires caller-supplied probabilities and records them as estimates; it does not make them valid.

## Run tests

```sh
python -m unittest discover -s tests -v
```

## Calculation conventions

`Outcome.net_per_unit` is net profit (returned stake excluded) for one unit staked, after any passed-through fee. A win at +110 is `1.10`; a loss is `-1`; a push or void is `0`; a half-stake dead heat at +110 is `0.5 * 1.10 - 0.5 = 0.05`. Probabilities must describe an exhaustive, mutually exclusive outcome set and sum to one. Estimated EV is `sum(p_i * net_i)`.

For American/decimal odds, implied probability is raw and includes market margin. Proportional no-vig probability divides each matched outcome's implied probability by the sum across the complete market. Do not use it if outcomes are missing or non-equivalent.

## Integration gate

Before showing a wager as actionable, the host application must attach timestamped source records, confirm equivalent market/settlement rules, supply a separately evaluated probability model, pass freshness and quality gates, and display missing evidence. Until then, the right result is no qualifying opportunities.
