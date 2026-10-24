type EspnTeam = {
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  abbreviation?: string;
};

type EspnCompetitor = {
  homeAway?: 'home' | 'away';
  team?: EspnTeam;
};

type EspnCompetition = {
  id?: string;
  date?: string;
  competitors?: EspnCompetitor[];
};

type EspnEvent = {
  id?: string;
  date?: string;
  name?: string;
  shortName?: string;
  status?: { type?: { state?: string; completed?: boolean; description?: string } };
  competitions?: EspnCompetition[];
};

type EspnOddsItem = {
  provider?: { id?: string | number; name?: string };
  details?: string;
  overUnder?: number | null;
  spread?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;
  homeTeamOdds?: {
    favorite?: boolean;
    underdog?: boolean;
    moneyLine?: number | null;
    spreadOdds?: number | null;
  };
  awayTeamOdds?: {
    favorite?: boolean;
    underdog?: boolean;
    moneyLine?: number | null;
    spreadOdds?: number | null;
  };
  drawOdds?: {
    moneyLine?: number | null;
  };
};

export type GameMarketQuote = {
  eventId: string;
  event: string;
  sport: string;
  league: string;
  commenceTime: string;
  marketStatus: 'pregame';
  market: 'moneyline' | 'spread' | 'total';
  selection: string;
  line: number | null;
  settlementKey: string;
  book: string;
  americanOdds: number;
  decimalOdds: number;
  rawImpliedProbability: number;
  deViggedComparator: number | null;
  bookMargin: number | null;
  retrievedAt: string;
  oddsTimestamp: null;
  latencySeconds: null;
  researchStatus: 'SCREEN_ONLY';
  reasonsToAbstain: string[];
};

export type GameMarketBestPrice = {
  key: string;
  eventId: string;
  event: string;
  sport: string;
  league: string;
  commenceTime: string;
  market: 'moneyline' | 'spread' | 'total';
  selection: string;
  line: number | null;
  settlementKey: string;
  bestBook: string;
  bestAmericanOdds: number;
  bestDecimalOdds: number;
  rawImpliedProbability: number;
  deViggedComparator: number | null;
  bookMargin: number | null;
  otherBookCount: number;
  books: Array<{ book: string; americanOdds: number; decimalOdds: number; deViggedComparator: number | null }>;
  retrievedAt: string;
  oddsTimestamp: null;
  researchStatus: 'SCREEN_ONLY';
  reasonsToAbstain: string[];
};

const sportMap: Record<string, { espnSport: string; league: string; label: string }> = {
  baseball_mlb: { espnSport: 'baseball', league: 'mlb', label: 'MLB' },
  americanfootball_nfl: { espnSport: 'football', league: 'nfl', label: 'NFL' },
  americanfootball_ncaaf: { espnSport: 'football', league: 'college-football', label: 'NCAAF' },
  basketball_nba: { espnSport: 'basketball', league: 'nba', label: 'NBA' },
  basketball_wnba: { espnSport: 'basketball', league: 'wnba', label: 'WNBA' },
  icehockey_nhl: { espnSport: 'hockey', league: 'nhl', label: 'NHL' },
};

const CACHE_MS = 45_000;
const cache = new Map<string, { at: number; result: ReturnType<typeof emptyResult> & { quotes: GameMarketQuote[]; bestPrices: GameMarketBestPrice[] } }>();

function emptyResult(sport: string, supported = true) {
  const mapping = sportMap[sport];
  return {
    provider: 'ESPN public odds',
    sourceMode: 'free-public',
    cost: '$0',
    sport,
    league: mapping?.label ?? sport,
    supported,
    pregame: true,
    live: false,
    historical: false,
    generatedAt: new Date().toISOString(),
    eventCount: 0,
    quoteCount: 0,
    bestPriceCount: 0,
    oddsTimestampAvailable: false,
    latencyKnown: false,
    quoteTimestampPolicy: 'Retrieval time is recorded, but ESPN sportsbook quote timestamps are not exposed by this adapter.',
    modelPolicy: 'No independent validated probability model is attached, so no EV is calculated.',
    settlementPolicy: 'Exact market, selection and line identity is preserved. Sportsbook-specific grading rules are not independently verified.',
    quotes: [] as GameMarketQuote[],
    bestPrices: [] as GameMarketBestPrice[],
  };
}

function teamName(team?: EspnTeam) {
  return team?.displayName ?? team?.shortDisplayName ?? team?.name ?? '';
}

