import baseline from './nflBaselineReport.json';
import mlbBaseline from './mlbBaselineReport.json';

export type SettlementOutcome = {
  name: string;
  probability: number;
  netPerUnit: number;
};
export function americanDecimal(price: number) {
  if (!Number.isFinite(price) || Math.abs(price) < 100)
    throw Error('Invalid American odds');
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}
export function settlementEv(outcomes: SettlementOutcome[]) {
  if (
    !outcomes.length ||
    new Set(outcomes.map((o) => o.name)).size !== outcomes.length ||
    outcomes.some(
      (o) =>
        !o.name ||
        !Number.isFinite(o.probability) ||
        o.probability < 0 ||
        o.probability > 1 ||
        !Number.isFinite(o.netPerUnit),
    ) ||
    Math.abs(outcomes.reduce((s, o) => s + o.probability, 0) - 1) > 1e-8
  )
    throw Error('Require named exhaustive settlement outcomes totaling one');
  return outcomes.reduce((sum, o) => sum + o.probability * o.netPerUnit, 0);
}
// Bounds must describe a feasible simplex. Extremes honor total probability=1.
export function settlementSensitivity(
  outcomes: SettlementOutcome[],
  bounds: Array<[number, number]>,
) {
  settlementEv(outcomes);
  if (
    bounds.length !== outcomes.length ||
    bounds.some(
      ([lo, hi], i) =>
        !Number.isFinite(lo) ||
        !Number.isFinite(hi) ||
        lo < 0 ||
        hi > 1 ||
        lo > hi ||
        outcomes[i].probability < lo ||
        outcomes[i].probability > hi,
    ) ||
    bounds.reduce((s, b) => s + b[0], 0) > 1 + 1e-8 ||
    bounds.reduce((s, b) => s + b[1], 0) < 1 - 1e-8
  )
    throw Error('Invalid or infeasible probability bounds');
  const extreme = (ascending: boolean) => {
    const p = bounds.map((b) => b[0]);
    let left = 1 - p.reduce((s, v) => s + v, 0);
    const order = outcomes
      .map((o, i) => i)
      .sort(
        (a, b) =>
          (ascending ? 1 : -1) *
          (outcomes[a].netPerUnit - outcomes[b].netPerUnit),
      );
    for (const i of order) {
      const add = Math.min(left, bounds[i][1] - p[i]);
      p[i] += add;
      left -= add;
    }
    return outcomes.reduce((s, o, i) => s + p[i] * o.netPerUnit, 0);
  };
  return {
    lowEv: extreme(true),
    highEv: extreme(false),
    method:
      'Linear extrema over bounded exhaustive-outcome simplex; bounds supplied, not inferred',
  };
}
export function fractionSettlementNet(
  decimal: number,
  fraction: number,
  commission = 0,
  fee = 0,
) {
  if (
    !Number.isFinite(decimal) ||
    decimal <= 1 ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1 ||
    !Number.isFinite(commission) ||
    commission < 0 ||
    commission >= 1 ||
    !Number.isFinite(fee) ||
    fee < 0
  )
    throw Error('Invalid settlement terms');
  return fraction * (decimal - 1) * (1 - commission) - (1 - fraction) - fee;
}
export type PriceCheck = {
  market: string;
  oddsTimestamp: string | null;
  startTime: string;
  decimalOdds: number;
  settlementRules: string;
  availability: string;
  marketStatus?: string;
};
export function validateProbabilityPrice(
  quote: PriceCheck,
  sport: string,
  now = Date.now(),
  maxAgeSec = 120,
) {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeSec) || maxAgeSec <= 0)
    throw Error('Invalid freshness policy');
  const priceTime = quote.oddsTimestamp ? Date.parse(quote.oddsTimestamp) : NaN;
  const start = Date.parse(quote.startTime);
  const age = Number.isFinite(priceTime) ? (now - priceTime) / 1000 : null;
  const candidate =
    sport === 'americanfootball_nfl'
      ? baseline
      : sport === 'baseball_mlb'
        ? mlbBaseline
        : null;
  const checks = [
    {
      key: 'odds',
      passed: Number.isFinite(quote.decimalOdds) && quote.decimalOdds > 1,
      reason: 'Decimal price must be finite and greater than one',
    },
    {
      key: 'freshness',
      passed: age !== null && age >= 0 && age <= maxAgeSec,
      reason:
        'Source quote timestamp required, no future quotes, maximum age ' +
        maxAgeSec +
        ' seconds',
    },
    {
      key: 'pregame',
      passed:
        Number.isFinite(start) &&
        start > now &&
        quote.marketStatus === 'pregame',
      reason: 'Confirmed pregame state and future kickoff required',
    },
    {
      key: 'contract',
      passed:
        quote.settlementRules !== 'UNVERIFIED' &&
        quote.settlementRules !== '' &&
        quote.settlementRules !== undefined,
      reason:
        'Verified exact settlement contract required, including participation, periods, ties and void terms',
    },
    {
      key: 'availability',
      passed: quote.availability === 'VERIFIED_AVAILABLE',
      reason: 'Account availability is unknown until verified',
    },
    {
      key: 'model_scope',
      passed: candidate !== null && quote.market === 'moneyline',
      reason:
        'An evaluated sport-specific full-game outcome candidate is required; no spread, total or prop model is supported',
    },
    // Promotion evidence comes from the deployed evaluated report, never request flags.
    {
      key: 'market_validation',
      passed: candidate?.marketBenchmark.modelImproves === true,
      reason:
        'Candidate must demonstrate improvement on comparable held-out market evidence',
    },
    {
      key: 'live_model',
      passed: candidate?.liveApproved === true,
      reason: 'Current candidate is not approved for live recommendations',
    },
    {
      key: 'uncertainty',
      passed:
        candidate !== null &&
        candidate.uncertainty.perWagerProbabilityBounds !== null,
      reason: 'Validated per-wager probability bounds required',
    },
  ];
  return {
    status: 'ABSTAIN' as const,
    modelVersion: candidate?.model.version ?? null,
    checks,
    exclusions: checks.filter((c) => !c.passed).map((c) => c.reason),
    priceAgeSeconds: age,
    independentProbability: null,
    estimatedEv: null,
    lowerBoundEv: null,
    minAcceptablePrice: null,
    expiresAt:
      age !== null
        ? new Date(priceTime + maxAgeSec * 1000).toISOString()
        : null,
  };
}
