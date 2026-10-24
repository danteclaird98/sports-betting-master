import { secrets } from '@appdeploy/sdk';
import { fetchAlternativeNflOdds, type NormalizedOddsEvent, type ProviderHealth } from './altOdds';
import { fetchNflGameContext } from './nflContext';
import { BANKROLL_POLICY, EDGE_MODEL_VERSION, scoreKymEdge } from './edgePolicy';

type OddsOutcome = {
  name?: string;
  price?: number | null;
  point?: number | null;
};

type OddsMarket = {
  key?: string;
  outcomes?: OddsOutcome[];
};

type OddsBook = {
  key?: string;
  title?: string;
  last_update?: string;
  last_update_ms?: number;
  stale_seconds?: number;
  topped_up?: boolean;
  markets?: OddsMarket[];
};

type OddsEvent = {
  id?: string;
  canonical_event_id?: string;
  commence_time?: string | null;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsBook[];
};

type BaselineGame = {
  away: string;
  home: string;
  awaySpread?: number;
  homeSpread?: number;
  total?: number;
};

export type KymGameLineEdge = {
  id: string;
  event: string;
  commenceTime: string;
  marketType: 'spread' | 'total';
  pick: string;
  baselineLine: number;
  consensusLine: number;
  lineAdvantage: number;
  consensusLow: number;
  consensusHigh: number;
  refs: string[];
  refCount: number;
  predictionConsensus: number | null;
  predictionRefs: string[];
  keyNumberCrossed: boolean;
  confidence: 'high' | 'medium' | 'low';
  action: 'PICK NOW' | 'WAIT';
  status: 'strong' | 'watch';
  modelVersion?: string;
  fairProbability?: number | null;
  fairProbabilityLow?: number | null;
  fairProbabilityHigh?: number | null;
  breakEvenProbability?: number | null;
  estimatedEvPct?: number | null;
  conservativeEvPct?: number | null;
  signalScore?: number | null;
  maxAcceptablePrice?: number | null;
  maxAcceptableLine?: string;
  stakeSuggestion?: string;
  expiresAt?: string | null;
  reverifyInstruction?: string;
  qualityWarnings?: string[];
  uncertaintyDiscountPct?: number | null;
};

const nflBaselines: BaselineGame[] = [
  { away: 'Detroit Lions', home: 'Buffalo Bills', total: 53.5 },
  { away: 'Minnesota Vikings', home: 'Chicago Bears', total: 49.5 },
  { away: 'Pittsburgh Steelers', home: 'New England Patriots', awaySpread: 4.5, homeSpread: -4.5, total: 41.5 },
  { away: 'New Orleans Saints', home: 'Baltimore Ravens', awaySpread: 7.5, homeSpread: -7.5, total: 46.5 },
  { away: 'Philadelphia Eagles', home: 'Tennessee Titans', total: 39.5 },
  { away: 'Green Bay Packers', home: 'New York Jets', awaySpread: -3.5, homeSpread: 3.5, total: 44.5 },
  { away: 'Carolina Panthers', home: 'Atlanta Falcons', total: 44.5 },
  { away: 'Cleveland Browns', home: 'Tampa Bay Buccaneers', awaySpread: 7.5, homeSpread: -7.5, total: 41.5 },
  { away: 'Jacksonville Jaguars', home: 'Denver Broncos', awaySpread: 2.5, homeSpread: -2.5, total: 44.5 },
  { away: 'Las Vegas Raiders', home: 'Los Angeles Chargers', awaySpread: 6.5, homeSpread: -6.5, total: 43.5 },
  { away: 'Washington Commanders', home: 'Dallas Cowboys', awaySpread: 3.5, homeSpread: -3.5, total: 50.5 },
  { away: 'Seattle Seahawks', home: 'Arizona Cardinals', total: 41.5 },
  { away: 'Miami Dolphins', home: 'San Francisco 49ers', awaySpread: 13.5, homeSpread: -13.5, total: 45.5 },
  { away: 'Indianapolis Colts', home: 'Kansas City Chiefs', awaySpread: 6.5, homeSpread: -6.5, total: 47.5 },
  { away: 'New York Giants', home: 'Los Angeles Rams', total: 48.5 },
];

