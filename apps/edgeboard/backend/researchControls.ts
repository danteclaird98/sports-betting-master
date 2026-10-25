export type ResearchEvidence = {
  source: string;
  observedAt: string;
  detail?: string;
};

export type ResearchInput = {
  eventId: string;
  marketKey: string;
  book: string;
  decisionAt: string;
  oddsAt: string;
  featureAvailableAt: string;
  modelTrainedThrough: string;
  decimalOdds: number;
  probability: number;
  probabilityLow: number;
  probabilityHigh: number;
  marketType: 'binary_no_push' | 'unsupported';
  uncertaintyValidated: boolean;
  independentProbabilityValidated: boolean;
  eventVerified: boolean;
  marketVerified: boolean;
  sourceVerified: boolean;
  rulesVerified: boolean;
  priceAvailable: boolean;
  parlay?: boolean;
  playerProp?: boolean;
  playerAvailabilityVerified?: boolean;
  roleImpactModeled?: boolean;
  conflictingProjectionsResolved?: boolean;
  modelVersion?: string;
  deViggedComparator?: number | null;
  evidence?: string[];
  sources?: ResearchEvidence[];
};

export type ResearchResult = {
  event: string;
  market: string;
  sportsbook: string;
  oddsAt: string;
  decisionAt: string;
  featureAvailableAt: string;
  modelTrainedThrough: string;
  decimalOdds: number;
  marketImpliedProbability: number;
  marketImpliedProbabilityLabel: string;
  deViggedComparator: number | null;
  estimatedProbability: number | null;
  modelVersion: string;
  uncertainty: [number, number];
  uncertaintyMethod: string;
  uncertaintyValidated: boolean;
  independentProbabilityValidated: boolean;
  estimatedEv: number | null;
  lowerBoundEv: number | null;
  supportingEvidence: string[];
  sources: ResearchEvidence[];
  reasonsToAbstain: string[];
  status: 'ABSTAIN' | 'PASSES_RESEARCH';
};

export const RESEARCH_POLICY = {
  purpose: 'Research controls; binary, no-push markets only. Not a wagering executor.',
  maxQuoteAgeSeconds: 120,
  edgeBuffer: 0.02,
  supportedMarketType: 'binary_no_push',
  parlayPolicy: 'Marginal probability multiplication is prohibited unless a validated joint model exists.',
  uncertaintyPolicy: 'A market cannot pass research until its uncertainty method is validated on historical held-out data.',
  probabilityPolicy: 'Market-derived probabilities are benchmarks, not independent model estimates. A pass requires an independently validated probability model.',
  sourcePolicy: 'Event, market, source, rules and offered price must be verified by adapters rather than inferred.',
  playerPropPolicy: 'Player props require current official lineup/injury evidence, modeled role impact and reconciliation of conflicting projections. Missing evidence means ABSTAIN.',
  evaluationPolicy: 'Chronological train/validation/test partitions must prevent future information, event overlap and unsettled-label leakage.',
  clvPolicy: 'CLV requires the exact event, side, line, period and settlement rules at a fixed pregame closing cutoff.',
  executionPolicy: 'Advertised prices are not accepted fills. Rejections, missing prices, limits and settlement revisions must be retained.',
  calibrationStatus: 'LIVE MODEL NOT APPROVED. An on-demand historical 2025 NFL prop reliability test exists, but no validated live probability or per-wager uncertainty estimator is connected.',
};

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`invalid ${label}`);
}

export function parseResearchTime(value: string) {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error('timezone required');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('invalid timestamp');
  return millis;
}

export function decimalImpliedProbability(decimal: number) {
  finite(decimal, 'odds');
  if (decimal <= 1) throw new Error('invalid odds');
  return 1 / decimal;
}

export function americanToDecimal(american: number) {
  finite(american, 'american odds');
  if (Math.abs(american) < 100) throw new Error('invalid american odds');
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number) {
  decimalImpliedProbability(decimal);
  return decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
}

export function deVigProportional(decimals: number[]) {
  if (decimals.length < 2) throw new Error('matched outcomes required');
  const raw = decimals.map(decimalImpliedProbability);
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('invalid market margin');
  return {
    margin: total - 1,
    raw,
    fair: raw.map(value => value / total),
  };
}

export function fairTwoWay(sideDecimal: number, otherDecimal: number) {
  return deVigProportional([sideDecimal, otherDecimal]).fair[0];
}

export function expectedNetProfitPerUnit(input: {
  pWin: number;
  pLoss: number;
  pPush?: number;
  pVoid?: number;
  decimalOdds: number;
  commissionPct?: number;
}) {
  const pPush = input.pPush ?? 0;
  const pVoid = input.pVoid ?? 0;
  const values = [input.pWin, input.pLoss, pPush, pVoid];
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('invalid settlement probability');
  }
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-6) {
    throw new Error('settlement probabilities must sum to 1');
  }
  decimalImpliedProbability(input.decimalOdds);
  const commission = input.commissionPct ?? 0;
  if (!Number.isFinite(commission) || commission < 0 || commission >= 1) {
    throw new Error('invalid commission');
  }
  const grossWin = input.decimalOdds - 1;
  const netWin = grossWin * (1 - commission);
  return input.pWin * netWin - input.pLoss;
}

