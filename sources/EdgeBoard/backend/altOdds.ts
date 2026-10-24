import { secrets } from '@appdeploy/sdk';

export type NormalizedOddsOutcome = {
  name?: string;
  price?: number | null;
  point?: number | null;
};

export type NormalizedOddsMarket = {
  key?: string;
  outcomes?: NormalizedOddsOutcome[];
};

export type NormalizedOddsBook = {
  key?: string;
  title?: string;
  last_update?: string;
  last_update_ms?: number;
  stale_seconds?: number;
  topped_up?: boolean;
  provider?: string;
  markets?: NormalizedOddsMarket[];
};

export type NormalizedOddsEvent = {
  id?: string;
  canonical_event_id?: string;
  commence_time?: string | null;
  home_team?: string;
  away_team?: string;
  bookmakers?: NormalizedOddsBook[];
};

export type ProviderHealth = {
  id: string;
  name: string;
  status: 'active' | 'unconfigured' | 'exhausted' | 'error' | 'partial' | 'public';
  detail: string;
  eventCount: number;
  bookCount: number;
};

export type PredictionContext = {
  source: string;
  title: string;
  probability: number | null;
  closeTime: string | null;
};

type SharpRow = {
  id?: string;
  sportsbook?: string;
  event_id?: string;
  home_team?: string;
  away_team?: string;
  market_type?: string;
  selection?: string;
  selection_type?: string;
  odds_american?: number | null;
  line?: number | null;
  is_live?: boolean;
  start_time?: string;
  timestamp?: string;
};

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

type EspnScoreboardEvent = {
  id?: string;
  date?: string;
  competitions?: Array<{
    id?: string;
    date?: string;
    competitors?: EspnCompetitor[];
  }>;
};

type EspnOddsItem = {
  provider?: { id?: string | number; name?: string };
  details?: string;
  overUnder?: number | null;
  spread?: number | null;
  homeTeamOdds?: { favorite?: boolean; spreadOdds?: number | null };
  awayTeamOdds?: { favorite?: boolean; spreadOdds?: number | null };
};

type KalshiMarket = {
  ticker?: string;
  title?: string;
  yes_sub_title?: string;
  status?: string;
  close_time?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
};

