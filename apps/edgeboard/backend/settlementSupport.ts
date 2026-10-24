import baseline from './nflBaselineReport.json';
import mlbBaseline from './mlbBaselineReport.json';
import { settlementEv } from './probabilityPrice';

export const SETTLEMENT_REFERENCES = [
  {
    id: 'draftkings-listed-pitchers-reference',
    book: 'draftkings',
    status: 'REFERENCE_ONLY_NOT_WAGER_VERIFIED',
    source: 'https://sportsbook.draftkings.com/help/glossary',
    checkedAt: '2026-10-06',
    topic:
      'A Listed Pitchers wager is void if a required listed pitcher does not start.',
    appliesAutomatically: false,
    missing: [
      'Exact ticket action/listed-pitcher designation',
      'Applicable jurisdiction and current sport-specific terms',
    ],
  },
  {
    id: 'draftkings-ordinary-parlay-reference',
    book: 'draftkings',
    status: 'REFERENCE_ONLY_NOT_WAGER_VERIFIED',
    source:
      'https://support.draftkings.com/dk/en-us/glossary-of-betting-terms?id=kb_article_view&sysparm_article=KB0010398',
    checkedAt: '2026-10-06',
    topic:
      'Ordinary parlay push/void legs are excluded and remaining odds recalculated; SGP requires sport-specific rules.',
    appliesAutomatically: false,
    missing: [
      'Ordinary versus same-game designation',
      'Exact contract, remaining-leg prices and applicable jurisdiction',
    ],
  },
];

type LegStatus = 'win' | 'loss' | 'push' | 'void';
export type JointScenario = {
  statuses: LegStatus[];
  probability: number;
  // Required for SGP push/void branches: an actual quoted repriced payout,
  // including returned stake. Never derive an SGP price from leg odds.
  repricedGross?: number;
};
export function gradeJointScenarios(input: {
  legDecimals: number[];
  actualDecimalPrice: number;
  kind: 'ordinary' | 'same_game';
  scenarios: JointScenario[];
  commission?: number;
  feePerUnit?: number;
}) {
  const n = input.legDecimals.length;
  if (
    n < 2 ||
    n > 4 ||
    input.legDecimals.some((d) => !Number.isFinite(d) || d <= 1) ||
    !Number.isFinite(input.actualDecimalPrice) ||
    input.actualDecimalPrice <= 1 ||
    !['ordinary', 'same_game'].includes(input.kind)
  )
    throw Error(
      'Require two to four valid legs and an actual combination price',
    );
  const commission = input.commission ?? 0,
    fee = input.feePerUnit ?? 0;
  if (
    !Number.isFinite(commission) ||
    commission < 0 ||
    commission >= 1 ||
    !Number.isFinite(fee) ||
    fee < 0
  )
    throw Error('Invalid commission or fee');
  const keys = new Set<string>();
  const outcomes = input.scenarios.map((s) => {
    if (
      s.statuses.length !== n ||
      s.statuses.some((v) => !['win', 'loss', 'push', 'void'].includes(v))
    )
      throw Error('Invalid joint settlement state');
    const key = s.statuses.join('|');
    if (keys.has(key)) throw Error('Duplicate joint settlement state');
    keys.add(key);
    let gross: number;
    if (s.statuses.includes('loss')) gross = 0;
    else if (s.statuses.every((v) => v === 'win'))
      gross = input.actualDecimalPrice;
    else if (!s.statuses.includes('win')) gross = 1;
    else if (input.kind === 'same_game') {
      if (!Number.isFinite(s.repricedGross) || s.repricedGross! <= 1)
        throw Error(
          'Actual SGP repriced payout required for partial void/push branch',
        );
      gross = s.repricedGross!;
    } else
      gross = s.statuses.reduce(
        (v, status, i) => (status === 'win' ? v * input.legDecimals[i] : v),
        1,
      );
    return {
      name: key,
      probability: s.probability,
      netPerUnit: gross - 1 - Math.max(0, gross - 1) * commission - fee,
    };
  });
  // Require all 4^n branches, even explicitly zero-probability branches.
  // This prevents an omitted push or void from silently becoming impossible.
  if (keys.size !== 4 ** n)
    throw Error(
      'Incomplete joint distribution: enumerate win/loss/push/void for every leg',
    );
  return {
    outcomes,
    evPerUnit: settlementEv(outcomes),
    probabilityPolicy:
      'Supplied joint distribution, never products of marginal probabilities',
    calculationOnly: true,
    probabilityValidated: false,
    settlementConvention:
      'Unboosted ordinary parlay: remove push/void legs; any loss loses; all push/void returns stake. Same-game partial branches require explicit quoted payouts. Other book/promotion rules require a separate contract adapter.',
  };
}

