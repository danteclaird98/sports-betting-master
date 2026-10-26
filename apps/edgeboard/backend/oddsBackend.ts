/** Read-only boundary to the existing Python odds service; never fetches vendors. */
export type Resource = 'status' | 'events' | 'event' | 'markets' | 'latest' | 'history' | 'bookmakers';
export type Settings = { baseUrl: string; token: string };
type Mode = 'mock' | 'no_sources' | 'configured_sources';
type Query = Record<string, string>;
type Row = Record<string, unknown>;
const MODES = new Set<Mode>(['mock', 'no_sources', 'configured_sources']);
const WARNINGS = [
  'Stored observations only; source quote timestamps and settlement equivalence are not supplied by this API.',
  'No independent probability, EV qualification, account-price verification or financial execution.',
];

class BoundaryError extends Error {
  constructor(readonly code: string, readonly status: number = 502) { super(code); }
}
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  return value as Row;
}
function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  return value as number;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  return value;
}
function utc(value: unknown): string {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  }
  return new Date(value).toISOString();
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 500) throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  return value;
}
function event(value: unknown) {
  const r = object(value);
  return { id: id(r.id), sport: text(r.sport), league: text(r.league), home_team: text(r.home_team),
    away_team: text(r.away_team), start_time_utc: utc(r.start_time_utc) };
}
function market(value: unknown) {
  const r = object(value), marketId = id(r.id), kind = text(r.type);
  if (!['moneyline', 'spread', 'total', 'prop'].includes(kind) ||
      (r.line !== null && (typeof r.line !== 'number' || !Number.isFinite(r.line))) ||
      (kind === 'moneyline' && r.line !== null) ||
      (['spread', 'total'].includes(kind) && r.line === null)) throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  return { id: marketId, event_id: id(r.event_id), type: kind, line: r.line as number | null,
    selections: rows(r.selections).map((v) => {
      const s = object(v);
      if (id(s.market_id) !== marketId) throw new BoundaryError('INVALID_BACKEND_RESPONSE');
      return { id: id(s.id), market_id: marketId, name: text(s.name) };
    }) };
}
function odds(value: unknown) {
  const r = object(value), price = r.price_american;
  if (!Number.isSafeInteger(price) || Math.abs(Number(price)) < 100 || Math.abs(Number(price)) > 1e12) {
    throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  }
  return { selection_id: id(r.selection_id), bookmaker_id: id(r.bookmaker_id),
    price_american: price as number, fetched_at: utc(r.fetched_at) };
}
function bookmaker(value: unknown) {
  const r = object(value);
  return { id: id(r.id), name: text(r.name), region: text(r.region) };
}
export function serviceUrl(settings: Settings): string {
  const u = new URL(settings.baseUrl);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port ||
      !/^[a-z0-9.-]+\.[a-z]+$/i.test(u.hostname) ||
      /(^|\.)(localhost|local|internal|invalid|test)$/i.test(u.hostname) ||
      !/^[\x21-\x7e]{32,512}$/.test(settings.token)) throw new BoundaryError('INVALID_CONFIGURATION', 503);
  return u.toString().replace(/\/$/, '');
}
function pathFor(resource: Resource, query: Query, eventId?: string) {
  const fields: Record<Resource, string[]> = {
    status: [], events: ['sport', 'league', 'from', 'to', 'limit', 'offset'],
    event: [], markets: ['limit', 'offset'], latest: ['event_id', 'market', 'limit', 'offset'],
    history: ['event_id', 'market', 'bookmaker', 'from', 'to', 'limit', 'offset'], bookmakers: ['limit', 'offset'],
  };
  const integer = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
  for (const [key, value] of Object.entries(query)) {
    if (!fields[resource].includes(key) || typeof value !== 'string' || value.length > 512) throw new BoundaryError('INVALID_FILTERS', 400);
    if (key === 'limit' && !integer(value, 1, 500) || key === 'offset' && !integer(value, 0, 1000000) ||
        ['event_id', 'bookmaker'].includes(key) && !integer(value, 1, Number.MAX_SAFE_INTEGER) ||
        key === 'market' && !['moneyline', 'spread', 'total', 'prop'].includes(value) ||
        ['sport', 'league'].includes(key) && (!value.trim() || value.length > 128)) throw new BoundaryError('INVALID_FILTERS', 400);
    if (key === 'from' || key === 'to') {
      try { utc(value); } catch { throw new BoundaryError('INVALID_FILTERS', 400); }
    }
  }
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) throw new BoundaryError('INVALID_FILTERS', 400);
  if (['latest', 'history'].includes(resource) && !query.event_id) throw new BoundaryError('INVALID_FILTERS', 400);
  if (['event', 'markets'].includes(resource) && (!eventId || !integer(eventId, 1, Number.MAX_SAFE_INTEGER))) throw new BoundaryError('INVALID_EVENT_ID', 400);
  const paths = { status: '/ready', events: '/events', event: '/events/' + eventId,
    markets: '/events/' + eventId + '/markets', latest: '/odds/latest', history: '/odds/history', bookmakers: '/bookmakers' };
  const params = new URLSearchParams(query).toString();
  return paths[resource] + (params ? '?' + params : '');
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new BoundaryError('INVALID_BACKEND_RESPONSE');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new BoundaryError('BACKEND_RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
}

