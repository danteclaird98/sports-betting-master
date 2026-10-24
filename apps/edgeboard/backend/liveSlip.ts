import { object, text, numeric, type LiveQuote } from './liveTypes';
import { publicGameProps } from './liveOdds';
import { enrichLiveQuotes } from './liveResearch';
import { readLiveSnapshots } from './liveQuoteStorage';
import { liveGame } from './liveGames';

export function boostedDecimal(base: number, percent: number, kind: string) {
  if (
    !Number.isFinite(base) ||
    base <= 1 ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 200
  )
    throw Error('Valid payout and boost percentage are required.');
  if (kind === 'profit') return 1 + (base - 1) * (1 + percent / 100);
  if (kind === 'return') return base * (1 + percent / 100);
  throw Error(
    'Choose profit boost or total-return boost using the actual offer terms.',
  );
}
export function jointFrechetBounds(bounds: Array<[number, number]>) {
  if (
    !bounds.length ||
    bounds.some(
      ([low, high]) =>
        !Number.isFinite(low) ||
        !Number.isFinite(high) ||
        low < 0 ||
        high > 1 ||
        low > high,
    )
  )
    throw Error('Invalid probability stress bounds.');
  return {
    low: Math.max(
      0,
      bounds.reduce((sum, [low]) => sum + low, 0) - bounds.length + 1,
    ),
    high: Math.min(...bounds.map(([, high]) => high)),
    meaning:
      'Fréchet sensitivity bounds without independence; not a fitted correlation model or joint-probability confidence interval',
  };
}
function american(price: number) {
  if (
    !Number.isFinite(price) ||
    Math.abs(price) < 100 ||
    Math.abs(price) > 100000
  )
    throw Error('Enter valid accepted combined American odds, e.g. +250.');
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}
export function auditLiveSlip(
  input: unknown,
  available: Array<
    LiveQuote & {
      estimate?: {
        probability: number;
        probabilityLow: number;
        probabilityHigh: number;
      } | null;
    }
  >,
  now = Date.now(),
) {
  const body = object(input);
  if (
    !Array.isArray(body.quoteIds) ||
    body.quoteIds.length < 2 ||
    body.quoteIds.length > 4 ||
    new Set(body.quoteIds).size !== body.quoteIds.length
  )
    throw Error('Select two to four distinct current market sides.');
  const quotes = body.quoteIds.map((id) =>
    available.find((quote) => quote.id === id),
  );
  if (quotes.some((quote) => !quote))
    throw Error(
      'One or more selections no longer match the current server quote snapshot. Refresh prices.',
    );
  const legs = quotes as NonNullable<(typeof quotes)[number]>[];
  const blockers: string[] = [];
  if (new Set(legs.map((leg) => leg.book)).size !== 1)
    blockers.push(
      'Selections at different books do not form one executable slip.',
    );
  const contracts = legs.map((leg) =>
    [leg.eventId, leg.player ?? '', leg.market, leg.period].join('|'),
  );
  if (new Set(contracts).size !== contracts.length)
    blockers.push(
      'Duplicate, opposing or alternate versions of the same market cannot be treated as separate independent legs.',
    );
  if (legs.some((leg) => leg.period !== '2H'))
    blockers.push(
      'This draft contains a full-game or unknown-period selection, not an entirely second-half slip.',
    );
  for (const leg of legs) {
    const age = leg.oddsAt
      ? (now - Date.parse(leg.oddsAt)) / 1000
      : leg.ageSeconds === null
        ? null
        : leg.ageSeconds + (now - Date.parse(leg.retrievedAt)) / 1000;
    if (age === null || age < 0 || age > 90)
      blockers.push(
        'Missing, future or older-than-90-second price: ' +
          (leg.player ?? leg.side),
      );
    if (!['open', 'active', 'available'].includes(leg.status.toLowerCase()))
      blockers.push(
        'Market open status is not confirmed: ' + (leg.player ?? leg.side),
      );
    if (!leg.settlementRules)
      blockers.push(
        'Participation, overtime, void and push rules are unverified: ' +
          (leg.player ?? leg.side),
      );
    if (!leg.estimate)
      blockers.push(
        'No applicable independent probability estimate: ' +
          (leg.player ?? leg.side),
      );
  }
  const offered = numeric(body.combinedAmericanOdds);
  let payout = offered === null ? null : american(offered);
  const boost = object(body.boost);
  const boostPercent = numeric(boost.percent) ?? 0;
  if (boostPercent < 0 || boostPercent > 200)
    throw Error('Boost percentage must be between 0 and 200.');
  if (boostPercent > 0) {
    const maxStake = numeric(boost.maxStake),
      minLegs = numeric(boost.minLegs),
      minimumOdds = numeric(boost.minimumAmericanOdds);
    const expires = Date.parse(text(boost.expiresAt));
    if (
      boost.rulesConfirmed !== true ||
      !Number.isFinite(expires) ||
      expires <= now ||
      maxStake === null ||
      maxStake <= 0 ||
      minLegs === null
    )
      blockers.push(
        'Complete current boost rules and user confirmation of account eligibility are required.',
      );
    if (minLegs !== null && legs.length < minLegs)
      blockers.push('Slip does not meet the boost minimum leg count.');
    if (
      minimumOdds !== null &&
      payout !== null &&
      payout < american(minimumOdds)
    )
      blockers.push('Combined odds do not meet the boost minimum price.');
    if (
      text(boost.book) &&
      legs.some((leg) => leg.book !== text(boost.book).toLowerCase())
    )
      blockers.push('Boost sportsbook does not match every selection.');
    if (payout !== null)
      payout = boostedDecimal(payout, boostPercent, text(boost.kind));
  }
  if (boostPercent > 0)
    blockers.push(
      'Boosted return is face value only. Cash versus bonus credit and conversion value are unverified; use Check my slip for bonus-aware payout requirements.',
    );
  if (payout === null)
    blockers.push(
      'Actual accepted sportsbook combined payout is missing; side prices are not multiplied into an SGP offer.',
    );
  const bankroll = numeric(body.bankroll),
    stake = numeric(body.stake),
    daily = numeric(body.dailyExposure),
    game = numeric(body.gameExposure);
  if (
    (bankroll !== null && bankroll <= 0) ||
    (stake !== null && stake < 0) ||
    (daily !== null && daily < 0) ||
    (game !== null && game < 0)
  )
    throw Error(
      'Bankroll must be positive; stake and exposure cannot be negative.',
    );
  if (daily === null || game === null)
    blockers.push(
      'Current daily and game exposure must be confirmed; missing exposure is not zero.',
    );
  const maxParlay =
    bankroll === null || daily === null || game === null
      ? null
      : Math.max(
          0,
          Math.min(
            bankroll * 0.005,
            bankroll * 0.05 - daily,
            bankroll * 0.03 - game,
            boostPercent > 0 ? (numeric(boost.maxStake) ?? 0) : Infinity,
          ),
        );
  if (bankroll === null)
    blockers.push(
      'Latest confirmed bankroll is missing; no old balance was assumed.',
    );
  if (stake !== null && maxParlay !== null && stake > maxParlay + 1e-9)
    blockers.push(
      'Requested stake exceeds a 0.5% parlay, 3% game, 5% daily or promotion limit.',
    );
  blockers.push(
    'The independent models remain retrospective research candidates, not live-approved betting models.',
  );
  blockers.push(
    'No validated same-game correlation model or accepted account price verification.',
  );
  blockers.push(
    'Two fresh independent reference books and equivalent grading rules are required before a betting recommendation.',
  );
  const probabilities = legs
    .map((leg) => leg.estimate)
    .filter(
      (estimate): estimate is NonNullable<typeof estimate> =>
        estimate !== null && estimate !== undefined,
    );
  const jointRange =
    probabilities.length === legs.length
      ? jointFrechetBounds(
          probabilities.map((estimate) => [
            estimate.probabilityLow,
            estimate.probabilityHigh,
          ]),
        )
      : null;
  return {
    recommendation: 'HOLD',
    recommendedStake: 0,
    legs,
    actualCombinedAmericanOdds: offered,
    boostedDecimalPayout: payout,
    headlineBreakEvenProbability:
      payout === null || boostPercent > 0 ? null : 1 / payout,
    faceValueBreakEvenProbability: payout === null ? null : 1 / payout,
    breakEvenMeaning:
      'Binary all-win/all-loss threshold only; actual push/void/DFS flex and boost credit rules must match.',
    estimatedJointProbability: null,
    estimatedEv: null,
    jointStressRange: jointRange,
    jointStressEvRange:
      jointRange && payout !== null && boostPercent === 0
        ? {
            low: jointRange.low * payout - 1,
            high: jointRange.high * payout - 1,
          }
        : null,
    risk: {
      bankroll,
      requestedStake: stake,
      maxParlayCapBeforeModelApproval: maxParlay,
      dailyExposure: daily,
      gameExposure: game,
    },
    blockers: [...new Set(blockers)],
    boostRulesSource:
      'User-reported account terms; not independently account-verified',
    noBetPlaced: true,
  };
}
export async function analyzeLiveSlip(input: unknown, userId?: string) {
  const body = object(input),
    eventId = text(body.eventId);
  if (
    !Array.isArray(body.quoteIds) ||
    body.quoteIds.length < 2 ||
    body.quoteIds.length > 4
  )
    throw Error('Select two to four current quote IDs.');
  const needsPublic = body.quoteIds.some(
    (id) => typeof id === 'string' && id.startsWith('public|'),
  );
  const needsProvider = body.quoteIds.some(
    (id) => typeof id === 'string' && !id.startsWith('public|'),
  );
  if (needsProvider && !userId)
    throw Error('Sign in to analyze your saved provider quote snapshot.');
  const stored = needsProvider ? await readLiveSnapshots(userId!, eventId) : [];
  const publicQuotes = needsPublic
    ? (await publicGameProps((await liveGame(eventId)).game)).quotes
    : [];
  const research = await enrichLiveQuotes(eventId, [
    ...stored,
    ...publicQuotes,
  ]);
  const quotes = research.quotes;
  return auditLiveSlip(input, quotes);
}