export function scoreProbabilities(probabilities: number[], outcomes: number[]) {
  if (!probabilities.length || probabilities.length !== outcomes.length) {
    throw new Error('empty or unequal samples');
  }
  if (probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) {
    throw new Error('invalid probability');
  }
  if (outcomes.some(y => y !== 0 && y !== 1)) throw new Error('binary outcomes required');

  const clipped = probabilities.map(p => Math.max(1e-12, Math.min(1 - 1e-12, p)));
  const reliability: Array<{ n: number; predicted: number; observed: number }> = [];
  for (let bucket = 0; bucket < 10; bucket += 1) {
    const indexes = probabilities
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => Math.min(9, Math.floor(p * 10)) === bucket)
      .map(({ i }) => i);
    if (!indexes.length) continue;
    reliability.push({
      n: indexes.length,
      predicted: indexes.reduce((sum, i) => sum + probabilities[i], 0) / indexes.length,
      observed: indexes.reduce((sum, i) => sum + outcomes[i], 0) / indexes.length,
    });
  }
  const brier = probabilities.reduce((sum, p, i) => sum + (p - outcomes[i]) ** 2, 0) / probabilities.length;
  const logLoss = -clipped.reduce(
    (sum, p, i) => sum + outcomes[i] * Math.log(p) + (1 - outcomes[i]) * Math.log(1 - p),
    0
  ) / probabilities.length;
  const ece = reliability.reduce(
    (sum, bin) => sum + (bin.n / probabilities.length) * Math.abs(bin.predicted - bin.observed),
    0
  );
  return { n: probabilities.length, brier, logLoss, ece, reliability };
}

export type PartitionRow = {
  event_id: string;
  decision_at: string;
  feature_available_at: string;
  model_trained_through: string;
  settled_at: string;
};

export function partitionChronologically<T extends PartitionRow>(
  rows: T[],
  validationStart: string,
  testStart: string
): [T[], T[], T[]] {
  const validation = parseResearchTime(validationStart);
  const test = parseResearchTime(testStart);
  if (validation >= test) throw new Error('invalid boundaries');
  const groups: [T[], T[], T[]] = [[], [], []];
  const eventGroups = new Map<string, number>();

  for (const row of rows) {
    const decision = parseResearchTime(row.decision_at);
    const group = decision < validation ? 0 : decision < test ? 1 : 2;
    const prior = eventGroups.get(row.event_id);
    if (prior !== undefined && prior !== group) throw new Error('event crosses split; purge it');
    eventGroups.set(row.event_id, group);

    if (
      parseResearchTime(row.feature_available_at) > decision ||
      parseResearchTime(row.model_trained_through) >= decision
    ) {
      throw new Error('future information');
    }
    groups[group].push(row);
  }

  if (groups.some(group => group.length === 0)) throw new Error('empty chronological period');
  for (const group of [0, 1] as const) {
    const boundary = group === 0 ? validation : test;
    if (groups[group].some(row => parseResearchTime(row.settled_at) >= boundary)) {
      throw new Error('unsettled labels cross boundary');
    }
  }
  return groups;
}

