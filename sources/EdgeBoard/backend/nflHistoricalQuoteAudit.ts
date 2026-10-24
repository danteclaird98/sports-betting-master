import { deVigProportional, americanToDecimal } from './researchControls';

type Market = 'receiving_yards' | 'rushing_yards' | 'passing_yards' | 'receptions';
type Quote = {
  sourceUrl?: string;
  providerQuoteId?: string;
  gameId?: string;
  playerId?: string;
  market?: Market;
  line?: number;
  period?: string;
  bookmaker?: string;
  overAmerican?: number;
  underAmerican?: number;
  capturedAt?: string;
  kickoffAt?: string;
  rulesVersion?: string;
};
const fixedLines: Record<Market, number> = {
  receiving_yards: 59.5,
  rushing_yards: 49.5,
  passing_yards: 199.5,
  receptions: 3.5,
};
const requiredMarkets = Object.keys(fixedLines);
const validOdds = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 100 && Math.abs(v) <= 10000;
const when = (v: unknown) =>
  typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) ? Date.parse(v) : NaN;
function examineQuote(row: Quote) {
  const reasons: string[] = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ['quote is not an object'];
  if (!/^https:\/\/[^\s]+$/i.test(row.sourceUrl ?? '')) reasons.push('source URL missing or invalid');
  if (!row.providerQuoteId || !/^[a-zA-Z0-9_-]{3,128}$/.test(row.providerQuoteId)) reasons.push('provider quote ID missing');
  if (!row.gameId || !/^2025_(0[1-9]|1[0-8])_[A-Z]{2,3}_[A-Z]{2,3}$/.test(row.gameId)) reasons.push('2025 nflverse game ID format invalid');
  if (!row.playerId || !/^[a-zA-Z0-9._-]{3,70}$/.test(row.playerId)) reasons.push('player ID missing');
  if (!row.market || !requiredMarkets.includes(row.market)) reasons.push('unsupported historical market');
  else if (row.line !== fixedLines[row.market]) reasons.push('line differs from fixed trained threshold');
  if (row.period !== 'full_game') reasons.push('period not verified full game');
  if (!row.bookmaker || !/^[a-zA-Z0-9_. -]{2,50}$/.test(row.bookmaker)) reasons.push('bookmaker identity missing');
  if (!row.rulesVersion || row.rulesVersion.length > 160) reasons.push('rule version identifier absent');
  if (!validOdds(row.overAmerican) || !validOdds(row.underAmerican)) reasons.push('valid two-sided American odds required');
  const captured = when(row.capturedAt), kickoff = when(row.kickoffAt);
  if (!Number.isFinite(captured) || !Number.isFinite(kickoff) ||
      captured >= kickoff || captured < kickoff - 7 * 86400000) {
    reasons.push('quote capture and kickoff require timezone and valid pregame chronology');
  }
  return reasons;
}
export function validateHistoricalPropQuoteBatch(value: unknown) {
  const input = value as { sourceName?: string; quotes?: Quote[] };
  if (!input || typeof input.sourceName !== 'string' || !input.sourceName.trim() ||
      !Array.isArray(input.quotes) || input.quotes.length < 1 || input.quotes.length > 1500) {
    throw Error('Provide a named source and 1–1,500 historical quotes. Do not upload account credentials.');
  }
  const encountered = new Set<string>();
  const accepted: Array<{ gameId: string; playerId: string; market: Market; bookmaker: string; line: number; priceAt: string; noVigOverBenchmark: number }> = [];
  const rejected: Array<{ index: number; reasons: string[] }> = [];
  let duplicateCount = 0;
  input.quotes.forEach((quote, index) => {
    const reasons = examineQuote(quote);
    if (!reasons.length) {
      const key = [quote.providerQuoteId, quote.gameId, quote.playerId, quote.bookmaker, quote.market].join('|');
      if (encountered.has(key)) {
        reasons.push('duplicate provider quote and wager identity');
        duplicateCount++;
      } else encountered.add(key);
    }
    if (reasons.length) {
      rejected.push({ index, reasons });
    } else {
      const fair = deVigProportional([americanToDecimal(quote.overAmerican!), americanToDecimal(quote.underAmerican!)]);
      accepted.push({
        gameId: quote.gameId!,
        playerId: quote.playerId!,
        market: quote.market!,
        bookmaker: quote.bookmaker!,
        line: quote.line!,
        priceAt: quote.capturedAt!,
        noVigOverBenchmark: fair.fair[0],
      });
    }
  });
  const events = new Set(accepted.map(x => x.gameId));
  const players = new Set(accepted.map(x => x.playerId));
  return {
    status: 'UNVERIFIED_HISTORICAL_IMPORT',
    modelApproval: false,
    bettingRecommendation: 'HOLD',
    sourceClaim: input.sourceName,
    independentlyAuthenticated: false,
    quoteProvenanceVerified: false,
    kickoffDatesIndependentlyVerified: false,
    outcomeMatchingPerformed: false,
    playerIdCrosswalkVerified: false,
    executablePriceVerified: false,
    calibrationAgainstMarketVerified: false,
    claimedRoi: null,
    total: input.quotes.length,
    structurallyValid: accepted.length,
    rejectedCount: rejected.length,
    duplicateCount,
    distinctGames: events.size,
    distinctPlayers: players.size,
    distinctBooks: new Set(accepted.map(x => x.bookmaker)).size,
    preview: accepted.slice(0, 8),
    rejected: rejected.slice(0, 20),
    nextActions: [
      'Independently authenticate provider capture timestamps, bookmaker origin and historical quote files.',
      'Join only exact 2025 nflverse game/player/market/line identities to untouched calibrated predictions and official results.',
      'Evaluate a predefined market-comparison cohort with de-vig Brier, log loss, uncertainty, coverage and execution constraints.',
      'Only consider a model for live approval after prospective point-in-time validation.',
    ],
    note: 'A structurally valid manually supplied quote is not an independently authenticated market price. The displayed no-vig benchmark is not an independent model or edge.',
    dataStored: false,
    providerCreditsUsed: 0,
  };
}
export function historicalQuoteFixture() {
  const good: Quote = {
    sourceUrl: 'https://example.org/synthetic-only', providerQuoteId: 'fixture_2025_01',
    gameId: '2025_02_DAL_GB', playerId: 'fixture-player',
    market: 'receptions', line: 3.5, period: 'full_game',
    bookmaker: 'fixturebook', overAmerican: -110, underAmerican: -110,
    capturedAt: '2025-09-13T20:00:00Z', kickoffAt: '2025-09-14T20:00:00Z',
    rulesVersion: 'fictional-test-1',
  };
  const report = validateHistoricalPropQuoteBatch({
    sourceName: 'synthetic-only',
    quotes: [good, { ...good, providerQuoteId: 'future', capturedAt: '2025-09-15T00:00:00Z' },
      { ...good, providerQuoteId: 'wrong-line', line: 4.5 },
      { ...good, providerQuoteId: 'wrong-game', gameId: 'not-an-id' }, good],
  });
  const checks = {
    acceptsStructuralFixture: report.structurallyValid === 1,
    rejectsFutureQuote: report.rejected.some(x => x.reasons.some(r => r.includes('chronology'))),
    rejectsWrongThreshold: report.rejected.some(x => x.reasons.some(r => r.includes('threshold'))),
    rejectsIdentityError: report.rejected.some(x => x.reasons.some(r => r.includes('game ID'))),
    rejectsDuplicate: report.duplicateCount === 1,
    neverApprovesUntrustedSource: report.modelApproval === false && report.claimedRoi === null,
  };
  return { status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    fixture: 'SYNTHETIC_ONLY_NOT_ACTUAL_ODDS', checks };
}