const predictionBookKeys = new Set(['kalshi', 'polymarket', 'novig', 'robinhood']);
const excludedBookKeys = new Set(['underdog', 'prizepicks', 'sleeper', 'betr', 'pick6']);
const MAX_GAME_LINE_AGE_SECONDS = 15 * 60;

function normalizeTeam(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function freshEnough(book: OddsBook) {
  if (book.topped_up) return false;
  if (typeof book.stale_seconds === 'number') return book.stale_seconds <= MAX_GAME_LINE_AGE_SECONDS;
  const millis = typeof book.last_update_ms === 'number'
    ? book.last_update_ms
    : book.last_update
      ? Date.parse(book.last_update)
      : NaN;
  if (!Number.isFinite(millis)) return true;
  return Math.max(0, (Date.now() - millis) / 1000) <= MAX_GAME_LINE_AGE_SECONDS;
}

function eventMatches(event: OddsEvent, baseline: BaselineGame) {
  return normalizeTeam(event.away_team) === normalizeTeam(baseline.away) && normalizeTeam(event.home_team) === normalizeTeam(baseline.home);
}

function pointFor(book: OddsBook, marketKey: 'spreads' | 'totals', outcomeName: string) {
  const market = book.markets?.find(item => item.key === marketKey);
  const outcome = market?.outcomes?.find(item => {
    if (marketKey === 'totals') return (item.name ?? '').toLowerCase() === outcomeName.toLowerCase();
    return normalizeTeam(item.name) === normalizeTeam(outcomeName);
  });
  return typeof outcome?.point === 'number' ? outcome.point : null;
}

function sourceName(book: OddsBook) {
  return book.title ?? book.key ?? 'market';
}

function quoteSet(event: OddsEvent, marketKey: 'spreads' | 'totals', outcomeName: string, predictions: boolean) {
  const quotes: Array<{ point: number; source: string }> = [];
  for (const book of event.bookmakers ?? []) {
    const key = (book.key ?? '').toLowerCase();
    if (!key || excludedBookKeys.has(key) || !freshEnough(book)) continue;
    if (predictionBookKeys.has(key) !== predictions) continue;
    const point = pointFor(book, marketKey, outcomeName);
    if (point === null) continue;
    quotes.push({ point, source: sourceName(book) });
  }
  return quotes;
}

function crossesKeyNumber(baseline: number, consensus: number) {
  if (baseline === consensus) return false;
  if (baseline * consensus < 0) return true;
  const low = Math.min(Math.abs(baseline), Math.abs(consensus));
  const high = Math.max(Math.abs(baseline), Math.abs(consensus));
  return [3, 7].some(key => low < key && high >= key);
}

function confidenceFor(refCount: number, low: number, high: number, predictionConsensus: number | null, consensus: number) {
  const spread = high - low;
  const predictionAgrees = predictionConsensus === null || Math.abs(predictionConsensus - consensus) <= 0.5;
  if (refCount >= 4 && spread <= 1 && predictionAgrees) return 'high' as const;
  if (refCount >= 2 && spread <= 2) return 'medium' as const;
  return 'low' as const;
}

function formatSpread(team: string, line: number) {
  return `${team} ${line > 0 ? '+' : ''}${line}`;
}

function buildSpreadEdge(event: OddsEvent, team: string, baselineLine: number): KymGameLineEdge | null {
  const sportsbook = quoteSet(event, 'spreads', team, false);
  if (sportsbook.length < 2) return null;
  const points = sportsbook.map(item => item.point);
  const consensusLine = median(points);
  const lineAdvantage = baselineLine - consensusLine;
  if (lineAdvantage <= 0.001) return null;
  const predictions = quoteSet(event, 'spreads', team, true);
  const predictionConsensus = predictions.length ? median(predictions.map(item => item.point)) : null;
  const consensusLow = Math.min(...points);
  const consensusHigh = Math.max(...points);
  const keyNumberCrossed = crossesKeyNumber(baselineLine, consensusLine);
  const strong = lineAdvantage >= 2 || (keyNumberCrossed && lineAdvantage >= 1);
  const commenceTime = event.commence_time ?? new Date().toISOString();
  return {
    id: `${event.canonical_event_id ?? event.id ?? `${event.away_team}-${event.home_team}`}|spread|${team}`,
    event: `${event.away_team ?? 'Away'} @ ${event.home_team ?? 'Home'}`,
    commenceTime,
    marketType: 'spread',
    pick: formatSpread(team, baselineLine),
    baselineLine,
    consensusLine,
    lineAdvantage,
    consensusLow,
    consensusHigh,
    refs: sportsbook.map(item => item.source),
    refCount: sportsbook.length,
    predictionConsensus,
    predictionRefs: predictions.map(item => item.source),
    keyNumberCrossed,
    confidence: confidenceFor(sportsbook.length, consensusLow, consensusHigh, predictionConsensus, consensusLine),
    action: strong ? 'PICK NOW' : 'WAIT',
    status: strong ? 'strong' : 'watch',
  };
}

function buildTotalEdge(event: OddsEvent, baselineLine: number): KymGameLineEdge | null {
  const sportsbook = quoteSet(event, 'totals', 'Over', false);
  if (sportsbook.length < 2) return null;
  const points = sportsbook.map(item => item.point);
  const consensusLine = median(points);
  const delta = consensusLine - baselineLine;
  if (Math.abs(delta) <= 0.001) return null;
  const lineAdvantage = Math.abs(delta);
  const side = delta > 0 ? 'Higher' : 'Lower';
  const predictions = quoteSet(event, 'totals', 'Over', true);
  const predictionConsensus = predictions.length ? median(predictions.map(item => item.point)) : null;
  const consensusLow = Math.min(...points);
  const consensusHigh = Math.max(...points);
  const strong = lineAdvantage >= 2;
  const commenceTime = event.commence_time ?? new Date().toISOString();
  return {
    id: `${event.canonical_event_id ?? event.id ?? `${event.away_team}-${event.home_team}`}|total|${baselineLine}`,
    event: `${event.away_team ?? 'Away'} @ ${event.home_team ?? 'Home'}`,
    commenceTime,
    marketType: 'total',
    pick: `${side} ${baselineLine}`,
    baselineLine,
    consensusLine,
    lineAdvantage,
    consensusLow,
    consensusHigh,
    refs: sportsbook.map(item => item.source),
    refCount: sportsbook.length,
    predictionConsensus,
    predictionRefs: predictions.map(item => item.source),
    keyNumberCrossed: false,
    confidence: confidenceFor(sportsbook.length, consensusLow, consensusHigh, predictionConsensus, consensusLine),
    action: strong ? 'PICK NOW' : 'WAIT',
    status: strong ? 'strong' : 'watch',
  };
}

function demoResponse() {
  const generatedAt = new Date().toISOString();
  return {
    mode: 'demo' as const,
    provider: 'Demo sportsbook + prediction consensus',
    underdogStatus: 'sample' as const,
    sport: 'americanfootball_nfl',
    scanKind: 'kym' as const,
    marketTiming: 'pregame' as const,
    maxQuoteAgeSeconds: MAX_GAME_LINE_AGE_SECONDS,
    generatedAt,
    eventCount: 2,
    creditsUsed: 0,
    creditsRemaining: null,
    partialBoard: false,
    underdogPropsLoaded: 0,
    liveUnderdogPropsLoaded: 0,
    pregameUnderdogPropsLoaded: 0,
    referencePropsLoaded: 0,
    referenceBookCount: 5,
    consensusAvailable: true,
    rawPriceStatus: 'verified' as const,
    candidatesScreened: 0,
    candidateScopeCount: 0,
    rawEventChecks: 0,
    rawEventCap: 0,
    rawVerifiedCount: 0,
    rawSeriesTruncated: false,
    baselineGamesMatched: 2,
    baselineMarketsCompared: 2,
    edges: [],
    kalshiMarkets: [],
    gameLineEdges: [
      {
        id: 'demo-ind-kc-total',
        event: 'Indianapolis Colts @ Kansas City Chiefs',
        commenceTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        marketType: 'total' as const,
        pick: 'Lower 47.5',
        baselineLine: 47.5,
        consensusLine: 45.5,
        lineAdvantage: 2,
        consensusLow: 45.5,
        consensusHigh: 46,
        refs: ['DraftKings', 'FanDuel', 'Caesars', 'BetMGM'],
        refCount: 4,
        predictionConsensus: 45.5,
        predictionRefs: ['Kalshi'],
        keyNumberCrossed: false,
        confidence: 'high' as const,
        action: 'PICK NOW' as const,
        status: 'strong' as const,
      },
      {
        id: 'demo-jax-den-total',
        event: 'Jacksonville Jaguars @ Denver Broncos',
        commenceTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        marketType: 'total' as const,
        pick: 'Higher 44.5',
        baselineLine: 44.5,
        consensusLine: 45.5,
        lineAdvantage: 1,
        consensusLow: 45.5,
        consensusHigh: 46,
        refs: ['DraftKings', 'FanDuel', 'Caesars'],
        refCount: 3,
        predictionConsensus: 45.5,
        predictionRefs: ['Kalshi'],
        keyNumberCrossed: false,
        confidence: 'medium' as const,
        action: 'WAIT' as const,
        status: 'watch' as const,
      },
    ],
    providerHealth: [
      { id: 'parlay', name: 'ParlayAPI', status: 'active' as const, detail: 'Primary sportsbook feed active.', eventCount: 2, bookCount: 4 },
      { id: 'sharpapi', name: 'SharpAPI', status: 'active' as const, detail: 'Fallback sportsbook feed active.', eventCount: 2, bookCount: 2 },
      { id: 'espn', name: 'ESPN public odds', status: 'active' as const, detail: 'No-key multi-book NFL odds fallback active.', eventCount: 2, bookCount: 5 },
      { id: 'theoddsapi', name: 'The Odds API', status: 'unconfigured' as const, detail: 'Optional extra sportsbook feed; no longer required for baseline coverage.', eventCount: 0, bookCount: 0 },
      { id: 'kalshi', name: 'Kalshi', status: 'public' as const, detail: 'Public prediction-market context active.', eventCount: 2, bookCount: 0 },
      { id: 'clearsports', name: 'ClearSports', status: 'active' as const, detail: 'NFL injury context active.', eventCount: 6, bookCount: 0 },
      { id: 'weather', name: 'Open-Meteo weather', status: 'public' as const, detail: 'Public kickoff weather context active.', eventCount: 2, bookCount: 0 },
    ],
    gameContext: [
      { event: 'Indianapolis Colts @ Kansas City Chiefs', weather: 'Kansas City: 68°F · precipitation 20% · wind 9 mph, gusts 16 mph.', injuries: ['Demo starter: Questionable · hamstring'] },
      { event: 'Jacksonville Jaguars @ Denver Broncos', weather: 'Denver: 61°F · precipitation 10% · wind 7 mph, gusts 13 mph.', injuries: [] },
    ],
    predictionContext: [
      { source: 'Kalshi', title: 'Demo NFL market context', probability: 0.55, closeTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
    ],
    edgeModel: {
      version: EDGE_MODEL_VERSION,
      thresholds: ['Demo only. No approved live probability or settlement-contract model.', 'Do not place bets from sample cards.'],
    },
    riskPolicy: BANKROLL_POLICY,
    note: 'Demo KYM comparison. Live mode uses a provider ladder: ParlayAPI and SharpAPI when available, ESPN public multi-book odds with no API key, optional The Odds API, and public Kalshi context. Sportsbook consensus requires at least two fresh books.',
  };
}

async function readParlayKey() {
  const names = await secrets.listSecretNames();
  if (!names.includes('PARLAY_API_KEY')) return null;
  return (await secrets.readSecret('PARLAY_API_KEY')).trim();
}

function parseOddsEvents(text: string) {
  try {
    const parsed = JSON.parse(text) as OddsEvent[] | { data?: OddsEvent[] };
    return Array.isArray(parsed) ? parsed : parsed.data ?? [];
  } catch {
    return [];
  }
}

function bookTimestamp(book: OddsBook) {
  if (typeof book.last_update_ms === 'number') return book.last_update_ms;
  if (book.last_update) {
    const parsed = Date.parse(book.last_update);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function mergeOddsEvents(groups: Array<OddsEvent[] | NormalizedOddsEvent[]>) {
  const merged = new Map<string, OddsEvent>();
  for (const group of groups) {
    for (const incoming of group) {
      const kickoff = incoming.commence_time ? Date.parse(incoming.commence_time) : NaN;
      const bucket = Number.isFinite(kickoff) ? Math.round(kickoff / (15 * 60 * 1000)) : 0;
      const key = `${normalizeTeam(incoming.away_team)}|${normalizeTeam(incoming.home_team)}|${bucket}`;
      let event = merged.get(key);
      if (!event) {
        event = {
          id: incoming.id,
          canonical_event_id: incoming.canonical_event_id,
          commence_time: incoming.commence_time,
          home_team: incoming.home_team,
          away_team: incoming.away_team,
          bookmakers: [],
        };
        merged.set(key, event);
      }
      event.bookmakers ??= [];
      for (const incomingBook of incoming.bookmakers ?? []) {
        const bookKey = (incomingBook.key ?? incomingBook.title ?? '').toLowerCase();
        if (!bookKey) continue;
        const index = event.bookmakers.findIndex(book => (book.key ?? book.title ?? '').toLowerCase() === bookKey);
        if (index === -1) {
          event.bookmakers.push(incomingBook);
          continue;
        }
        const current = event.bookmakers[index];
        const incomingMarkets = incomingBook.markets?.length ?? 0;
        const currentMarkets = current.markets?.length ?? 0;
        if (bookTimestamp(incomingBook) > bookTimestamp(current) || (bookTimestamp(incomingBook) === bookTimestamp(current) && incomingMarkets > currentMarkets)) {
          event.bookmakers[index] = incomingBook;
        }
      }
    }
  }
  return [...merged.values()];
}

function providerMessage(status: number, text: string) {
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? `HTTP ${status}`;
  } catch {
    return `HTTP ${status}`;
  }
}

async function fetchOdds(key: string, from?: string, to?: string) {
  const base = 'https://parlay-api.com/v1/sports/americanfootball_nfl/odds';
  const query = new URLSearchParams({
    regions: 'us',
    markets: 'spreads,totals',
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  if (from) query.set('commenceTimeFrom', from);
  if (to) query.set('commenceTimeTo', to);

  let response = await fetch(`${base}?${query.toString()}`, {
    headers: { 'X-API-Key': key },
  });
  let text = await response.text();

  if (response.status === 401) {
    const retryQuery = new URLSearchParams(query);
    retryQuery.set('apiKey', key);
    response = await fetch(`${base}?${retryQuery.toString()}`);
    text = await response.text();
  }

  if (!response.ok && (response.status === 400 || response.status === 422)) {
    const simpler = new URLSearchParams({
      regions: 'us',
      markets: 'spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
    });
    response = await fetch(`${base}?${simpler.toString()}`, {
      headers: { 'X-API-Key': key },
    });
    text = await response.text();
  }

  if (response.ok) {
    const rawCredits = response.headers.get('x-credits-remaining') ?? response.headers.get('x-requests-remaining');
    const credits = rawCredits === null ? null : Number(rawCredits);
    return {
      events: parseOddsEvents(text),
      creditsRemaining: credits !== null && Number.isFinite(credits) ? credits : null,
      partialBoard: response.headers.get('x-result-has-more') === 'true',
      providerName: 'ParlayAPI game lines',
      providerNotice: null as string | null,
      providerUnavailable: false,
    };
  }

  const primaryStatus = response.status;
  const primaryMessage = providerMessage(primaryStatus, text);
  console.warn('nfl_game_lines_primary_failed', `${primaryStatus}:${primaryMessage.slice(0, 120)}`);

  const previewResponse = await fetch('https://parlay-api.com/v1/try/americanfootball_nfl/odds');
  const previewText = await previewResponse.text();
  if (previewResponse.ok) {
    return {
      events: parseOddsEvents(previewText),
      creditsRemaining: primaryStatus === 403 ? 0 : null,
      partialBoard: true,
      providerName: 'ParlayAPI public preview',
      providerNotice: primaryStatus === 403
        ? 'Your ParlayAPI monthly credits are exhausted, so EdgeBoard switched to the public NFL preview. The preview is partial and should be treated as a watchlist, not a complete board.'
        : `The full NFL feed returned ${primaryStatus}. EdgeBoard automatically switched to the public preview so the app stays usable. The preview is partial.`,
      providerUnavailable: false,
    };
  }

  console.warn('nfl_game_lines_preview_failed', `${previewResponse.status}:${providerMessage(previewResponse.status, previewText).slice(0, 120)}`);
  return {
    events: [] as OddsEvent[],
    creditsRemaining: primaryStatus === 403 ? 0 : null,
    partialBoard: true,
    providerName: 'NFL market feed unavailable',
    providerNotice: primaryStatus === 403
      ? 'ParlayAPI reports that the monthly credit allowance is exhausted, and the public preview is currently unavailable. No NFL edge is calculated until market data is available again.'
      : `The NFL market feed is temporarily unavailable (${primaryStatus}). EdgeBoard did not fabricate or reuse stale lines. Retry shortly.`,
    providerUnavailable: true,
  };
}

export async function scanNflKymGameLines(
  input: { mode?: string; from?: string; to?: string },
  allowProviderRequests = false,
) {
  if (input.mode === 'demo') return demoResponse();
  const key = allowProviderRequests ? await readParlayKey() : null;
  const parlay = key
    ? await fetchOdds(key, input.from, input.to)
    : {
        events: [] as OddsEvent[],
        creditsRemaining: null,
        partialBoard: true,
        providerName: allowProviderRequests ? 'ParlayAPI not configured' : 'ParlayAPI opt-in required',
        providerNotice: allowProviderRequests
          ? 'ParlayAPI is not configured. EdgeBoard is using public alternatives.'
          : 'Public scans do not use provider credits. Optional keyed feeds require a separate authorized request.',
        providerUnavailable: true,
      };
  const alternate = await fetchAlternativeNflOdds(input.from, input.to, allowProviderRequests);
  const events = mergeOddsEvents([parlay.events, alternate.events]);
  const parlayHealth: ProviderHealth = {
    id: 'parlay',
    name: 'ParlayAPI',
    status: !key
      ? 'unconfigured'
      : parlay.creditsRemaining === 0
        ? 'exhausted'
        : parlay.providerName.includes('public preview')
          ? 'partial'
          : parlay.providerUnavailable
            ? 'error'
            : 'active',
    detail: !key
      ? allowProviderRequests ? 'Primary feed is not configured.' : 'Provider requests are disabled for public scans.'
      : parlay.providerNotice ?? 'Primary sportsbook feed active.',
    eventCount: parlay.events.length,
    bookCount: new Set(parlay.events.flatMap(event => event.bookmakers?.map(book => book.key ?? '') ?? []).filter(Boolean)).size,
  };
  const activeSportsbookProviders = [parlayHealth, ...alternate.providerHealth].filter(item => ['active', 'partial'].includes(item.status) && !['kalshi', 'clearsports', 'weather'].includes(item.id));
  const providerName = activeSportsbookProviders.length > 1
    ? `Multi-source consensus · ${activeSportsbookProviders.map(item => item.name).join(' + ')}`
    : activeSportsbookProviders[0]?.name ?? 'Prediction-market context only';
  let providerNotice = parlay.providerNotice;
  let partialBoard = parlay.partialBoard || activeSportsbookProviders.length === 0;
  const creditsRemaining = parlay.creditsRemaining;
  const start = input.from ? Date.parse(input.from) : NaN;
  const end = input.to ? Date.parse(input.to) : NaN;
  const now = Date.now();
  const kickoffLockTime = now + 60 * 1000;
  const usableEvents = events.filter(event => {
    if (!event.commence_time) return false;
    const kickoff = Date.parse(event.commence_time);
    if (!Number.isFinite(kickoff) || kickoff <= kickoffLockTime) return false;
    if (Number.isFinite(start) && kickoff < start) return false;
    if (Number.isFinite(end) && kickoff >= end) return false;
    return true;
  });
  const edges: KymGameLineEdge[] = [];
  let baselineGamesMatched = 0;
  let baselineMarketsCompared = 0;
  const sourceKeys = new Set<string>();

  for (const event of usableEvents) {
    const baseline = nflBaselines.find(item => eventMatches(event, item));
    if (!baseline) continue;
    baselineGamesMatched += 1;
    for (const book of event.bookmakers ?? []) {
      const key = (book.key ?? '').toLowerCase();
      if (key && freshEnough(book) && !excludedBookKeys.has(key) && !predictionBookKeys.has(key)) sourceKeys.add(key);
    }
    if (typeof baseline.awaySpread === 'number' && event.away_team) {
      baselineMarketsCompared += 1;
      const edge = buildSpreadEdge(event, event.away_team, baseline.awaySpread);
      if (edge) edges.push(edge);
    }
    if (typeof baseline.homeSpread === 'number' && event.home_team) {
      baselineMarketsCompared += 1;
      const edge = buildSpreadEdge(event, event.home_team, baseline.homeSpread);
      if (edge) edges.push(edge);
    }
    if (typeof baseline.total === 'number') {
      baselineMarketsCompared += 1;
      const edge = buildTotalEdge(event, baseline.total);
      if (edge) edges.push(edge);
    }
  }

  edges.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'strong' ? -1 : 1;
    if (a.lineAdvantage !== b.lineAdvantage) return b.lineAdvantage - a.lineAdvantage;
    return b.refCount - a.refCount;
  });

  const scoredEdges = edges.map(edge => ({
    ...edge,
    ...scoreKymEdge({
      marketType: edge.marketType,
      pick: edge.pick,
      lineAdvantage: edge.lineAdvantage,
      consensusRange: edge.consensusHigh - edge.consensusLow,
      refCount: edge.refCount,
      keyNumberCrossed: edge.keyNumberCrossed,
      consensusLine: edge.consensusLine,
      predictionConsensus: edge.predictionConsensus,
      commenceTime: edge.commenceTime,
    }),
  }));

  const context = await fetchNflGameContext(usableEvents, allowProviderRequests);
  const providerHealth = [parlayHealth, ...alternate.providerHealth, ...context.providerHealth];
  const hasSportsbookGameLines = usableEvents.some(event => (event.bookmakers ?? []).some(book => (book.markets ?? []).some(market => market.key === 'spreads' || market.key === 'totals')));
  const consensusAvailable = sourceKeys.size >= 2;
  const providerUnavailable = !consensusAvailable;
  partialBoard = partialBoard || !consensusAvailable;
  if (baselineGamesMatched > 0 && !consensusAvailable) {
    providerNotice = `${sourceKeys.size} fresh sportsbook book${sourceKeys.size === 1 ? '' : 's'} matched the remaining KYM baseline games. EdgeBoard requires at least 2 independent books before labeling a line edge.`;
  } else if (parlay.creditsRemaining === 0 && consensusAvailable) {
    const fallbacks = activeSportsbookProviders.filter(item => item.id !== 'parlay' && item.bookCount > 0).map(item => item.name);
    providerNotice = fallbacks.length ? `ParlayAPI credits are exhausted. Verified sportsbook coverage is being supplied by ${fallbacks.join(' + ')}.` : parlay.providerNotice;
  } else if (!hasSportsbookGameLines) {
    providerNotice = 'No fresh pregame spread/total rows are available before the kickoff lock. EdgeBoard locks KYM cards one minute before scheduled kickoff and never reuses a completed game or live line.';
  }
  const remaining = Number.isFinite(creditsRemaining) ? creditsRemaining : null;
  return {
    mode: 'live' as const,
    provider: providerName,
    underdogStatus: 'fresh' as const,
    sport: 'americanfootball_nfl',
    scanKind: 'kym' as const,
    marketTiming: 'pregame' as const,
    maxQuoteAgeSeconds: MAX_GAME_LINE_AGE_SECONDS,
    generatedAt: new Date().toISOString(),
    eventCount: usableEvents.length,
    creditsUsed: key ? 4 : 0,
    creditsRemaining: remaining,
    partialBoard,
    underdogPropsLoaded: 0,
    liveUnderdogPropsLoaded: 0,
    pregameUnderdogPropsLoaded: 0,
    referencePropsLoaded: 0,
    referenceBookCount: sourceKeys.size,
    consensusAvailable,
    rawPriceStatus: consensusAvailable ? 'verified' as const : 'pending' as const,
    candidatesScreened: 0,
    candidateScopeCount: 0,
    rawEventChecks: 0,
    rawEventCap: 0,
    rawVerifiedCount: 0,
    rawSeriesTruncated: false,
    baselineGamesMatched,
    baselineMarketsCompared,
    edges: [],
    kalshiMarkets: [],
    gameLineEdges: scoredEdges,
    edgeModel: {
      version: EDGE_MODEL_VERSION,
      thresholds: [
        'Market screening only; no independently validated contest outcome model is connected.',
        'Two-point/key-number movement remains a descriptive guardrail, not an automatic bet.',
        'Signals expire one minute before scheduled kickoff and require line/price re-verification.',
      ],
    },
    riskPolicy: BANKROLL_POLICY,
    providerHealth: null,
    gameContext: context.gameContext,
    predictionContext: alternate.predictionContext,
    providerNotice,
    providerUnavailable,
    note: baselineGamesMatched === 0
      ? `Found ${usableEvents.length} unlocked pregame NFL event${usableEvents.length === 1 ? '' : 's'}, but none matched the saved Sep 14 KYM baselines. Games lock one minute before scheduled kickoff and are excluded after that point.`
      : !consensusAvailable
        ? `Matched ${baselineGamesMatched} saved KYM game${baselineGamesMatched === 1 ? '' : 's'}, but only ${sourceKeys.size} fresh independent sportsbook book${sourceKeys.size === 1 ? '' : 's'} matched those games. EdgeBoard requires two before calculating a verified edge.`
        : `Matched ${baselineGamesMatched} saved Sep 14 KYM games and compared ${baselineMarketsCompared} baseline markets against ${sourceKeys.size} fresh independent sportsbook books. Main consensus uses quotes no more than 15 minutes old and excludes stale/topped-up blocks.`,


  };
}
