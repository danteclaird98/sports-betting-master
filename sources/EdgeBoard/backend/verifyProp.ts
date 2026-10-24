import { identity, marketKey } from '../shared/accountSlip';
import {
  readPropObservation,
  type EvidenceCheck,
  type PropObservation,
} from '../shared/propEvidence';
import {
  getFreeUnderdogLines,
  matchesSport,
  type FreeLine,
} from './freeUnderdog';
import { loadEventEvidence, type EventEvidence } from './propEventEvidence';

type PublicSource = {
  lines: FreeLine[];
  retrievedAt: string;
  lastCheckedAt: string;
  staleCacheUsed: boolean;
  truncated: boolean;
};
const sourceUrl = 'https://api.underdogfantasy.com/v1/over_under_lines';
export function auditPropEvidence(
  observation: PropObservation,
  board: PublicSource | null,
  context: EventEvidence,
  now = Date.now(),
) {
  const checks: EvidenceCheck[] = [];
  const check = (
    key: string,
    label: string,
    state: EvidenceCheck['state'],
    detail: string,
    url?: string,
    observedAt?: string,
  ) =>
    checks.push({
      key,
      label,
      state,
      detail,
      ...(url ? { sourceUrl: url } : {}),
      ...(observedAt ? { observedAt } : {}),
    });
  const sameMarket = (market: string) =>
    (marketKey(market) ?? identity(market)) ===
    (marketKey(observation.market) ?? identity(observation.market));
  const sameEvent = (line: FreeLine) =>
    identity(line.event) === identity(observation.event) &&
    line.commenceTime !== null &&
    Math.abs(
      Date.parse(line.commenceTime) - Date.parse(observation.startTime),
    ) <= 60_000;
  const playerLines = (board?.lines ?? []).filter(
    (line) =>
      matchesSport(line, observation.sport) &&
      identity(line.player) === identity(observation.player) &&
      sameEvent(line) &&
      sameMarket(line.market),
  );
  const matches = playerLines.filter(
    (line) =>
      line.line === observation.line &&
      (observation.period === 'UNKNOWN' ||
        !observation.period ||
        line.period === observation.period) &&
      (!observation.lineId || line.lineId === observation.lineId),
  );
  const exact = matches.length === 1 ? matches[0] : null;
  const offered = exact
    ? observation.selection === 'Higher'
      ? exact.higher
      : exact.lower
    : null;
  const observedPrice = offered?.decimalPrice ?? null;
  const usable =
    board &&
    !board.staleCacheUsed &&
    !board.truncated &&
    now >= Date.parse(board.lastCheckedAt) &&
    now - Date.parse(board.lastCheckedAt) <= 120_000;
  const open =
    exact &&
    ['active', 'open', 'available'].includes(exact.status.toLowerCase()) &&
    !exact.isLive &&
    Date.parse(exact.commenceTime ?? '') > now;
  const unchanged =
    observedPrice !== null &&
    Math.abs(observedPrice - observation.publicDecimalPrice) < 1e-9;
  check(
    'quote',
    'Exact public selection and price',
    !usable
      ? 'UNAVAILABLE'
      : exact && open && unchanged
        ? 'CONFIRMED'
        : 'CHANGED',
    !usable
      ? 'Public refresh failed, is incomplete or returned stale data; no current quote is verified.'
      : !exact
        ? 'The original line identity, player, event, market or threshold is no longer uniquely present.'
        : !open
          ? 'The market is live, closed, suspended or past its pregame start.'
          : observedPrice === null
            ? 'This side has no current decimal price.'
            : unchanged
              ? `The exact public selection still shows ${observedPrice.toFixed(2)} decimal. This confirms only a public observation.`
              : `Public price changed from ${observation.publicDecimalPrice.toFixed(2)} to ${observedPrice.toFixed(2)}; earlier calculations are invalid.`,
    sourceUrl,
    board?.lastCheckedAt,
  );
  const period = exact?.period ?? 'UNKNOWN';
  const periodVerified =
    ['FULL_GAME', '1H', '2H'].includes(period) &&
    (observation.period === 'UNKNOWN' ||
      !observation.period ||
      observation.period === period);
  check(
    'period',
    'Market period',
    periodVerified ? 'CONFIRMED' : 'MISSING',
    periodVerified
      ? `Source explicitly identifies ${period}.`
      : 'The feed does not establish a matching full-game/half period. Kickoff time is not period evidence.',
    sourceUrl,
    exact?.observedAt,
  );
  const gameMatches = context.status === 'MATCHED';
  check(
    'event',
    'Independent game identity',
    gameMatches
      ? 'CONFIRMED'
      : context.status === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'MISSING',
    gameMatches
      ? `ESPN event ${context.eventId}: both teams and start time match. Game state: ${context.eventState || 'unknown'}.`
      : `Independent event match: ${context.status.toLowerCase()}.`,
    context.sourceUrl,
    context.observedAt,
  );
  check(
    'pregame',
    'Pregame window',
    gameMatches &&
      context.eventState === 'pre' &&
      Date.parse(observation.startTime) > now
      ? 'CONFIRMED'
      : 'MISSING',
    'Pregame checks require a future kickoff and an independent pregame status. Started games cannot use this pregame quote.',
  );
  check(
    'roster',
    'Independent player/team identity',
    context.roster.status === 'MATCHED'
      ? 'CONFIRMED'
      : context.roster.status === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'MISSING',
    context.roster.status === 'MATCHED'
      ? `${observation.player} · ${context.roster.team} · ${context.roster.position || 'position unknown'} · ESPN player ${context.roster.playerId}. Roster listing is not game-day availability.`
      : `Current-season exact roster match: ${context.roster.status.toLowerCase()}. No fuzzy name match is accepted.`,
    context.roster.sourceUrl,
    context.roster.observedAt,
  );
  check(
    'availability',
    'Game-day availability and role',
    'MISSING',
    'Roster status or absence of an injury listing does not confirm active game-day status, participation, targets or red-zone role.',
  );
  check(
    'timestamp',
    'Bookmaker price timestamp',
    'MISSING',
    'Source retrieval and line-change timestamps are not a verified bookmaker price timestamp.',
  );
  check(
    'account',
    'Your account offer and payout',
    'MISSING',
    'Public decimal prices do not establish your available line, region, stake limit or combined entry payout. Use Check my slip for the actual account entry.',
  );
  check(
    'rules',
    'Equivalent settlement rules',
    'MISSING',
    observation.market === 'rush_rec_tds'
      ? 'Verify rushing + receiving touchdowns, overtime, participation/void rules and return-TD exclusions. Anytime scorer and total-TD markets are not assumed equivalent.'
      : 'Participation, overtime, push and void rules must be confirmed for the exact account contract.',
  );
  check(
    'references',
    'Two fresh independent bookmaker references',
    'MISSING',
    'No two equivalent timestamped bookmaker prop quotes are available in this free check. Game odds, roster sources and this same feed do not count as independent prop-price references.',
  );
  check(
    'model',
    'Approved independent probability model',
    'MISSING',
    observation.sport === 'americanfootball_ncaaf'
      ? 'No live-approved college-football model covers this market. The NFL receptions experiment cannot estimate this touchdown probability.'
      : 'No live-approved independent model has established a probability for this exact contract. A market-implied probability is not an independent model.',
  );
  check(
    'ev',
    'Verified conservative +3% EV',
    'MISSING',
    'A positive edge cannot be established without approved probability, uncertainty, equivalent rules and executable payout. No win probability or stake is invented.',
  );
  const confirmed = checks.filter((item) => item.state === 'CONFIRMED').length;
  return {
    schemaVersion: 'edgeboard.prop-evidence.v1',
    checkedAt: new Date(now).toISOString(),
    observation,
    status: confirmed ? 'PARTIALLY_VERIFIED' : 'UNVERIFIED',
    recommendation: 'HOLD',
    recommendedStake: 0,
    checks,
    confirmedChecks: confirmed,
    totalChecks: checks.length,
    currentPublicQuote: exact
      ? {
          lineId: exact.lineId,
          line: exact.line,
          period,
          decimalPrice: observedPrice,
          status: exact.status,
          sourceObservedAt: exact.observedAt,
          sourceLastChangedAt: exact.lineUpdatedAt,
          accountPriceVerified: false,
        }
      : null,
    nearbyPublicThresholds: [...new Set(playerLines.map((line) => line.line))],
    publicSource: board
      ? {
          receivedAt: board.retrievedAt,
          lastCheckedAt: board.lastCheckedAt,
          staleCacheUsed: board.staleCacheUsed,
        }
      : null,
    identityEvidence: context,
    independentProbability: null,
    estimatedEv: null,
    independentReferenceBookCount: 0,
    paidProviderRequests: 0,
    noBetPlaced: true,
    notAShortlist:
      'Dashboard cards are unranked examples, not highest-confidence selections.',
  };
}
export async function verifyPublicProp(input: unknown) {
  const observation = readPropObservation(input);
  const [publicResult, eventResult] = await Promise.allSettled([
    getFreeUnderdogLines({
      sport: observation.sport,
      player: observation.player,
      limit: 1000,
      forceRefresh: true,
    }),
    loadEventEvidence(observation),
  ]);
  return auditPropEvidence(
    observation,
    publicResult.status === 'fulfilled' ? publicResult.value : null,
    eventResult.status === 'fulfilled'
      ? eventResult.value
      : { status: 'UNAVAILABLE', roster: { status: 'UNAVAILABLE' } },
  );
}
