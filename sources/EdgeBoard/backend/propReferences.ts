import { secrets } from '@appdeploy/sdk';
type Row = Record<string, unknown>;
const books = [
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'pinnacle',
  'bovada',
  'novig',
  'betrivers',
  'fanatics',
];
const str = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';
function decimal(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) >= 100
    ? n > 0
      ? 1 + n / 100
      : 1 + 100 / Math.abs(n)
    : null;
}
function timestamp(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const numeric =
    typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : null;
  const t =
    numeric === null
      ? Date.parse(String(v))
      : numeric < 1e12
        ? numeric * 1000
        : numeric;
  return Number.isFinite(t) && t > 0 && t < 8640000000000000
    ? new Date(t).toISOString()
    : null;
}
export function diagnoseReferencePage(rows: Row[], now = Date.now()) {
  const result = {
    rows: rows.length,
    missingCanonicalEventId: 0,
    missingCanonicalPlayerId: 0,
    missingPeriod: 0,
    missingSettlementRules: 0,
    unknownOrOldTimestamp: 0,
    futureTimestamp: 0,
    inactiveOrUnknownStatus: 0,
    incompleteTwoWayPrice: 0,
    technicallyComparableRows: 0,
  };
  for (const row of rows) {
    const eventOk = Boolean(str(row.canonical_event_id));
    const playerOk = Boolean(str(row.canonical_player_id));
    const periodOk = Boolean(str(row.period));
    const rulesOk = typeof row.settlement_rules === 'string' && row.settlement_rules.trim().length > 0;
    const at = timestamp(row.last_update);
    const ts = at === null ? null : Date.parse(at);
    const future = ts !== null && ts > now;
    const fresh = ts !== null && ts <= now && now - ts <= 120000;
    const active = ['open', 'active'].includes(str(row.market_status ?? row.status).toLowerCase());
    const pricesOk = decimal(row.over_price) !== null && decimal(row.under_price) !== null;
    if (!eventOk) result.missingCanonicalEventId++;
    if (!playerOk) result.missingCanonicalPlayerId++;
    if (!periodOk) result.missingPeriod++;
    if (!rulesOk) result.missingSettlementRules++;
    if (!fresh && !future) result.unknownOrOldTimestamp++;
    if (future) result.futureTimestamp++;
    if (!active) result.inactiveOrUnknownStatus++;
    if (!pricesOk) result.incompleteTwoWayPrice++;
    if (eventOk && playerOk && periodOk && rulesOk && fresh && active && pricesOk) {
      result.technicallyComparableRows++;
    }
  }
  return result;
}

