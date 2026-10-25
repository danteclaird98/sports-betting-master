import { buildAssistantReport, dayWindow } from './assistantReport';
import { dailyScanStatus } from '../shared/dailyScanStatus';

const SPORTS = [
  ['baseball_mlb', 'MLB'],
  ['icehockey_nhl', 'NHL'],
  ['americanfootball_nfl', 'NFL'],
  ['americanfootball_ncaaf', 'College football'],
  ['basketball_nba', 'NBA'],
  ['basketball_wnba', 'WNBA'],
  ['tennis', 'Tennis'],
  ['mma', 'MMA'],
] as const;

export async function scanAllSports(date?: string, timezone?: string) {
  const window = dayWindow(date, timezone);
  const results = await Promise.allSettled(
    SPORTS.map(([sport]) =>
      buildAssistantReport({
        sport,
        date: window.date,
        timezone: window.timezone,
      })
    )
  );
  const now = Date.now();
  const sports = results.map((result, index) => {
    const [sport, name] = SPORTS[index];
    if (result.status === 'rejected') {
      return {
        sport,
        name,
        status: 'UNAVAILABLE',
        dataStatus: 'SOURCE_UNAVAILABLE',
        sourceHealth: [{ source: 'Sport scan', status: 'UNAVAILABLE', retrievedAt: null }],
        model: { status: 'NOT_EVALUATED', liveApproved: false },
        decisionReasons: ['The sport scan failed. Retry before drawing conclusions.'],
        eventCount: 0,
        gamePrices: 0,
        propSides: 0,
        samples: [],
        reviewQueue: [],
        qualifyingCount: 0,
      };
    }
    const report = result.value;
    const gameWatch = report.gamePrices
      .filter(
        q =>
          Number.isFinite(Date.parse(q.startTime)) &&
          Date.parse(q.startTime) > now &&
          Number.isFinite(q.americanOdds)
      )
      .slice(0, 6)
      .map(q => ({
        sport,
        sportName: name,
        event: q.event,
        startTime: q.startTime,
        type: 'game' as const,
        player: null,
        market: q.market,
        selection: q.selection,
        line: q.line,
        source: q.sportsbook,
        americanOdds: q.americanOdds,
        publicDecimalPrice: null,
        retrievedAt: q.retrievedAt ?? null,
        offeredOddsTimestampVerified: false as const,
        accountVerified: false as const,
        estimatedEv: null,
        researchStatus: 'WATCH_ONLY' as const,
        reason:
          'Source odds timestamp, exact grading rules, account availability and independent model are unverified.',
      }));
    const propWatch = (report.propPriceSamples ?? [])
      .filter(
        q =>
          Number.isFinite(Date.parse(q.startTime)) &&
          Date.parse(q.startTime) > now &&
          q.publicUnderdogDecimalPrice !== null &&
          Number.isFinite(q.publicUnderdogDecimalPrice) &&
          q.publicUnderdogDecimalPrice > 1
      )
      .slice(0, 6)
      .map(q => ({
        sport,
        sportName: name,
        event: q.event,
        startTime: q.startTime,
        type: 'prop' as const,
        player: q.player,
        market: q.market,
        selection: q.side,
        lineId: q.lineId,
        publicEventId: q.publicEventId,
        period: q.period,
        line: q.line,
        source: 'Underdog public pick’em',
        americanOdds: null,
        publicDecimalPrice: q.publicUnderdogDecimalPrice,
        retrievedAt: q.observedAt ?? null,
        offeredOddsTimestampVerified: false as const,
        accountVerified: false as const,
        estimatedEv: null,
        researchStatus: 'WATCH_ONLY' as const,
        reason:
          'Pick’em public price is not a confirmed standalone or parlay payout. No independent player projection or verified rules.',
      }));
    return {
      sport,
      name,
      status: report.decision,
      dataStatus: dailyScanStatus(
        [{ status: report.decision, sourceHealth: report.sourceHealth }],
        gameWatch.length + propWatch.length,
        report.qualifyingOpportunities.length,
      ).status,
      sourceHealth: report.sourceHealth,
      model: report.model,
      decisionReasons: report.decisionReasons,
      eventCount: report.scope.gameEvents,
      gamePrices: report.scope.gameQuotes,
      propSides: report.scope.propMarketSidesScreened,
      qualifyingCount: report.qualifyingOpportunities.length,
      samples: gameWatch.slice(0, 4).map(price => ({
        event: price.event,
        market: price.market,
        selection: price.selection,
        line: price.line,
        price: price.americanOdds,
        source: price.source,
        accountVerified: false,
        expectedValue: null,
      })),
      reviewQueue: [...gameWatch, ...propWatch],
    };
  });
  const reviewQueue = sports
    .flatMap(s => s.reviewQueue)
    .sort(
      (a, b) =>
        Date.parse(a.startTime) - Date.parse(b.startTime) ||
        a.sportName.localeCompare(b.sportName) ||
        a.event.localeCompare(b.event)
    );
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: 'edgeboard.all-sports.v2',
    generatedAt,
    refreshAfter: new Date(Date.parse(generatedAt) + 60_000).toISOString(),
    requested: window,
    researchOnly: true,
    paidProviderRequests: 0,
    status: 'NO_APPROVED_LIVE_MODEL',
    dataStatus: dailyScanStatus(sports, reviewQueue.length).status,
    wagersPlaced: 0,
    caution:
      'WATCH entries are public quote observations, never betting picks. Missing price timestamps, independent probability estimates and settlement verification prohibit EV claims.',
    sports,
    reviewQueue,
    qualifyingOpportunities: [],
  };
}