function normalize(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function inWindow(time?: string, from?: string, to?: string) {
  if (!time) return true;
  const millis = Date.parse(time);
  if (!Number.isFinite(millis)) return true;
  if (millis <= Date.now()) return false;
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : NaN;
  if (Number.isFinite(start) && millis < start) return false;
  if (Number.isFinite(end) && millis >= end) return false;
  return true;
}

function parseNumberFromSelection(selection?: string) {
  const matches = (selection ?? '').match(/[+-]?\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
}

function selectedTeam(row: SharpRow) {
  const type = (row.selection_type ?? '').toLowerCase();
  if (type === 'home') return row.home_team ?? null;
  if (type === 'away') return row.away_team ?? null;
  const selection = normalize(row.selection);
  const home = normalize(row.home_team);
  const away = normalize(row.away_team);
  if (home && selection.includes(home)) return row.home_team ?? null;
  if (away && selection.includes(away)) return row.away_team ?? null;
  const homeNickname = normalize(row.home_team?.split(' ').at(-1));
  const awayNickname = normalize(row.away_team?.split(' ').at(-1));
  if (homeNickname && selection.includes(homeNickname)) return row.home_team ?? null;
  if (awayNickname && selection.includes(awayNickname)) return row.away_team ?? null;
  return null;
}

function ensureBook(event: NormalizedOddsEvent, row: SharpRow) {
  const sportsbook = (row.sportsbook ?? 'sharpapi').trim();
  const key = normalize(sportsbook) || 'sharpapi';
  event.bookmakers ??= [];
  let book = event.bookmakers.find(item => item.key === key);
  if (!book) {
    book = {
      key,
      title: sportsbook,
      last_update: row.timestamp,
      provider: 'SharpAPI',
      markets: [],
    };
    event.bookmakers.push(book);
  }
  if (row.timestamp && (!book.last_update || Date.parse(row.timestamp) > Date.parse(book.last_update))) {
    book.last_update = row.timestamp;
  }
  return book;
}

function ensureMarket(book: NormalizedOddsBook, key: 'spreads' | 'totals') {
  book.markets ??= [];
  let market = book.markets.find(item => item.key === key);
  if (!market) {
    market = { key, outcomes: [] };
    book.markets.push(market);
  }
  market.outcomes ??= [];
  return market;
}

function upsertOutcome(market: NormalizedOddsMarket, outcome: NormalizedOddsOutcome) {
  market.outcomes ??= [];
  const existing = market.outcomes.find(item => normalize(item.name) === normalize(outcome.name));
  if (existing) Object.assign(existing, outcome);
  else market.outcomes.push(outcome);
}

function sharpRowsToEvents(rows: SharpRow[], from?: string, to?: string) {
  const events = new Map<string, NormalizedOddsEvent>();
  for (const row of rows) {
    if (row.is_live || !row.home_team || !row.away_team || !inWindow(row.start_time, from, to)) continue;
    const marketType = (row.market_type ?? '').toLowerCase();
    if (!['point_spread', 'spread', 'spreads', 'total_points', 'total', 'totals'].includes(marketType)) continue;
    const eventKey = row.event_id ?? `${normalize(row.away_team)}|${normalize(row.home_team)}|${row.start_time ?? ''}`;
    let event = events.get(eventKey);
    if (!event) {
      event = {
        id: row.event_id ?? eventKey,
        commence_time: row.start_time ?? null,
        home_team: row.home_team,
        away_team: row.away_team,
        bookmakers: [],
      };
      events.set(eventKey, event);
    }
    const book = ensureBook(event, row);
    const line = typeof row.line === 'number' ? row.line : parseNumberFromSelection(row.selection);
    if (line === null) continue;
    if (['point_spread', 'spread', 'spreads'].includes(marketType)) {
      const team = selectedTeam(row);
      if (!team) continue;
      upsertOutcome(ensureMarket(book, 'spreads'), {
        name: team,
        point: line,
        price: row.odds_american ?? null,
      });
    } else {
      const selection = (row.selection ?? row.selection_type ?? '').toLowerCase();
      const side = selection.includes('under') ? 'Under' : selection.includes('over') ? 'Over' : null;
      if (!side) continue;
      upsertOutcome(ensureMarket(book, 'totals'), {
        name: side,
        point: Math.abs(line),
        price: row.odds_american ?? null,
      });
    }
  }
  return [...events.values()].filter(event => event.bookmakers?.some(book => book.markets?.length));
}

async function fetchSharpApi(key: string, from?: string, to?: string) {
  const teamMap: Record<string, string> = {
    ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
  };
  const expandTeam = (value?: string) => {
    const clean = (value ?? '').trim();
    return teamMap[clean.toUpperCase()] ?? clean;
  };
  const parseTeams = (value?: string) => {
    const parts = (value ?? '').split(/\s+@\s+|\s+vs\.?\s+/i);
    if (parts.length !== 2) return null;
    return { away: expandTeam(parts[0]), home: expandTeam(parts[1]) };
  };
  const normalizePayload = (text: string): SharpRow[] => {
    const parsed = JSON.parse(text) as unknown;
    const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    const items = Array.isArray(parsed) ? parsed : Array.isArray(root?.data) ? root.data : [];
    const rows: SharpRow[] = [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const outcomes = Array.isArray(item.outcomes) ? item.outcomes : null;
      const eventName = typeof item.event === 'string' ? item.event : typeof item.event_name === 'string' ? item.event_name : undefined;
      const teams = parseTeams(eventName);
      const startTime = typeof item.start_time === 'string' ? item.start_time : typeof item.event_start_time === 'string' ? item.event_start_time : undefined;
      const marketType = typeof item.market_type === 'string' ? item.market_type : typeof item.market === 'string' ? item.market : undefined;
      if (outcomes) {
        for (const rawOutcome of outcomes) {
          if (!rawOutcome || typeof rawOutcome !== 'object' || Array.isArray(rawOutcome)) continue;
          const outcome = rawOutcome as Record<string, unknown>;
          const rawSelection = typeof outcome.selection === 'string' ? outcome.selection : undefined;
          const firstToken = rawSelection?.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '').toUpperCase();
          const selection = firstToken && teamMap[firstToken] ? rawSelection?.replace(/^\S+/, teamMap[firstToken]) : rawSelection;
          rows.push({
            id: typeof outcome.id === 'string' ? outcome.id : typeof item.id === 'string' ? item.id : undefined,
            sportsbook: typeof outcome.sportsbook === 'string' ? outcome.sportsbook : undefined,
            event_id: typeof item.event_id === 'string' ? item.event_id : undefined,
            home_team: typeof item.home_team === 'string' ? item.home_team : teams?.home,
            away_team: typeof item.away_team === 'string' ? item.away_team : teams?.away,
            market_type: marketType,
            selection,
            selection_type: typeof outcome.selection_type === 'string' ? outcome.selection_type : undefined,
            odds_american: typeof outcome.odds_american === 'number' ? outcome.odds_american : null,
            line: typeof outcome.line === 'number' ? outcome.line : null,
            is_live: typeof item.is_live === 'boolean' ? item.is_live : false,
            start_time: startTime,
            timestamp: typeof outcome.timestamp === 'string' ? outcome.timestamp : typeof item.timestamp === 'string' ? item.timestamp : undefined,
          });
        }
        continue;
      }
      const row = item as unknown as SharpRow;
      rows.push({
        ...row,
        home_team: row.home_team || teams?.home,
        away_team: row.away_team || teams?.away,
        market_type: row.market_type || marketType,
        start_time: row.start_time || startTime,
      });
    }
    return rows;
  };
  const requestMarket = async (marketType: 'point_spread' | 'total_points') => {
    const query = new URLSearchParams({ league: 'NFL', is_live: 'false', market_type: marketType, limit: '1000' });
    const url = `https://api.sharpapi.io/api/v1/odds?${query.toString()}`;
    let response = await fetch(url, { headers: { 'X-API-Key': key, Accept: 'application/json' } });
    if (response.status === 401) response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    return { response, text: await response.text() };
  };
  const results = await Promise.all([requestMarket('point_spread'), requestMarket('total_points')]);
  const okResults = results.filter(result => result.response.ok);
  if (!okResults.length) {
    const status = results[0]?.response.status ?? 500;
    return {
      events: [] as NormalizedOddsEvent[],
      health: { id: 'sharpapi', name: 'SharpAPI', status: status === 403 ? 'exhausted' as const : 'error' as const, detail: `Spread/total requests failed (HTTP ${results.map(result => result.response.status).join('/')}). EdgeBoard excluded this source.`, eventCount: 0, bookCount: 0 },
    };
  }
  try {
    const rows = okResults.flatMap(result => normalizePayload(result.text));
    const events = sharpRowsToEvents(rows, from, to);
    const books = new Set(events.flatMap(event => event.bookmakers?.map(book => book.key ?? '') ?? []).filter(Boolean));
    return {
      events,
      health: {
        id: 'sharpapi',
        name: 'SharpAPI',
        status: events.length ? 'active' as const : 'partial' as const,
        detail: events.length ? `NFL spreads/totals active · ${books.size} distinct books across ${events.length} pregame events.` : 'Connected, but no matching pregame NFL spread/total rows were returned in the scan window.',
        eventCount: events.length,
        bookCount: books.size,
      },
    };
  } catch {
    return {
      events: [] as NormalizedOddsEvent[],
      health: { id: 'sharpapi', name: 'SharpAPI', status: 'error' as const, detail: 'SharpAPI returned an unreadable odds payload, so it was excluded from consensus.', eventCount: 0, bookCount: 0 },
    };
  }
}

function espnDateToken(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function espnTeamName(team?: EspnTeam) {
  return team?.displayName ?? team?.shortDisplayName ?? team?.name ?? null;
}

function spreadPoints(item: EspnOddsItem, home: EspnCompetitor, away: EspnCompetitor) {
  const magnitude = typeof item.spread === 'number' ? Math.abs(item.spread) : Math.abs(parseNumberFromSelection(item.details) ?? NaN);
  if (!Number.isFinite(magnitude)) return null;
  if (item.homeTeamOdds?.favorite && !item.awayTeamOdds?.favorite) return { home: -magnitude, away: magnitude };
  if (item.awayTeamOdds?.favorite && !item.homeTeamOdds?.favorite) return { home: magnitude, away: -magnitude };
  const match = item.details?.trim().match(/^([A-Za-z0-9.-]+)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const token = normalize(match[1]);
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  const homeAbbr = normalize(home.team?.abbreviation);
  const awayAbbr = normalize(away.team?.abbreviation);
  if (homeAbbr && token === homeAbbr) return { home: line, away: -line };
  if (awayAbbr && token === awayAbbr) return { home: -line, away: line };
  return null;
}

async function fetchEspnPublicOdds(from?: string, to?: string) {
  try {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(Math.max(Date.parse(to) - 1000, start.getTime())) : start;
    const startToken = espnDateToken(start);
    const endToken = espnDateToken(end);
    void startToken;
    void endToken;
    const scoreboardResponse = await fetch('https://cdn.espn.com/core/nfl/scoreboard?xhr=1&limit=50');
    if (!scoreboardResponse.ok) throw new Error(`scoreboard HTTP ${scoreboardResponse.status}`);
    const scoreboardPayload = await scoreboardResponse.json() as { events?: EspnScoreboardEvent[]; content?: { sbData?: { events?: EspnScoreboardEvent[] } } };
    const scoreboardEvents = scoreboardPayload.content?.sbData?.events ?? scoreboardPayload.events ?? [];
    const candidates = scoreboardEvents.filter(event => inWindow(event.competitions?.[0]?.date ?? event.date, from, to)).slice(0, 20);
    const events = (await Promise.all(candidates.map(async event => {
      const competition = event.competitions?.[0];
      const home = competition?.competitors?.find(item => item.homeAway === 'home');
      const away = competition?.competitors?.find(item => item.homeAway === 'away');
      const homeTeam = espnTeamName(home?.team);
      const awayTeam = espnTeamName(away?.team);
      const eventId = event.id;
      const competitionId = competition?.id ?? eventId;
      if (!eventId || !competitionId || !home || !away || !homeTeam || !awayTeam) return null;
      const oddsResponse = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(competitionId)}/odds`);
      if (!oddsResponse.ok) return null;
      const payload = await oddsResponse.json() as { items?: EspnOddsItem[] };
      const normalizedEvent: NormalizedOddsEvent = {
        id: `espn-${eventId}`,
        canonical_event_id: eventId,
        commence_time: competition?.date ?? event.date ?? null,
        home_team: homeTeam,
        away_team: awayTeam,
        bookmakers: [],
      };
      for (const item of payload.items ?? []) {
        const providerName = item.provider?.name?.trim();
        if (!providerName) continue;
        const book: NormalizedOddsBook = {
          key: normalize(providerName),
          title: providerName,
          provider: 'ESPN public odds',
          stale_seconds: 120,
          markets: [],
        };
        const spread = spreadPoints(item, home, away);
        if (spread) {
          book.markets?.push({
            key: 'spreads',
            outcomes: [
              { name: homeTeam, point: spread.home, price: item.homeTeamOdds?.spreadOdds ?? null },
              { name: awayTeam, point: spread.away, price: item.awayTeamOdds?.spreadOdds ?? null },
            ],
          });
        }
        if (typeof item.overUnder === 'number') {
          book.markets?.push({
            key: 'totals',
            outcomes: [
              { name: 'Over', point: item.overUnder, price: null },
              { name: 'Under', point: item.overUnder, price: null },
            ],
          });
        }
        if (book.markets?.length) normalizedEvent.bookmakers?.push(book);
      }
      return normalizedEvent.bookmakers?.length ? normalizedEvent : null;
    }))).filter((event): event is NormalizedOddsEvent => event !== null);
    const books = new Set(events.flatMap(event => event.bookmakers?.map(book => book.key ?? '') ?? []).filter(Boolean));
    return {
      events,
      health: {
        id: 'espn',
        name: 'ESPN public odds',
        status: events.length ? 'active' as const : 'partial' as const,
        detail: events.length ? `No-key NFL sportsbook snapshot active · ${books.size} books across ${events.length} events.` : 'Public ESPN endpoints are reachable, but no matching pregame spread/total rows were returned for this window.',
        eventCount: events.length,
        bookCount: books.size,
      },
    };
  } catch (espnError) {
    console.warn('espn_public_odds_failed', espnError instanceof Error ? espnError.message : 'unknown ESPN error');
    return {
      events: [] as NormalizedOddsEvent[],
      health: {
        id: 'espn',
        name: 'ESPN public odds',
        status: 'error' as const,
        detail: 'The no-key ESPN snapshot could not refresh. SharpAPI and other configured sources continue independently.',
        eventCount: 0,
        bookCount: 0,
      },
    };
  }
}

async function fetchTheOddsApi(key: string, from?: string, to?: string) {
  const query = new URLSearchParams({
    regions: 'us',
    markets: 'spreads,totals',
    oddsFormat: 'american',
    dateFormat: 'iso',
    apiKey: key,
  });
  const response = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?${query.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    return {
      events: [] as NormalizedOddsEvent[],
      health: {
        id: 'theoddsapi',
        name: 'The Odds API',
        status: response.status === 401 || response.status === 403 ? 'exhausted' as const : 'error' as const,
        detail: `HTTP ${response.status}. The source was excluded from consensus.`,
        eventCount: 0,
        bookCount: 0,
      },
    };
  }
  try {
    const parsed = JSON.parse(text) as NormalizedOddsEvent[];
    const events = (Array.isArray(parsed) ? parsed : []).filter(event => inWindow(event.commence_time ?? undefined, from, to)).map(event => ({
      ...event,
      bookmakers: (event.bookmakers ?? []).map(book => ({ ...book, provider: 'The Odds API' })),
    }));
    const books = new Set(events.flatMap(event => event.bookmakers?.map(book => book.key ?? '') ?? []).filter(Boolean));
    const remaining = response.headers.get('x-requests-remaining');
    return {
      events,
      health: {
        id: 'theoddsapi',
        name: 'The Odds API',
        status: events.length ? 'active' as const : 'partial' as const,
        detail: events.length ? `Current NFL odds active${remaining ? ` · ${remaining} requests remaining` : ''}.` : 'Connected, but no matching NFL events were returned.',
        eventCount: events.length,
        bookCount: books.size,
      },
    };
  } catch {
    return {
      events: [] as NormalizedOddsEvent[],
      health: {
        id: 'theoddsapi',
        name: 'The Odds API',
        status: 'error' as const,
        detail: 'The source returned an unreadable response. It was excluded from consensus.',
        eventCount: 0,
        bookCount: 0,
      },
    };
  }
}

function dollar(value?: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchKalshiContext(from?: string, to?: string) {
  try {
    const params = new URLSearchParams({
      limit: '100',
      category: 'Sports',
      competition: 'Pro Football',
      minimum_start_date: from ?? new Date().toISOString(),
    });
    const response = await fetch(`https://external-api.kalshi.com/trade-api/v2/milestones?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = await response.json() as {
      milestones?: Array<{
        start_date?: string;
        related_event_tickers?: string[];
        primary_event_tickers?: string[];
      }>;
    };
    const end = to ? Date.parse(to) : NaN;
    const tickers = new Set<string>();
    for (const milestone of parsed.milestones ?? []) {
      const start = milestone.start_date ? Date.parse(milestone.start_date) : NaN;
      if (Number.isFinite(end) && Number.isFinite(start) && start >= end) continue;
      for (const ticker of [...(milestone.primary_event_tickers ?? []), ...(milestone.related_event_tickers ?? [])]) {
        tickers.add(ticker);
        if (tickers.size >= 10) break;
      }
      if (tickers.size >= 10) break;
    }
    const eventResults = await Promise.all([...tickers].map(async ticker => {
      const eventResponse = await fetch(`https://external-api.kalshi.com/trade-api/v2/events/${encodeURIComponent(ticker)}?with_nested_markets=true`);
      if (!eventResponse.ok) return null;
      return await eventResponse.json() as {
        event?: { title?: string; markets?: KalshiMarket[] };
        markets?: KalshiMarket[];
      };
    }));
    const context: PredictionContext[] = [];
    for (const item of eventResults) {
      if (!item) continue;
      const eventTitle = item.event?.title ?? 'Kalshi NFL market';
      const markets = item.event?.markets ?? item.markets ?? [];
      for (const market of markets) {
        if (market.status && !['open', 'unopened'].includes(market.status)) continue;
        const closeTime = market.close_time ?? null;
        if (closeTime && !inWindow(closeTime, from, to)) continue;
        const bid = dollar(market.yes_bid_dollars);
        const ask = dollar(market.yes_ask_dollars);
        const probability = bid !== null && ask !== null ? (bid + ask) / 2 : ask ?? bid;
        context.push({
          source: 'Kalshi',
          title: `${eventTitle}${market.title ? ` — ${market.title}` : market.yes_sub_title ? ` — ${market.yes_sub_title}` : ''}`,
          probability,
          closeTime,
        });
        if (context.length >= 12) break;
      }
      if (context.length >= 12) break;
    }
    return {
      context,
      health: {
        id: 'kalshi',
        name: 'Kalshi',
        status: context.length ? 'public' as const : 'partial' as const,
        detail: context.length ? 'Public prediction-market context is active.' : 'Public endpoint is reachable, but no matching NFL markets were found in this window.',
        eventCount: context.length,
        bookCount: 0,
      },
    };
  } catch {
    return {
      context: [] as PredictionContext[],
      health: {
        id: 'kalshi',
        name: 'Kalshi',
        status: 'error' as const,
        detail: 'Public prediction-market context is temporarily unavailable.',
        eventCount: 0,
        bookCount: 0,
      },
    };
  }
}

export async function fetchAlternativeNflOdds(from?: string, to?: string, allowProviderRequests = false) {
  // ESPN and Kalshi remain public; keyed feeds are never an automatic fallback.
  const names = allowProviderRequests ? await secrets.listSecretNames() : [];
  const hasSharp = names.includes('SHARPAPI_KEY');
  const hasOddsApi = names.includes('THE_ODDS_API_KEY');
  const sharpPromise = hasSharp
    ? secrets.readSecret('SHARPAPI_KEY').then(key => fetchSharpApi(key.trim(), from, to))
    : Promise.resolve({
        events: [] as NormalizedOddsEvent[],
        health: {
          id: 'sharpapi',
          name: 'SharpAPI',
          status: 'unconfigured' as const,
          detail: allowProviderRequests ? 'Optional sportsbook feed is not configured.' : 'Optional keyed feed is disabled for public scans; no provider request made.',
          eventCount: 0,
          bookCount: 0,
        },
      });
  const oddsPromise = hasOddsApi
    ? secrets.readSecret('THE_ODDS_API_KEY').then(key => fetchTheOddsApi(key.trim(), from, to))
    : Promise.resolve({
        events: [] as NormalizedOddsEvent[],
        health: {
          id: 'theoddsapi',
          name: 'The Odds API',
          status: 'unconfigured' as const,
          detail: allowProviderRequests ? 'Optional secondary sportsbook feed is not configured.' : 'Optional keyed feed is disabled for public scans; no provider request made.',
          eventCount: 0,
          bookCount: 0,
        },
      });
  const [sharp, oddsApi, espn, kalshi] = await Promise.all([sharpPromise, oddsPromise, fetchEspnPublicOdds(from, to), fetchKalshiContext(from, to)]);
  return {
    events: [...sharp.events, ...oddsApi.events, ...espn.events],
    providerHealth: [sharp.health, espn.health, oddsApi.health, kalshi.health] as ProviderHealth[],
    predictionContext: kalshi.context,
  };
}