export function makeOddsGateway(loadSettings: () => Promise<Settings | null>, request: typeof fetch = fetch) {
  return async (resource: Resource, query: Query = {}, eventId?: string) => {
    const common = { schema: 'edgeboard.odds-backend.v1', researchOnly: true, executionEnabled: false,
      warnings: WARNINGS, checkedAt: new Date().toISOString() };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const path = pathFor(resource, query, eventId);
      const settings = await loadSettings();
      if (!settings) return { statusCode: resource === 'status' ? 200 : 503,
        body: { ...common, state: 'NOT_CONFIGURED', dataMode: null, error: 'ODDS_BACKEND_NOT_CONFIGURED' } };
      const base = serviceUrl(settings), controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 8000);
      const get = async (suffix: string) => {
        const response = await request(base + suffix, { method: 'GET', redirect: 'error',
          headers: { Accept: 'application/json', 'X-MarketEdge-Read-Token': settings.token }, signal: controller.signal });
        if (!response.ok) throw new BoundaryError(response.status === 404 ? 'NOT_FOUND' : 'BACKEND_UNAVAILABLE', response.status === 404 ? 404 : 503);
        return { value: await boundedJson(response), mode: response.headers.get('X-MarketEdge-Data-Mode') };
      };
      const ready = await get('/ready'), health = object(ready.value);
      const mode = health.data_mode as Mode;
      if (health.status !== 'ok' || health.service !== 'marketedge-odds' || health.contract_version !== '1' ||
          health.execution_enabled !== false || !MODES.has(mode) || ready.mode !== mode) throw new BoundaryError('BACKEND_IDENTITY_UNVERIFIED', 503);
      if (resource === 'status') return { statusCode: 200, body: { ...common, state: 'READY', dataMode: mode } };
      const result = await get(path);
      if (result.mode !== mode) throw new BoundaryError('BACKEND_MODE_CHANGED', 503);
      let data: unknown;
      if (resource === 'events') data = rows(result.value).map(event);
      else if (resource === 'event') data = event(result.value);
      else if (resource === 'markets') data = rows(result.value).map(market);
      else if (resource === 'bookmakers') data = rows(result.value).map(bookmaker);
      else data = rows(result.value).map(odds);
      // Reject mismatched event/selection scope before displaying observations.
      if (resource === 'event' && object(data).id !== Number(eventId) ||
          resource === 'markets' && (data as ReturnType<typeof market>[]).some((m) => m.event_id !== Number(eventId))) {
        throw new BoundaryError('BACKEND_IDENTITY_UNVERIFIED', 503);
      }
      return { statusCode: 200, body: { ...common, state: 'READY', dataMode: mode, data } };
    } catch (e) {
      return { statusCode: e instanceof BoundaryError ? e.status : 503,
        body: { ...common, state: 'UNAVAILABLE', dataMode: null,
          error: e instanceof BoundaryError ? e.code : 'BACKEND_UNAVAILABLE' } };
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
}