export function boundedStake(input: {
  outcomes: Array<{ name: string; probability: number; netPerUnit: number }>;
  bankroll: number;
  singleCap: number;
  remainingDaily: number;
  remainingExposure: number;
  remainingCorrelatedExposure: number;
  minimumStake: number;
  stakeIncrement: number;
}) {
  const ev = settlementEv(input.outcomes);
  const amounts = [
    input.bankroll,
    input.singleCap,
    input.remainingDaily,
    input.remainingExposure,
    input.remainingCorrelatedExposure,
    input.minimumStake,
    input.stakeIncrement,
  ];
  if (
    amounts.some((v) => !Number.isFinite(v) || v < 0) ||
    input.bankroll <= 0 ||
    input.stakeIncrement <= 0 ||
    input.outcomes.some((o) => o.netPerUnit < -1)
  )
    throw Error('Invalid bankroll, limits, increment or loss exposure');
  if (ev <= 0)
    return {
      calculationOnly: true,
      stake: 0,
      reason: 'No positive supplied EV',
    };
  const derivative = (fraction: number) =>
    input.outcomes.reduce(
      (sum, o) =>
        sum + (o.probability * o.netPerUnit) / (1 + fraction * o.netPerUnit),
      0,
    );
  let lo = 0,
    hi = 1 - 1e-9;
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (derivative(mid) > 0) lo = mid;
    else hi = mid;
  }
  const cap = Math.min(
    (input.bankroll * lo) / 4,
    input.bankroll,
    input.singleCap,
    input.remainingDaily,
    input.remainingExposure,
    input.remainingCorrelatedExposure,
  );
  const rounded =
    Math.floor((cap + 1e-10) / input.stakeIncrement) * input.stakeIncrement;
  return {
    calculationOnly: true,
    stake: rounded < input.minimumStake ? 0 : rounded,
    reason:
      rounded < input.minimumStake
        ? 'Below minimum stake; never round up past a limit'
        : 'Quarter Kelly from supplied exhaustive outcomes, bounded by every limit; not a recommendation',
  };
}

export function getRecommendationReadiness() {
  return {
    recommendationsEnabled: false,
    modelRegistry: [
      {
        version: baseline.model.version,
        scope: baseline.scope,
        liveApproved: baseline.liveApproved,
        marketBenchmark: baseline.marketBenchmark,
        promotionBlockers: baseline.promotionBlockers,
      },
      {
        version: mlbBaseline.model.version,
        scope: mlbBaseline.scope,
        liveApproved: mlbBaseline.liveApproved,
        predictiveEvidence: mlbBaseline.predictiveEvidence,
        heldOutSamples: mlbBaseline.test.n,
        marketBenchmark: mlbBaseline.marketBenchmark,
        promotionBlockers: mlbBaseline.promotionBlockers,
        reportPath: '/api/mlb-baseline-report',
      },
    ],
    settlementReferences: SETTLEMENT_REFERENCES,
    verifiedLiveContracts: [],
    jointModelRegistry: [],
    blockers: [
      'No independently approved live model: NFL failed the archived market comparison; MLB has no historical executable-price benchmark.',
      'No validated per-wager uncertainty or joint-outcome model.',
      'Reference rules do not identify the exact ticket, jurisdiction, period or participation terms.',
      'Actual account price, acceptance limits and combination/repriced payouts are not verified.',
    ],
    implemented: [
      'Exhaustive joint settlement arithmetic',
      'Push/void ordinary-parlay repricing',
      'Explicit actual SGP branch-price requirement',
      'Fee and commission accounting',
      'Quarter-Kelly calculation bounded by spending and correlated-exposure limits',
    ],
    executionEnabled: false,
  };
}
