import { getFreeUnderdogLines } from './freeUnderdog';

type PublicLine = Awaited<ReturnType<typeof getFreeUnderdogLines>>['lines'][number];

function validPrice(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 1;
}

function dated(value: string | null) {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function auditPublicSnapshot(
  lines: PublicLine[],
  retrievedAt: string,
  now = Date.now(),
  sourceTruncated = false,
) {
  const retrieved = Date.parse(retrievedAt);
  const sourceAgeSeconds = Number.isFinite(retrieved)
    ? Math.max(0, Math.round((now - retrieved) / 1000))
    : null;
  const blockedStatus = /^(closed|suspended|inactive|cancelled|canceled|settled|expired)$/i;
  const openStatus = /^(open|active|available)$/i;
  const funnel = {
    sourceLines: lines.length,
    futurePregameLines: 0,
    startedEventsExcluded: 0,
    nonGameMarketsExcluded: 0,
    liveLinesExcluded: 0,
    closedOrSuspendedExcluded: 0,
    fullTwoSidePrices: 0,
    oneSidePrices: 0,
    noUsableSidePrices: 0,
    timestampedWithin120Seconds: 0,
    missingOrStaleLineTimestamp: 0,
    unconfirmedMarketStatus: 0,
    uniqueEvents: 0,
    uniquePlayers: 0,
  };
  const eligible: Array<{
    lineId: string;
    event: string;
    eventId: string;
    startTime: string;
    player: string;
    market: string;
    line: number;
    higherDecimal: number | null;
    lowerDecimal: number | null;
    marketStatus: string;
    lineTimestamp: string | null;
    twoSided: boolean;
    quoteTimestampFresh: boolean;
    statusConfirmedOpen: boolean;
  }> = [];
  const marketCounts = new Map<string, number>();
  const events = new Set<string>();
  const players = new Set<string>();
  for (const line of lines) {
    if (line.isLive) {
      funnel.liveLinesExcluded += 1;
      continue;
    }
    const start = dated(line.commenceTime);
    if (start === null) {
      funnel.nonGameMarketsExcluded += 1;
      continue;
    }
    if (start <= now) {
      funnel.startedEventsExcluded += 1;
      continue;
    }
    if (blockedStatus.test(line.status.trim())) {
      funnel.closedOrSuspendedExcluded += 1;
      continue;
    }
    funnel.futurePregameLines += 1;
    const statusConfirmedOpen = openStatus.test(line.status.trim());
    if (!statusConfirmedOpen) funnel.unconfirmedMarketStatus += 1;
    const higher = validPrice(line.higher?.decimalPrice) ? line.higher!.decimalPrice : null;
    const lower = validPrice(line.lower?.decimalPrice) ? line.lower!.decimalPrice : null;
    const twoSided = higher !== null && lower !== null;
    if (twoSided) funnel.fullTwoSidePrices += 1;
    else if (higher !== null || lower !== null) funnel.oneSidePrices += 1;
    else funnel.noUsableSidePrices += 1;
    const updatedAt = dated(line.lineUpdatedAt);
    const quoteTimestampFresh = updatedAt !== null && updatedAt <= now &&
      now - updatedAt <= 120_000 && updatedAt <= retrieved + 5000;
    if (quoteTimestampFresh) funnel.timestampedWithin120Seconds += 1;
    else funnel.missingOrStaleLineTimestamp += 1;
    marketCounts.set(line.marketLabel, (marketCounts.get(line.marketLabel) ?? 0) + 1);
    if (line.eventId) events.add(line.eventId);
    if (line.player) players.add(line.player.toLowerCase().trim());
    if (higher === null && lower === null) continue;
    eligible.push({
      lineId: line.lineId,
      event: line.event,
      eventId: line.eventId,
      startTime: line.commenceTime!,
      player: line.player,
      market: line.marketLabel,
      line: line.line,
      higherDecimal: higher,
      lowerDecimal: lower,
      marketStatus: line.status,
      lineTimestamp: line.lineUpdatedAt,
      twoSided,
      quoteTimestampFresh,
      statusConfirmedOpen,
    });
  }
  funnel.uniqueEvents = events.size;
  funnel.uniquePlayers = players.size;
  eligible.sort((a, b) => {
    const qualityA = Number(a.twoSided) + Number(a.quoteTimestampFresh) + Number(a.statusConfirmedOpen);
    const qualityB = Number(b.twoSided) + Number(b.quoteTimestampFresh) + Number(b.statusConfirmedOpen);
    if (qualityA !== qualityB) return qualityB - qualityA;
    return Date.parse(a.startTime) - Date.parse(b.startTime) ||
      a.player.localeCompare(b.player) || a.market.localeCompare(b.market);
  });
  return {
    recommendation: 'HOLD',
    status: 'RESEARCH_ONLY_NO_APPROVED_EV_MODEL',
    generatedAt: new Date(now).toISOString(),
    source: 'Underdog public pregame feed',
    retrievedAt,
    sourceAgeSeconds,
    sourceStale: sourceAgeSeconds === null || sourceAgeSeconds > 120,
    sourceTruncated,
    funnel,
    marketCounts: [...marketCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([market, lines]) => ({ market, lines })),
    comparisonQueue: eligible.slice(0, 12),
    comparisonQueueBasis: 'Price completeness, source freshness and upcoming event time, NOT a probability or betting-edge ranking.',
    blockers: [
      'No independently validated live per-player probability distribution or calibrated uncertainty.',
      'Cross-book two-sided prices, exact provider identity and market rule equivalence are not established by the public feed.',
      'Advertised prices and multipliers are not proof of executable Caesars or Underdog account offers.',
      ...(sourceTruncated ? ['The public snapshot was truncated; missing rows must not be treated as unavailable.'] : []),
      ...(sourceAgeSeconds === null || sourceAgeSeconds > 120 ? ['Public snapshot is old or lacks a trustworthy retrieval timestamp.'] : []),
    ],
    creditsUsed: 0,
    placesBets: false,
  };
}

export async function getResearchPipeline(sport = 'americanfootball_nfl') {
  if (!/^[a-z0-9_]{3,60}$/.test(sport)) throw Error('Invalid sport key.');
  const result = await getFreeUnderdogLines({
    sport,
    limit: 1000,
    includeSeasonMarkets: true,
  });
  return {
    sport,
    totalMatchingLines: result.totalMatchingLines,
    ...auditPublicSnapshot(result.lines, result.retrievedAt, Date.now(), result.truncated),
  };
}

export function selfTestResearchPipeline() {
  const now = Date.parse('2026-10-18T20:00:00Z');
  const source = new Date(now - 30_000).toISOString();
  const common = {
    eventId: 'game-1',
    event: 'Away @ Home',
    player: 'Fixture Player',
    marketLabel: 'Receptions',
    market: 'receptions',
    line: 4.5,
    status: 'active',
    isLive: false,
    lineUpdatedAt: source,
    higher: { decimalPrice: 1.9 },
    lower: { decimalPrice: 1.9 },
  };
  const fixture = [
    { ...common, lineId: 'past', commenceTime: new Date(now - 60_000).toISOString() },
    { ...common, lineId: 'future', commenceTime: new Date(now + 3_600_000).toISOString() },
    { ...common, lineId: 'suspended', status: 'suspended', commenceTime: new Date(now + 3_600_000).toISOString() },
  ] as unknown as PublicLine[];
  const report = auditPublicSnapshot(fixture, source, now);
  const checks = {
    pastExcluded: report.funnel.startedEventsExcluded === 1,
    suspendedExcluded: report.funnel.closedOrSuspendedExcluded === 1,
    futureIncluded: report.funnel.futurePregameLines === 1,
    twoSided: report.funnel.fullTwoSidePrices === 1,
    sourceFresh: report.sourceStale === false,
    researchOnly: report.recommendation === 'HOLD' && report.creditsUsed === 0,
  };
  return { status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks, fixture: 'SYNTHETIC_NOT_LIVE' };
}
