export type AuditLeg = {
  event: string;
  market: string;
  selection: string;
  americanOdds: number;
  pushPossible?: boolean | null;
  sportsbook?: string;
  sourceObservedAt?: string | null;
  eventStartsAt?: string | null;
};

type AuditInput = {
  legs?: AuditLeg[];
  combinedAmericanOdds?: number;
  kind?: 'ordinary' | 'same_game';
  bankroll?: number;
  existingExposure?: number;
  stake?: number;
};

function decimal(american: number) {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}
function validAmerican(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) >= 100 && Math.abs(value) <= 100000;
}
function dateFromUser(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function auditParlay(input: unknown, now = Date.now()) {
  const body = input as AuditInput;
  if (!body || !Array.isArray(body.legs) || body.legs.length < 2 || body.legs.length > 8) {
    throw Error('Provide between two and eight legs.');
  }
  const kind = body.kind ?? 'ordinary';
  if (kind !== 'ordinary' && kind !== 'same_game') throw Error('Invalid parlay kind.');
  if (body.combinedAmericanOdds !== undefined && !validAmerican(body.combinedAmericanOdds)) {
    throw Error('Combined American price must be valid odds, e.g. +248 or -110.');
  }
  const legs = body.legs.map((leg, index) => {
    if (!leg || typeof leg.event !== 'string' || !leg.event.trim() ||
        typeof leg.market !== 'string' || !leg.market.trim() ||
        typeof leg.selection !== 'string' || !leg.selection.trim() ||
        !validAmerican(leg.americanOdds) ||
        (leg.pushPossible !== null && leg.pushPossible !== undefined && typeof leg.pushPossible !== 'boolean')) {
      throw Error('Invalid market, selection, push state, or odds for leg ' + (index + 1));
    }
    const observed = dateFromUser(leg.sourceObservedAt);
    const started = dateFromUser(leg.eventStartsAt);
    return {
      event: leg.event.trim(),
      market: leg.market.trim(),
      selection: leg.selection.trim(),
      sportsbook: leg.sportsbook?.trim() || 'User-entered',
      americanOdds: leg.americanOdds,
      decimalOdds: decimal(leg.americanOdds),
      rawImpliedProbability: 1 / decimal(leg.americanOdds),
      pushPossible: leg.pushPossible ?? null,
      userReportedQuoteAgeSeconds: observed === null ? null : Math.round((now - observed) / 1000),
      freshnessVerified: false,
      userReportedUpcoming: started === null ? null : started > now,
      eventStartVerified: false,
    };
  });
  const actual = body.combinedAmericanOdds;
  const combinedDecimal = actual === undefined ? null : decimal(actual);
  const hasPotentialPush = legs.some(leg => leg.pushPossible !== false);
  const duplicatedEvents = new Set(legs.map(leg => leg.event.toLowerCase())).size !== legs.length;
  const blockers = [
    'No independently validated per-leg outcome probabilities or uncertainty intervals.',
    'No validated joint-outcome distribution or correlation model.',
    'Quotes, event time, account availability and Nevada settlement terms are user-entered or unverified.',
  ];
  if (combinedDecimal === null) blockers.push('Actual sportsbook combined price is missing.');
  if (hasPotentialPush) blockers.push('At least one leg may push or has unknown push behavior; a single break-even percentage is incomplete.');
  if (duplicatedEvents || kind === 'same_game') blockers.push('Same-game selections require approved correlation and accepted SGP repricing evidence.');
  const pushIllustrations = legs.map((leg, index) => {
    if (leg.pushPossible === false) return null;
    const remaining = legs.filter((_, i) => i !== index);
    return {
      ifLegPushes: index + 1,
      ifAllOtherLegsWin: kind === 'ordinary'
        ? { grossReturnPerUnit: remaining.reduce((v, next) => v * next.decimalOdds, 1),
            netProfitPerUnit: remaining.reduce((v, next) => v * next.decimalOdds, 1) - 1 }
        : null,
      assumption: kind === 'ordinary'
        ? 'Illustrative ordinary parlay; push removes this leg if the applicable Nevada rules agree.'
        : 'Same-game push payout is unknown without an accepted repriced SGP quote.',
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);

  const jointEvFormula = combinedDecimal !== null && legs.length === 2 && kind === 'ordinary'
    ? {
        statement: 'EV = combinedDecimal * P(both win) + leg1Decimal * P(leg1 wins, leg2 pushes) + leg2Decimal * P(leg1 pushes, leg2 wins) + P(both push) - 1.',
        note: 'Joint probabilities are unknown. For all other loss branches gross return is zero; void and special promotion rules require separately verified contracts.',
        coefficients: {
          bothWin: combinedDecimal,
          leg1WinsLeg2Pushes: legs[0].decimalOdds,
          leg1PushesLeg2Wins: legs[1].decimalOdds,
          bothPush: 1,
        },
      }
    : null;
  const bankroll = body.bankroll, existingExposure = body.existingExposure, stake = body.stake;
  const hasRisk = typeof bankroll === 'number' && Number.isFinite(bankroll) && bankroll > 0 &&
    typeof existingExposure === 'number' && Number.isFinite(existingExposure) && existingExposure >= 0;
  if (stake !== undefined && (typeof stake !== 'number' || !Number.isFinite(stake) || stake < 0)) {
    throw Error('Invalid requested stake.');
  }
  return {
    schemaVersion: 'edgeboard.parlay.audit.v2',
    generatedAt: new Date(now).toISOString(),
    status: 'BLOCKED',
    source: 'User-entered sportsbook snapshot, not authenticated Caesars or a verified feed',
    researchOnly: true,
    recommendationEnabled: false,
    kind,
    legs,
    actualCombinedAmericanOdds: actual ?? null,
    grossIfAllWinPerUnit: combinedDecimal,
    headlinePayoutThreshold: combinedDecimal === null ? null : 1 / combinedDecimal,
    headlineThresholdMeaning: 'Break-even only in a binary all-win/all-loss settlement with no pushes, voids, fees or boosts.',
    offeredBreakEvenProbability: combinedDecimal && !hasPotentialPush && kind === 'ordinary' ? 1 / combinedDecimal : null,
    pushAwareEv: null,
    estimatedJointProbability: null,
    estimatedEv: null,
    pushIllustrations,
    jointEvFormula,
    independentlyMultipliedPriceNotExecutable: legs.reduce((v, leg) => v * leg.decimalOdds, 1),
    blockers,
    risk: hasRisk ? {
      bankroll,
      existingExposure,
      requestedStake: stake ?? null,
      dashboardMaxSlipStake: bankroll * 0.005,
      dashboardMaxDailyRisk: bankroll * 0.05,
      remainingUnderUserDailyTenDollarCap: Math.max(0, 10 - existingExposure),
      exceedsOnePercentGuideline: stake === undefined ? null : stake > bankroll * 0.01,
      exceedsParlayGuideline: stake === undefined ? null : stake > bankroll * 0.005,
      recommendedStake: 0,
    } : { recommendedStake: 0 },
    noBetPlaced: true,
  };
}