function americanToDecimal(price: number) {
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function rawImplied(price: number) {
  const decimal = americanToDecimal(price);
  return decimal ? 1 / decimal : null;
}

function dateToken(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dateTokens(hours: number) {
  const start = new Date();
  const end = new Date(Date.now() + hours * 60 * 60 * 1000);
  const tokens = new Set<string>();
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor.getTime() <= last.getTime() && tokens.size < 5) {
    tokens.add(dateToken(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return [...tokens];
}

function spreadPoints(item: EspnOddsItem, home: EspnCompetitor, away: EspnCompetitor) {
  const rawSpread = typeof item.spread === 'number' ? Math.abs(item.spread) : NaN;
  if (!Number.isFinite(rawSpread)) return null;
  if (item.homeTeamOdds?.favorite && !item.awayTeamOdds?.favorite) {
    return { home: -rawSpread, away: rawSpread };
  }
  if (item.awayTeamOdds?.favorite && !item.homeTeamOdds?.favorite) {
    return { home: rawSpread, away: -rawSpread };
  }
  const match = item.details?.trim().match(/^([A-Za-z0-9.-]+)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const token = match[1].toLowerCase();
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  const homeAbbr = home.team?.abbreviation?.toLowerCase();
  const awayAbbr = away.team?.abbreviation?.toLowerCase();
  if (homeAbbr && token === homeAbbr) return { home: line, away: -line };
  if (awayAbbr && token === awayAbbr) return { home: -line, away: line };
  return null;
}

function completeMarketProbabilities(prices: number[]) {
  const implied = prices.map(rawImplied);
  if (implied.some(value => value === null)) return null;
  const probabilities = implied as number[];
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return { margin: total - 1, fair: probabilities.map(value => value / total) };
}

function baseReasons() {
  return [
    'sportsbook quote timestamp unavailable; retrieval time is not a substitute',
    'sportsbook-specific settlement rules not independently verified',
    'independent probability model not validated',
    'uncertainty interval not validated',
  ];
}

function addMarketQuotes(input: {
  quotes: GameMarketQuote[];
  eventId: string;
  event: string;
  sport: string;
  league: string;
  commenceTime: string;
  book: string;
  market: 'moneyline' | 'spread' | 'total';
  selections: Array<{ selection: string; line: number | null; price: number | null | undefined }>;
  retrievedAt: string;
}) {
  const valid = input.selections.filter(item => typeof item.price === 'number' && item.price !== 0) as Array<{
    selection: string;
    line: number | null;
    price: number;
  }>;
  if (valid.length < 2) return;

  const devig = completeMarketProbabilities(valid.map(item => item.price));
  for (const [index, item] of valid.entries()) {
    const decimal = americanToDecimal(item.price);
    const implied = rawImplied(item.price);
    if (!decimal || implied === null) continue;
    const lineKey = item.line === null ? 'none' : item.line.toFixed(3);
    input.quotes.push({
      eventId: input.eventId,
      event: input.event,
      sport: input.sport,
      league: input.league,
      commenceTime: input.commenceTime,
      marketStatus: 'pregame',
      market: input.market,
      selection: item.selection,
      line: item.line,
      settlementKey: `${input.eventId}|${input.market}|${item.selection}|${lineKey}|full-game`,
      book: input.book,
      americanOdds: item.price,
      decimalOdds: decimal,
      rawImpliedProbability: implied,
      deViggedComparator: devig?.fair[index] ?? null,
      bookMargin: devig?.margin ?? null,
      retrievedAt: input.retrievedAt,
      oddsTimestamp: null,
      latencySeconds: null,
      researchStatus: 'SCREEN_ONLY',
      reasonsToAbstain: baseReasons(),
    });
  }
}

async function fetchScoreboard(mapping: { espnSport: string; league: string }, token: string) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${mapping.espnSport}/${mapping.league}/scoreboard?dates=${token}&limit=100`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESPN_SCOREBOARD:${response.status}`);
  const payload = await response.json() as { events?: EspnEvent[] };
  return payload.events ?? [];
}

async function eventQuotes(
  sportKey: string,
  mapping: { espnSport: string; league: string; label: string },
  event: EspnEvent,
  retrievedAt: string
) {
  const competition = event.competitions?.[0];
  const eventId = event.id;
  const competitionId = competition?.id ?? eventId;
  const home = competition?.competitors?.find(item => item.homeAway === 'home');
  const away = competition?.competitors?.find(item => item.homeAway === 'away');
  const homeName = teamName(home?.team);
  const awayName = teamName(away?.team);
  const commenceTime = competition?.date ?? event.date ?? '';
  if (!eventId || !competitionId || !home || !away || !homeName || !awayName || !commenceTime) return [];
  if (Date.parse(commenceTime) <= Date.now()) return [];
  const state = event.status?.type?.state?.toLowerCase();
  if (event.status?.type?.completed || state === 'in' || state === 'post') return [];

  const url = `https://sports.core.api.espn.com/v2/sports/${mapping.espnSport}/leagues/${mapping.league}/events/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(competitionId)}/odds?limit=50`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = await response.json() as { items?: EspnOddsItem[] };
  const quotes: GameMarketQuote[] = [];
  const eventLabel = event.name ?? event.shortName ?? `${awayName} @ ${homeName}`;

  for (const item of payload.items ?? []) {
    const book = item.provider?.name?.trim();
    if (!book) continue;

    addMarketQuotes({
      quotes,
      eventId,
      event: eventLabel,
      sport: sportKey,
      league: mapping.label,
      commenceTime,
      book,
      market: 'moneyline',
      selections: [
        { selection: awayName, line: null, price: item.awayTeamOdds?.moneyLine },
        { selection: homeName, line: null, price: item.homeTeamOdds?.moneyLine },
        ...(typeof item.drawOdds?.moneyLine === 'number'
          ? [{ selection: 'Draw', line: null, price: item.drawOdds.moneyLine }]
          : []),
      ],
      retrievedAt,
    });

    const spread = spreadPoints(item, home, away);
    if (spread) {
      addMarketQuotes({
        quotes,
        eventId,
        event: eventLabel,
        sport: sportKey,
        league: mapping.label,
        commenceTime,
        book,
        market: 'spread',
        selections: [
          { selection: awayName, line: spread.away, price: item.awayTeamOdds?.spreadOdds },
          { selection: homeName, line: spread.home, price: item.homeTeamOdds?.spreadOdds },
        ],
        retrievedAt,
      });
    }

    if (typeof item.overUnder === 'number') {
      addMarketQuotes({
        quotes,
        eventId,
        event: eventLabel,
        sport: sportKey,
        league: mapping.label,
        commenceTime,
        book,
        market: 'total',
        selections: [
          { selection: 'Over', line: item.overUnder, price: item.overOdds },
          { selection: 'Under', line: item.overUnder, price: item.underOdds },
        ],
        retrievedAt,
      });
    }
  }

  return quotes;
}

function bestPrices(quotes: GameMarketQuote[]) {
  const groups = new Map<string, GameMarketQuote[]>();
  for (const quote of quotes) {
    const rows = groups.get(quote.settlementKey) ?? [];
    rows.push(quote);
    groups.set(quote.settlementKey, rows);
  }

  const output: GameMarketBestPrice[] = [];
  for (const [key, rows] of groups.entries()) {
    const ordered = [...rows].sort((a, b) => b.decimalOdds - a.decimalOdds);
    const best = ordered[0];
    output.push({
      key,
      eventId: best.eventId,
      event: best.event,
      sport: best.sport,
      league: best.league,
      commenceTime: best.commenceTime,
      market: best.market,
      selection: best.selection,
      line: best.line,
      settlementKey: best.settlementKey,
      bestBook: best.book,
      bestAmericanOdds: best.americanOdds,
      bestDecimalOdds: best.decimalOdds,
      rawImpliedProbability: best.rawImpliedProbability,
      deViggedComparator: best.deViggedComparator,
      bookMargin: best.bookMargin,
      otherBookCount: Math.max(0, ordered.length - 1),
      books: ordered.map(row => ({
        book: row.book,
        americanOdds: row.americanOdds,
        decimalOdds: row.decimalOdds,
        deViggedComparator: row.deViggedComparator,
      })),
      retrievedAt: best.retrievedAt,
      oddsTimestamp: null,
      researchStatus: 'SCREEN_ONLY',
      reasonsToAbstain: best.reasonsToAbstain,
    });
  }
  return output.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime) || a.event.localeCompare(b.event));
}

export async function getFreeGameOdds(sport: string, hours = 48) {
  const mapping = sportMap[sport];
  if (!mapping) return emptyResult(sport, false);
  const boundedHours = Math.min(96, Math.max(1, hours));
  const cacheKey = `${sport}|${boundedHours}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  const tokens = dateTokens(boundedHours);
  const scoreboards = await Promise.all(tokens.map(token => fetchScoreboard(mapping, token)));
  const unique = new Map<string, EspnEvent>();
  for (const event of scoreboards.flat()) {
    if (event.id) unique.set(event.id, event);
  }
  const cutoff = Date.now() + boundedHours * 60 * 60 * 1000;
  const eligible = [...unique.values()].filter(event => {
    const time = Date.parse(event.competitions?.[0]?.date ?? event.date ?? '');
    return Number.isFinite(time) && time > Date.now() && time <= cutoff;
  }).slice(0, 40);

  const retrievedAt = new Date().toISOString();
  const quoteGroups = await Promise.all(
    eligible.map(event => eventQuotes(sport, mapping, event, retrievedAt))
  );
  const quotes = quoteGroups.flat();
  const best = bestPrices(quotes);
  const result = {
    ...emptyResult(sport, true),
    generatedAt: new Date().toISOString(),
    eventCount: new Set(quotes.map(quote => quote.eventId)).size,
    quoteCount: quotes.length,
    bestPriceCount: best.length,
    quotes,
    bestPrices: best,
  };
  cache.set(cacheKey, { at: Date.now(), result });
  return result;
}