export function compareReferences(rows: Row[], now = Date.now()) {
  const groups = new Map<
    string,
    {
      event: string;
      player: string;
      market: string;
      line: number;
      period: string;
      selection: string;
      quotes: Array<{
        book: string;
        decimalOdds: number;
        oddsAt: string | null;
        fresh: boolean;
        settlementRules: string | null;
        identityVerified: boolean;
        marketStatus: string;
        ambiguous: boolean;
      }>;
    }
  >();
  const withdrawn = new Map<string, number>();
  let rejected = 0;
  for (const r of rows) {
    const book = str(r.bookmaker).toLowerCase();
    const event = str(r.canonical_event_id ?? r.event_id);
    const player = str(r.player ?? r.player_name);
    const participantId = str(r.canonical_player_id ?? r.player_id);
    const market = str(r.market_key ?? r.market);
    const period = str(r.period);
    const line =
      r.line === null || r.line === undefined || r.line === ''
        ? NaN
        : Number(r.line);
    if (
      !books.includes(book) ||
      !event ||
      !player ||
      !market ||
      !period ||
      !Number.isFinite(line)
    ) {
      rejected++;
      continue;
    }
    const rules =
      typeof r.settlement_rules === 'string' && r.settlement_rules.trim()
        ? r.settlement_rules
        : null;
    const at = timestamp(r.last_update);
    // A future update cannot supersede a valid observation.
    if (at !== null && Date.parse(at) > now) {
      rejected++;
      continue;
    }
    const marketStatus = str(r.market_status ?? r.status).toLowerCase();
    const fresh =
      at !== null &&
      now - Date.parse(at) >= 0 &&
      now - Date.parse(at) <= 120000;
    for (const side of ['over', 'under']) {
      const price = decimal(r[`${side}_price`]);
      const key = JSON.stringify([
        event,
        participantId || player,
        market,
        line,
        period,
        side,
        rules,
      ]);
      const bookKey = JSON.stringify([key, book]);
      const updateTime = at === null ? -Infinity : Date.parse(at);
      if (
        ['suspended', 'closed', 'inactive'].includes(marketStatus) &&
        at !== null
      ) {
        withdrawn.set(
          bookKey,
          Math.max(withdrawn.get(bookKey) ?? -Infinity, updateTime),
        );
        const previous = groups.get(key);
        if (previous)
          previous.quotes = previous.quotes.filter(
            (q) =>
              q.book !== book ||
              (q.oddsAt !== null && Date.parse(q.oddsAt) > updateTime),
          );
        continue;
      }
      if (
        price === null ||
        (updateTime <= (withdrawn.get(bookKey) ?? -Infinity) &&
          withdrawn.has(bookKey))
      )
        continue;
      const group = groups.get(key) ?? {
        event,
        player,
        market,
        line,
        period,
        selection: side,
        quotes: [],
      };
      const candidate = {
        book,
        decimalOdds: price,
        oddsAt: at,
        fresh,
        settlementRules: rules,
        identityVerified: Boolean(participantId && r.canonical_event_id),
        marketStatus,
        ambiguous: false,
      };
      const priorIndex = group.quotes.findIndex((q) => q.book === book);
      if (priorIndex < 0) {
        group.quotes.push(candidate);
      } else {
        const prior = group.quotes[priorIndex];
        const priorTime =
          prior.oddsAt === null ? -Infinity : Date.parse(prior.oddsAt);
        const candidateTime = at === null ? -Infinity : Date.parse(at);
        if (candidateTime > priorTime) {
          group.quotes[priorIndex] = candidate;
        } else if (
          candidateTime === priorTime &&
          (prior.decimalOdds !== price || prior.marketStatus !== marketStatus)
        ) {
          // Conflicting simultaneous or untimestamped updates have no safe order.
          group.quotes[priorIndex] = {
            ...prior,
            decimalOdds: Math.min(prior.decimalOdds, price),
            ambiguous: true,
          };
        }
      }
      groups.set(key, group);
    }
  }
  return {
    rejectedRows: rejected,
    comparisons: [...groups.values()]
      .filter((g) => g.quotes.length > 0)
      .map((g) => {
        const quotes = g.quotes.sort((a, b) => b.decimalOdds - a.decimalOdds);
        const verified = quotes.filter(
          (q) =>
            q.fresh &&
            q.identityVerified &&
            q.settlementRules &&
            !q.ambiguous &&
            ['open', 'active'].includes(q.marketStatus),
        );
        return {
          ...g,
          quotes,
          referenceBookCount: new Set(quotes.map((q) => q.book)).size,
          bestVerifiedPrice: verified.length ? verified[0] : null,
          bestObservedPrice: quotes[0] ?? null,
          independentProbability: null,
          estimatedEv: null,
          status: 'SCREEN_ONLY',
          reasons: [
            'No approved independent model.',
            ...(!verified.length
              ? [
                  'Canonical event/participant identity, freshness, open status or settlement rules insufficient for verified best-price comparison; ambiguous updates are excluded.',
                ]
              : []),
            'Account/location availability unknown; source quotes are not executable fills.',
          ],
        };
      }),
  };
}
type CachedPage = { at: number; rows: Row[]; data: Record<string, unknown> };
const cachedPages = new Map<string, CachedPage>();
const inFlight = new Map<string, Promise<unknown>>();
let cooldownUntil = 0;
export async function loadPropReferences(input: {
  sport?: string;
  offset?: number;
}) {
  const sport = input.sport ?? 'americanfootball_nfl';
  if (!/^[a-z0-9_]{3,60}$/.test(sport)) throw Error('Invalid sport key.');
  const offset = Number.isFinite(input.offset)
    ? Math.min(10000, Math.max(0, Math.floor(input.offset!)))
    : 0;
  const key = `${sport}|${offset}`;
  const cached = cachedPages.get(key);
  if (cached && Date.now() - cached.at < 60000) {
    // Retrieval time is retained; freshness is re-evaluated on every cache hit.
    return {
      ...cached.data,
      ...compareReferences(cached.rows),
      diagnostics: diagnoseReferencePage(cached.rows),
      cacheHit: true,
    };
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetchPropReferences(sport, offset, key);
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}
async function fetchPropReferences(sport: string, offset: number, key: string) {
  const configured = (await secrets.listSecretNames()).includes(
    'PARLAY_API_KEY',
  );
  if (!configured)
    return {
      status: 'UNCONFIGURED',
      provider: 'Parlay API',
      comparisons: [],
      note: 'PARLAY_API_KEY is required. SharpAPI is currently a game-odds adapter, not a verified props adapter.',
    };
  if (Date.now() < cooldownUntil)
    return {
      status: 'RATE_LIMITED',
      comparisons: [],
      retryAfter: new Date(cooldownUntil).toISOString(),
    };
  const secret = (await secrets.readSecret('PARLAY_API_KEY')).trim();
  const query = new URLSearchParams({
    bookmakers: books.join(','),
    limit: '1000',
    offset: String(offset),
    maxAgeSec: '120',
  });
  let response: Response;
  try {
    response = await fetch(
      `https://parlay-api.com/v1/sports/${sport}/props?${query}`,
      { headers: { 'X-API-Key': secret }, signal: AbortSignal.timeout(15000) },
    );
  } catch {
    return {
      status: 'UNAVAILABLE',
      comparisons: [],
      note: 'Provider connection failed or timed out. Retry without substituting data.',
    };
  }
  if (!response.ok) {
    if (response.status === 429) cooldownUntil = Date.now() + 60000;
    return {
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
      provider: 'Parlay API',
      comparisons: [],
      note: 'Configured credential does not establish functioning coverage. No upstream response body or key is exposed.',
    };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'INVALID_RESPONSE', comparisons: [] };
  }
  const parsed = payload as { data?: unknown };
  const rows = (
    Array.isArray(payload)
      ? payload
      : Array.isArray(parsed?.data)
        ? parsed.data
        : null
  ) as Row[] | null;
  if (
    !rows ||
    rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))
  )
    return { status: 'INVALID_RESPONSE', comparisons: [] };
  const result = compareReferences(rows);
  const nextHeader = response.headers.get('x-next-offset');
  const next =
    nextHeader !== null && /^\d+$/.test(nextHeader) ? Number(nextHeader) : null;
  const hasMore = response.headers.get('x-result-has-more') === 'true';
  const data = {
    status: rows.length ? 'LIVE_RESPONSE' : 'NO_MATCHING_QUOTES',
    provider: 'Parlay API',
    retrievedAt: new Date().toISOString(),
    sport,
    rowsLoaded: rows.length,
    referenceBookCount: new Set(
      result.comparisons.flatMap((g) => g.quotes.map((q) => q.book)),
    ).size,
    ...result,
    diagnostics: diagnoseReferencePage(rows),
    offset,
    nextOffset:
      hasMore && next !== null && next > offset && next <= 10000 ? next : null,
    partialBoard: hasMore,
    note: 'Bounded authenticated reference request; may consume provider credits. Quotes with unknown settlement rules, participant identity or timestamps remain provisional. Underdog public IDs are not assumed equivalent to provider IDs.',
  };
  cachedPages.delete(key);
  if (cachedPages.size >= 12) {
    const oldest = cachedPages.keys().next().value;
    if (oldest !== undefined) cachedPages.delete(oldest);
  }
  cachedPages.set(key, { at: Date.now(), rows, data });
  return data;
}