export function evaluateResearch(
  input: ResearchInput,
  maxAgeSeconds = RESEARCH_POLICY.maxQuoteAgeSeconds,
  edgeBuffer = RESEARCH_POLICY.edgeBuffer
): ResearchResult {
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0 ||
      !Number.isFinite(edgeBuffer) || edgeBuffer < 0) {
    throw new Error('invalid research policy thresholds');
  }
  const reasons: string[] = [];
  const decision = parseResearchTime(input.decisionAt);
  const oddsAt = parseResearchTime(input.oddsAt);
  const quoteAge = (decision - oddsAt) / 1000;

  if (quoteAge < 0 || quoteAge > maxAgeSeconds) reasons.push('stale or future quote');
  if (parseResearchTime(input.featureAvailableAt) > decision) reasons.push('future feature');
  if (parseResearchTime(input.modelTrainedThrough) >= decision) reasons.push('model training cutoff is not before decision time');

  const flags: Array<[boolean, string]> = [
    [input.eventVerified, 'event_verified missing'],
    [input.marketVerified, 'market_verified missing'],
    [input.sourceVerified, 'source_verified missing'],
    [input.rulesVerified, 'rules_verified missing'],
    [input.priceAvailable, 'price_available missing'],
  ];
  for (const [ok, reason] of flags) if (ok !== true) reasons.push(reason);

  if (input.marketType !== 'binary_no_push') reasons.push('unsupported push/void/partial settlement');
  if (input.playerProp) {
    if (input.playerAvailabilityVerified !== true) reasons.push('current player lineup and injury status unverified');
    if (input.roleImpactModeled !== true) reasons.push('lineup-dependent usage and role changes not modeled');
    if (input.conflictingProjectionsResolved !== true) reasons.push('independent projection conflicts not reconciled');
  }
  if (input.uncertaintyValidated !== true) reasons.push('uncertainty not validated');
  if (input.independentProbabilityValidated !== true) reasons.push('independent probability model not validated');
  if (input.parlay) reasons.push('joint model required; marginal multiplication prohibited');

  const { probability, probabilityLow, probabilityHigh } = input;
  if (
    ![probabilityLow, probability, probabilityHigh].every(Number.isFinite) ||
    probabilityLow < 0 ||
    probability < probabilityLow ||
    probabilityHigh < probability ||
    probabilityHigh > 1
  ) {
    throw new Error('invalid uncertainty');
  }

  const marketImpliedProbability = decimalImpliedProbability(input.decimalOdds);
  const estimatedEv = probability * input.decimalOdds - 1;
  const lowerBoundEv = probabilityLow * input.decimalOdds - 1;
  if (lowerBoundEv <= edgeBuffer) reasons.push('lower probability bound does not clear EV buffer');

  return {
    event: input.eventId,
    market: input.marketKey,
    sportsbook: input.book,
    oddsAt: input.oddsAt,
    decisionAt: input.decisionAt,
    featureAvailableAt: input.featureAvailableAt,
    modelTrainedThrough: input.modelTrainedThrough,
    decimalOdds: input.decimalOdds,
    marketImpliedProbability,
    marketImpliedProbabilityLabel: 'raw implied probability; vig may be present',
    deViggedComparator: input.deViggedComparator ?? null,
    estimatedProbability: input.independentProbabilityValidated ? probability : null,
    modelVersion: input.modelVersion ?? 'unversioned-screen',
    uncertainty: [probabilityLow, probabilityHigh],
    uncertaintyMethod: input.uncertaintyValidated ? 'validated method supplied by adapter' : 'unvalidated screening range',
    uncertaintyValidated: input.uncertaintyValidated,
    independentProbabilityValidated: input.independentProbabilityValidated,
    estimatedEv: input.independentProbabilityValidated ? estimatedEv : null,
    lowerBoundEv: input.independentProbabilityValidated && input.uncertaintyValidated ? lowerBoundEv : null,
    supportingEvidence: input.evidence ?? [],
    sources: input.sources ?? [],
    reasonsToAbstain: reasons,
    status: reasons.length ? 'ABSTAIN' : 'PASSES_RESEARCH',
  };
}

export function settleResearchOutcome(
  outcome: 'win' | 'loss' | 'push' | 'void',
  stake: number,
  decimalOdds: number,
  limit: number,
  accepted: boolean
) {
  decimalImpliedProbability(decimalOdds);
  if (![stake, limit].every(Number.isFinite) || Math.min(stake, limit) < 0) {
    throw new Error('invalid stake/limit');
  }
  if (!['win', 'loss', 'push', 'void'].includes(outcome) || typeof accepted !== 'boolean') {
    throw new Error('invalid settlement outcome or acceptance');
  }
  const filled = accepted ? Math.min(stake, limit) : 0;
  const profit = outcome === 'win'
    ? filled * (decimalOdds - 1)
    : outcome === 'loss'
      ? -filled
      : 0;
  return { filled, profit };
}

export function priceClv(
  entryOdds: number,
  closeSideOdds: number,
  closeOtherOdds: number,
  entryKey: string,
  closeKey: string
) {
  if (entryKey !== closeKey) return null;
  return entryOdds * fairTwoWay(closeSideOdds, closeOtherOdds) - 1;
}

export function getResearchPolicy() {
  return {
    ...RESEARCH_POLICY,
    implemented: [
      'American and decimal odds conversion',
      'implied probability and proportional multi-outcome de-vig',
      'push-aware expected net profit utility',
      'timezone-aware chronological partition controls',
      'future-feature and model-cutoff rejection',
      'binary Brier score, log loss, ECE and reliability bins',
      'source/identity/rules/price verification gates',
      'current player availability, role and model-disagreement fail-closed gates',
      'lower-bound EV abstention',
      'unsupported parlay probability multiplication prohibition',
      'limit/rejection-aware settlement arithmetic',
      'exact-contract CLV matching',
    ],
    historicalValidation: {
      calibration: 'NOT MEASURED',
      brier: 'NOT MEASURED',
      logLoss: 'NOT MEASURED',
      clv: 'NOT MEASURED',
      returns: 'NOT MEASURED',    },
  };
}
