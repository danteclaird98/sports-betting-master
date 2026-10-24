export const EDGE_MODEL_VERSION = 'kym-market-screen-only-v2';

export const BANKROLL_POLICY = {
  modelVersion: EDGE_MODEL_VERSION,
  bankrollInputRequired: true,
  sizingMethod:
    'Calculation support only; no live stake recommendation without validated outcome evidence',
  noInferredBankroll: true,
  maxSingleMainPct: 1,
  maxSinglePropPct: 1,
  maxSlipPct: 0.5,
  maxCorrelatedGamePct: 3,
  maxDailyRiskPct: 5,
  stopAfterDrawdownPct: 4,
  parlayRule:
    'No correlated parlay staking unless correlation is explicitly modeled.',
  promoRule:
    'Boosts are evaluated by fair-value math; payout appeal alone is ignored.',
  humanConfirmation: 'Required. EdgeBoard never places bets automatically.',
  rules: [
    'Do not bet if the signal expires before you submit.',
    'Recheck the exact line, side and price in the target book before acting.',
    'Skip if the market moved past the max acceptable line or price.',
    'Risk less when only two independent sportsbook sources are available.',
    'Track the closing line and actual fill for calibration.',
  ],
};

export type ScoreKymInput = {
  marketType: 'spread' | 'total';
  pick: string;
  lineAdvantage: number;
  consensusRange: number;
  refCount: number;
  keyNumberCrossed: boolean;
  consensusLine: number;
  predictionConsensus: number | null;
  commenceTime: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function americanToDecimal(price: number) {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

export function getBankrollPolicy() {
  return BANKROLL_POLICY;
}

export function scoreKymEdge(input: ScoreKymInput) {
  const kickoff = Date.parse(input.commenceTime);
  return {
    modelVersion: 'kym-market-screen-only-v2',
    fairProbability: null,
    fairProbabilityLow: null,
    fairProbabilityHigh: null,
    breakEvenProbability: null,
    estimatedEvPct: null,
    conservativeEvPct: null,
    signalScore: null,
    maxAcceptablePrice: null,
    maxAcceptableLine: input.pick,
    stakeSuggestion:
      'No stake recommended: independent probability and exact contest payout/rules are unvalidated.',
    expiresAt: Number.isFinite(kickoff)
      ? new Date(kickoff - 60_000).toISOString()
      : null,
    reverifyInstruction:
      'Compare the exact contest question, line, period and grading rules. Line advantage alone does not establish probability or EV.',
    qualityWarnings: [
      'Market comparison only; heuristic probability and assumed -110 execution price removed.',
    ],
    uncertaintyDiscountPct: null,
    recommendation: 'PASS',
    action: 'WAIT' as const,
    status: 'watch' as const,
  };
}

