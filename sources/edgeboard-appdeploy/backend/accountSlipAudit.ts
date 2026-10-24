import {
  contractDifferences,
  identity,
  marketKey,
  payoutCheck,
  readAccountLegs,
} from '../shared/accountSlip';
import {
  getFreeUnderdogLines,
  matchesSport,
  type FreeLine,
} from './freeUnderdog';

export function auditAccountSlip(
  input: unknown,
  publicLines: FreeLine[],
  now = Date.now(),
  sourceError: string | null = null,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Enter an exact account slip.');
  const body = input as Record<string, unknown>;
  const legs = readAccountLegs(body.legs);
  const payout = payoutCheck(body.payout, legs.length, now);
  const blockers = [...payout.issues];
  if (sourceError)
    blockers.push(
      'Public source refresh failed. The account selections were retained, and no matching price was invented.',
    );
  const contracts = legs.map((leg) =>
    [
      leg.sport,
      identity(leg.event),
      identity(leg.player),
      leg.market,
      leg.period,
    ].join('|'),
  );
  if (new Set(contracts).size !== contracts.length)
    blockers.push(
      'Duplicate, opposing or alternate versions of the same market appear in this slip.',
    );
  const comparisons = legs.map((leg) => {
    const referenceChanges = leg.reference
      ? contractDifferences(leg, leg.reference)
      : [];
    if (referenceChanges.length)
      blockers.push(
        `${leg.player}: earlier research differs in ${referenceChanges.join(', ')}. Its probability must not be reused.`,
      );
    if (!leg.accountConfirmed)
      blockers.push(
        `${leg.player}: confirm this exact selection against the account entry.`,
      );
    if (leg.period === 'UNKNOWN')
      blockers.push(`${leg.player}: the account selection period is unknown.`);
    const candidates = publicLines.filter(
      (quote) =>
        matchesSport(quote, leg.sport) &&
        identity(quote.player) === identity(leg.player) &&
        identity(quote.event) === identity(leg.event),
    );
    const matchingMarket = candidates.filter(
      (quote) => marketKey(quote.market) === leg.market,
    );
    const matchingLine = matchingMarket.filter(
      (quote) => quote.line === leg.line,
    );
    const samePeriod = matchingLine.filter(
      (quote) => quote.period === leg.period && quote.period !== 'UNKNOWN',
    );
    const exact = samePeriod.find((quote) =>
      leg.side === 'Higher' ? quote.higher : quote.lower,
    );
    const observed =
      exact ??
      matchingLine.find((quote) =>
        leg.side === 'Higher' ? quote.higher : quote.lower,
      );
    const eventTime = candidates[0]?.commenceTime;
    if (eventTime && Date.parse(eventTime) <= now)
      blockers.push(
        `${leg.player}: the public event has started; this pregame comparison is not valid for live play.`,
      );
    const status = exact
      ? 'SAME_PUBLIC_CONTRACT_ACCOUNT_PRICE_UNVERIFIED'
      : observed
        ? 'PERIOD_UNVERIFIED'
        : matchingLine.length
          ? 'SIDE_UNAVAILABLE'
          : matchingMarket.length
            ? 'LINE_MISMATCH'
            : candidates.length
              ? 'MARKET_MISMATCH'
              : 'NO_PUBLIC_MATCH';
    if (!exact)
      blockers.push(
        `${leg.player}: ${status.replace(/_/g, ' ').toLowerCase()}. The entered account line remains unchanged.`,
      );
    const offered = observed
      ? leg.side === 'Higher'
        ? observed.higher
        : observed.lower
      : null;
    if (
      observed &&
      (observed.isLive ||
        !['active', 'open', 'available'].includes(
          observed.status.toLowerCase(),
        ))
    )
      blockers.push(
        `${leg.player}: the public market is live, closed, suspended or has an unknown status.`,
      );
    return {
      account: leg,
      status,
      referenceChanges,
      publicObservation: observed
        ? {
            lineId: observed.lineId,
            market: observed.market,
            marketLabel: observed.marketLabel,
            line: observed.line,
            period: observed.period,
            decimalPrice: offered?.decimalPrice ?? null,
            observedAt: observed.observedAt,
            lineUpdatedAt: observed.lineUpdatedAt,
            source: 'Underdog public board',
            accountPriceVerified: false,
          }
        : null,
      nearbyPublicLines: matchingMarket.map((quote) => ({
        line: quote.line,
        period: quote.period,
      })),
      independentProbability: null,
      estimatedEv: null,
    };
  });
  blockers.push(
    'No approved independent probability model or validated joint probability is available for this account slip.',
  );
  blockers.push(
    'Two fresh independent reference books, equivalent settlement rules and current player availability/role evidence are still required.',
  );
  return {
    schemaVersion: 'edgeboard.account-slip.v1',
    generatedAt: new Date(now).toISOString(),
    recommendation: 'HOLD',
    recommendedStake: 0,
    sportsbook: 'Underdog (user-reported account entry)',
    accountEvidence: 'USER_ENTERED_NOT_AN_ACCEPTED_FILL',
    comparisons,
    payout,
    estimatedJointProbability: null,
    estimatedEv: null,
    blockers: [...new Set(blockers)],
    sourceError,
    noBetPlaced: true,
    paidProviderRequests: 0,
  };
}

export async function checkAccountSlip(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Enter an exact account slip.');
  const body = input as Record<string, unknown>;
  const legs = readAccountLegs(body.legs);
  // Validate the entire request before any outbound request.
  payoutCheck(body.payout, legs.length);
  const requests = [
    ...new Map(
      legs.map((leg) => [`${leg.sport}|${identity(leg.player)}`, leg]),
    ).values(),
  ];
  const results = await Promise.allSettled(
    requests.map((leg) =>
      getFreeUnderdogLines({
        sport: leg.sport,
        player: leg.player,
        limit: 1000,
      }),
    ),
  );
  const lines = new Map<string, FreeLine>();
  let sourceError: string | null = null;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.staleCacheUsed)
        sourceError =
          'Public source unavailable; cached observations are stale.';
      for (const line of result.value.lines) lines.set(line.lineId, line);
      if (result.value.truncated)
        sourceError = 'The player source response is incomplete.';
    } else sourceError = 'Public source currently unavailable.';
  }
  return auditAccountSlip(input, [...lines.values()], Date.now(), sourceError);
}
