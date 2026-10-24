import { secrets } from '@appdeploy/sdk';

type Row = Record<string, unknown>;
export type CaesarsQuote = {
  eventId: string | null;
  event: string | null;
  startTime: string | null;
  player: string | null;
  market: string;
  selection: string;
  line: number | null;
  period: string;
  americanOdds: number;
  oddsAt: string | null;
  sourceStatus: string;
  sportsbook: 'Caesars';
  provider: 'ParlayAPI';
};
const string = (value: unknown) => (typeof value === 'string' ? value : null);
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function time(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = number(value);
  const parsed =
    numeric === null
      ? Date.parse(String(value))
      : numeric < 1e12
        ? numeric * 1000
        : numeric;
  return Number.isFinite(parsed) && parsed > 0 && parsed < 8640000000000000
    ? new Date(parsed).toISOString()
    : null;
}
function row(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : null;
}
export function normalizeCaesars(
  props: unknown[],
  events: unknown[],
  now = Date.now(),
) {
  const quotes: CaesarsQuote[] = [];
  let rejectedRows = 0;
  function add(
    base: Omit<CaesarsQuote, 'americanOdds' | 'sportsbook' | 'provider'>,
    value: unknown,
  ) {
    const odds = number(value);
    if (
      odds === null ||
      Math.abs(odds) < 100 ||
      (base.oddsAt && Date.parse(base.oddsAt) > now)
    ) {
      rejectedRows++;
      return;
    }
    quotes.push({
      ...base,
      americanOdds: odds,
      sportsbook: 'Caesars',
      provider: 'ParlayAPI',
    });
  }
  for (const value of props) {
    const item = row(value);
    if (!item || String(item.bookmaker).toLowerCase() !== 'caesars') continue;
    const market = string(item.market_key ?? item.market);
    const player = string(item.player ?? item.player_name);
    const line = number(item.line);
    if (!market || !player || line === null) {
      rejectedRows++;
      continue;
    }
    for (const selection of ['over', 'under']) {
      if (
        item[`${selection}_price`] === null ||
        item[`${selection}_price`] === undefined
      )
        continue;
      add(
        {
          eventId: string(item.canonical_event_id ?? item.event_id),
          event: string(item.event_name ?? item.event),
          startTime: time(item.commence_time),
          player,
          market,
          selection,
          line,
          period: string(item.period) ?? 'unknown',
          oddsAt: time(item.last_update),
          sourceStatus: string(item.market_status ?? item.status) ?? 'unknown',
        },
        item[`${selection}_price`],
      );
    }
  }
  for (const value of events) {
    const event = row(value);
    if (!event || !Array.isArray(event.bookmakers)) continue;
    for (const value of event.bookmakers) {
      const book = row(value);
      if (
        !book ||
        String(book.key).toLowerCase() !== 'caesars' ||
        !Array.isArray(book.markets)
      )
        continue;
      for (const value of book.markets) {
        const market = row(value);
        if (!market || !string(market.key) || !Array.isArray(market.outcomes))
          continue;
        for (const value of market.outcomes) {
          const outcome = row(value);
          if (!outcome || !string(outcome.name)) continue;
          add(
            {
              eventId: string(event.id),
              event:
                [event.away_team, event.home_team]
                  .filter(Boolean)
                  .join(' at ') || null,
              startTime: time(event.commence_time),
              player: null,
              market: String(market.key),
              selection: String(outcome.name),
              line: number(outcome.point),
              period: 'full-game',
              oddsAt: time(market.last_update ?? book.last_update),
              sourceStatus: string(market.status ?? book.status) ?? 'unknown',
            },
            outcome.price,
          );
        }
      }
    }
  }
  return { quotes, rejectedRows };
}
type Feed = {
  retrievedAt: string;
  quotes: CaesarsQuote[];
  rejectedRows: number;
  sourceHealth: Array<{
    family: string;
    status: string;
    httpStatus?: number;
    rows: number;
  }>;
  creditsRemaining: number | null;
  partialBoard: boolean;
};
const cache = new Map<string, Feed>();
const pending = new Map<string, Promise<Feed>>();
const SUPPORTED_SPORTS = new Set(['americanfootball_nfl','americanfootball_ncaaf','baseball_mlb','basketball_nba','basketball_wnba','icehockey_nhl']);
const CACHE_MS = 60000;
export function describeCaesars(feed: Feed, now = Date.now(), sport = 'americanfootball_nfl') {
  const quotes = feed.quotes.map((q) => ({
    ...q,
    fresh:
      q.oddsAt !== null &&
      now - Date.parse(q.oddsAt) >= 0 &&
      now - Date.parse(q.oddsAt) <= 120000,
    screenOnly: true,
    accountAvailability: 'UNVERIFIED',
    settlementRules: 'UNVERIFIED',
    independentProbability: null,
    estimatedEv: null,
  }));
  const freshCount = quotes.filter((q) => q.fresh).length;
  return {
    ...feed,
    quotes,
    freshCount,
    status: freshCount
      ? 'FRESH_QUOTES'
      : quotes.length
        ? 'STALE_OR_UNTIMESTAMPED_QUOTES'
        : 'NO_CAESARS_QUOTES',
    sportsbook: 'Caesars',
    provider: 'ParlayAPI',
    sport,
    generatedAt: new Date(now).toISOString(),
    sgpPricingAvailable: false,
    note: 'Third-party Caesars price observations only. No account-specific availability, accepted SGP payout, promo eligibility or model edge is inferred. Requests use existing provider credits; no automatic refresh.',
  };
}
async function requestFeed(sport: string): Promise<Feed> {
  const names = await secrets.listSecretNames();
  const empty = {
    retrievedAt: new Date().toISOString(),
    quotes: [],
    rejectedRows: 0,
    creditsRemaining: null,
    partialBoard: false,
  };
  if (!names.includes('PARLAY_API_KEY'))
    return {
      ...empty,
      sourceHealth: [{ family: 'all', status: 'UNCONFIGURED', rows: 0 }],
    };
  const key = (await secrets.readSecret('PARLAY_API_KEY')).trim();
  async function get(family: string, path: string) {
    try {
      const response = await fetch(
        `https://parlay-api.com/v1/sports/${sport}/${path}`,
        {
          headers: { 'X-API-Key': key },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        return {
          rows: [] as unknown[],
          health: {
            family,
            status:
              (
                {
                  401: 'UNAUTHORIZED',
                  402: 'CREDITS_EXHAUSTED',
                  403: 'NOT_ENTITLED',
                  429: 'RATE_LIMITED',
                } as Record<number, string>
              )[response.status] ?? 'UNAVAILABLE',
            httpStatus: response.status,
            rows: 0,
          },
          credits: null,
          partial: false,
        };
      const payload: unknown = await response.json();
      const data = Array.isArray(payload) ? payload : row(payload)?.data;
      if (!Array.isArray(data))
        return {
          rows: [] as unknown[],
          health: { family, status: 'INVALID_RESPONSE', rows: 0 },
          credits: null,
          partial: false,
        };
      return {
        rows: data,
        health: {
          family,
          status: data.length ? 'RETRIEVED' : 'EMPTY',
          rows: data.length,
        },
        credits: number(
          response.headers.get('x-credits-remaining') ??
            response.headers.get('x-requests-remaining'),
        ),
        partial:
          response.headers.get('x-result-has-more') === 'true' ||
          data.length >= 1000,
      };
    } catch {
      return {
        rows: [] as unknown[],
        health: { family, status: 'UNAVAILABLE', rows: 0 },
        credits: null,
        partial: false,
      };
    }
  }
  const [props, games] = await Promise.all([
    get('player props', 'props?bookmakers=caesars&limit=1000&offset=0'),
    get(
      'game lines',
      'odds?bookmakers=caesars&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso',
    ),
  ]);
  const normalized = normalizeCaesars(props.rows, games.rows);
  const credits = [props.credits, games.credits].filter(
    (x): x is number => x !== null,
  );
  return {
    retrievedAt: new Date().toISOString(),
    ...normalized,
    sourceHealth: [props.health, games.health],
    creditsRemaining: credits.length ? Math.min(...credits) : null,
    partialBoard: props.partial || games.partial,
  };
}
export async function loadCaesarsFeed(sport = 'americanfootball_nfl') {
  if (!SUPPORTED_SPORTS.has(sport)) throw Error('Unsupported sport');
  const cached = cache.get(sport);
  if (cached && Date.now() - Date.parse(cached.retrievedAt) < CACHE_MS)
    return { ...describeCaesars(cached, Date.now(), sport), cacheHit: true };
  if (!pending.has(sport)) pending.set(sport, requestFeed(sport));
  try {
    const fresh = await pending.get(sport)!;
    cache.set(sport, fresh);
    return { ...describeCaesars(fresh, Date.now(), sport), cacheHit: false };
  } finally {
    pending.delete(sport);
  }
}
