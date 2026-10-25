/** Provider-native observations only. No model probability or execution authority. */
export const SGO_LEAGUES = ['NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'NCAAF', 'NCAAB'] as const;
export type SgoLeague = typeof SGO_LEAGUES[number];
export type SgoMode = 'upcoming' | 'live';
export type SgoInput = {
    requestId: string;
    league: SgoLeague;
    mode: SgoMode;
    cursor: string | null;
    confirmRequest: true;
};
export type SgoQuote = {
    key: string;
    eventId: string;
    event: string;
    startsAt: string;
    league: SgoLeague;
    oddId: string;
    bookmaker: string;
    stat: string;
    entityId: string;
    playerId: string | null;
    playerName: string | null;
    period: string;
    betType: string;
    side: string;
    line: number | null;
    americanOdds: number;
    decimalOdds: number;
    oddsAt: string | null;
    retrievedAt: string;
    available: true;
};
export type SgoMovement = {
    key: string;
    event: string;
    oddId: string;
    bookmaker: string;
    previous: SgoQuote;
    current: SgoQuote;
    lineChanged: boolean;
    priceChanged: boolean;
};
export type SgoSnapshot = {
    requestId: string;
    league: SgoLeague;
    mode: SgoMode;
    retrievedAt: string;
    quotes: SgoQuote[];
    movements: SgoMovement[];
    nextCursor: string | null;
    returnedEvents: number;
    skippedQuotes: number;
    truncated: boolean;
    providerFiltered: boolean;
    baselineAt: string | null;
    baselineTruncated: boolean;
    movementCount: number;
    movementTruncated: boolean;
    source: 'SportsGameOdds';
};
export const SGO_FLAGS = { bettingDecision: 'HOLD', liveApproved: false, verifiedPositiveEv: false, executionEnabled: false } as const;
export const SGO_INTERVAL = 60000;
export const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown, max = 200) => typeof v === 'string' && v.length <= max ? v : '';
const number = (v: unknown): number | null => {
    if (typeof v !== 'number' && typeof v !== 'string')
        return null;
    if (typeof v === 'string' && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v.trim()))
        return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const stamp = (v: unknown): string | null => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v))
        return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
export function parseSgoInput(value: unknown): SgoInput {
    const b = object(value);
    if (Object.keys(b).sort().join('|') !== 'confirmRequest|cursor|league|mode|requestId'
        || typeof b.requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.requestId)
        || !SGO_LEAGUES.includes(b.league as SgoLeague) || !['upcoming', 'live'].includes(String(b.mode))
        || b.confirmRequest !== true || (b.cursor !== null && (typeof b.cursor !== 'string' || b.cursor.length > 1500 || !b.cursor))) {
        throw Error('Confirm one provider request and supply a valid league, mode and request ID.');
    }
    return b as SgoInput;
}
export function freshness(q: SgoQuote, now = Date.now()): 'FRESH' | 'STALE' | 'MISSING_TIMESTAMP' | 'FUTURE_TIMESTAMP' {
    if (!q.oddsAt)
        return 'MISSING_TIMESTAMP';
    const age = now - Date.parse(q.oddsAt);
    return age < 0 ? 'FUTURE_TIMESTAMP' : age > 90000 ? 'STALE' : 'FRESH';
}
export function normalizeSgo(payload: unknown, input: SgoInput, observed: number): SgoSnapshot {
    const body = object(payload);
    if (body.success !== true || !Array.isArray(body.data) || body.data.length > 3)
        throw Error('PROVIDER_SCHEMA_INVALID');
    const retrievedAt = new Date(observed).toISOString(), quotes: SgoQuote[] = [], seen = new Set<string>();
    let skippedQuotes = 0, truncated = false;
    const events = new Set<string>();
    for (const rawEvent of body.data) {
        const e = object(rawEvent), s = object(e.status), eventId = string(e.eventID);
        if (!eventId || events.has(eventId) || e.leagueID !== input.league)
            throw Error('PROVIDER_EVENT_IDENTITY_INVALID');
        events.add(eventId);
        if (s.cancelled === true || s.ended === true || s.finalized === true
            || (input.mode === 'live' ? s.live !== true : s.started !== false))
            continue;
        const startsAt = stamp(s.startsAt);
        if (!startsAt)
            throw Error('PROVIDER_EVENT_CLOCK_INVALID');
        const teams = object(e.teams);
        const teamName = (v: unknown) => { const t = object(v), names = object(t.names); return string(names.long) || string(names.medium) || string(names.short) || string(t.teamID); };
        const home = teamName(teams.home), away = teamName(teams.away);
        if (!home || !away)
            throw Error('PROVIDER_TEAM_IDENTITY_INVALID');
        for (const [oddId, value] of Object.entries(object(e.odds))) {
            const o = object(value), stat = string(o.statID), entityId = string(o.statEntityID), period = string(o.periodID), betType = string(o.betTypeID), side = string(o.sideID);
            const identity = [stat, entityId, period, betType, side].join('-');
            if (!stat || !entityId || !period || !side || !['ml', 'sp', 'ou'].includes(betType) || oddId !== identity || o.oddID !== oddId
                || o.ended === true || o.cancelled === true) {
                skippedQuotes++;
                continue;
            }
            const playerId = ['home', 'away', 'all'].includes(entityId) ? null : entityId;
            const player = object(object(e.players)[entityId]);
            for (const [bookmaker, rawBook] of Object.entries(object(o.byBookmaker))) {
                const book = object(rawBook), americanOdds = number(book.odds);
                // Only bookmaker-level offered prices. Consensus/fair odds never substitute.
                const line = betType === 'ml' ? null : number(betType === 'sp' ? book.spread : book.overUnder);
                if (!bookmaker || bookmaker.length > 100 || book.available !== true || americanOdds === null
                    || !Number.isInteger(americanOdds) || Math.abs(americanOdds) < 100 || Math.abs(americanOdds) > 100000
                    || (betType !== 'ml' && line === null)) {
                    skippedQuotes++;
                    continue;
                }
                const key = JSON.stringify([eventId, oddId, bookmaker]);
                if (seen.has(key))
                    throw Error('PROVIDER_DUPLICATE_QUOTE');
                seen.add(key);
                if (quotes.length >= 150) {
                    truncated = true;
                    continue;
                }
                quotes.push({ key, eventId, event: `${away} @ ${home}`, startsAt, league: input.league, oddId, bookmaker, stat, entityId, playerId,
                    playerName: playerId ? string(player.name) || null : null, period, betType, side, line, americanOdds,
                    decimalOdds: americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds),
                    oddsAt: stamp(book.lastUpdatedAt), retrievedAt, available: true });
            }
        }
    }
    const cursor = body.nextCursor;
    if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor.length > 1500))
        throw Error('PROVIDER_CURSOR_INVALID');
    return { requestId: input.requestId, league: input.league, mode: input.mode, retrievedAt, quotes, movements: [],
        nextCursor: typeof cursor === 'string' && cursor ? cursor : null, returnedEvents: body.data.length, skippedQuotes,
        truncated, providerFiltered: Boolean(body.notice), baselineAt: null, baselineTruncated: false, movementCount: 0, movementTruncated: false, source: 'SportsGameOdds' };
}
export function compareSgo(previous: SgoSnapshot | null, current: SgoSnapshot): SgoSnapshot {
    if (!previous || previous.league !== current.league || previous.mode !== current.mode)
        return current;
    const index = new Map(previous.quotes.map(q => [q.key, q])), now = Date.parse(current.retrievedAt);
    const movements: SgoMovement[] = [];
    for (const q of current.quotes) {
        const old = index.get(q.key);
        if (!old || !q.oddsAt || !old.oddsAt || freshness(q, now) !== 'FRESH'
            || freshness(old, Date.parse(previous.retrievedAt)) !== 'FRESH'
            || Date.parse(q.oddsAt) <= Date.parse(old.oddsAt) || now <= Date.parse(previous.retrievedAt))
            continue;
        const lineChanged = old.line !== q.line, priceChanged = old.americanOdds !== q.americanOdds;
        if (lineChanged || priceChanged)
            movements.push({ key: q.key, event: q.event, oddId: q.oddId, bookmaker: q.bookmaker,
                previous: old, current: q, lineChanged, priceChanged });
    }
    return { ...current, movements: movements.slice(0, 50), movementCount: movements.length, movementTruncated: movements.length > 50, baselineAt: previous.retrievedAt, baselineTruncated: previous.truncated };
}
export type SgoReceipt = {
    id: string;
    owner: string;
    fingerprint: string;
    status: 'PENDING' | 'COMPLETE' | 'FAILED';
    createdAt: string;
    reason?: string;
    snapshot?: SgoSnapshot;
};
export type SgoStore = {
    find(input: SgoInput): Promise<SgoReceipt | null>;
    reserve(input: SgoInput, fingerprint: string, now: number): Promise<void>;
    previous(input: SgoInput): Promise<SgoSnapshot | null>;
    finish(input: SgoInput, result: {
        snapshot?: SgoSnapshot;
        reason?: string;
    }): Promise<void>;
    history(league: SgoLeague, mode: SgoMode, token?: string): Promise<{
        items: SgoReceipt[];
        nextToken: string | null;
    }>;
};
export function createSgoService(deps: {
    store: SgoStore;
    key: () => Promise<string | null>;
    fetch: typeof fetch;
    now?: () => number;
}) {
    const now = deps.now ?? Date.now;
    async function refresh(body: unknown) {
        const input = parseSgoInput(body), fingerprint = JSON.stringify([input.league, input.mode, input.cursor]);
        const replay = await deps.store.find(input);
        if (replay) {
            if (replay.fingerprint !== fingerprint)
                throw Error('REQUEST_ID_REUSED_FOR_DIFFERENT_QUERY');
            return { ...SGO_FLAGS, status: replay.status === 'COMPLETE' ? 'REPLAYED' : 'RECONCILE_REQUIRED',
                reason: replay.reason ?? (replay.status === 'COMPLETE' ? 'Saved response; no provider request repeated.' : 'Prior request outcome requires history reconciliation. Use a new request only after reviewing history.'),
                requestsUsed: 0, snapshot: replay.snapshot ?? null };
        }
        const key = await deps.key();
        if (!key)
            return { ...SGO_FLAGS, status: 'UNCONFIGURED', reason: 'Store SPORTSGAMEODDS_KEY using the secure setup form.', requestsUsed: 0, snapshot: null };
        await deps.store.reserve(input, fingerprint, now());
        let requestsUsed = 0;
        try {
            const previous = await deps.store.previous(input);
            const query = new URLSearchParams({ leagueID: input.league, oddsAvailable: 'true', finalized: 'false', limit: '3', includeAltLines: 'false' });
            if (input.mode === 'live')
                query.set('live', 'true');
            else
                query.set('started', 'false');
            if (input.cursor)
                query.set('cursor', input.cursor);
            requestsUsed = 1;
            const response = await deps.fetch('https://api.sportsgameodds.com/v2/events?' + query, { redirect: 'error', headers: { 'x-api-key': key }, signal: AbortSignal.timeout(20000) });
            if (!response.ok)
                throw Error(({ 401: 'PROVIDER_UNAUTHORIZED', 403: 'PROVIDER_ACCESS_DENIED', 429: 'PROVIDER_RATE_LIMITED' } as Record<number, string>)[response.status] ?? 'PROVIDER_HTTP_FAILURE');
            const declared = Number(response.headers.get('content-length'));
            if (Number.isFinite(declared) && declared > 4000000)
                throw Error('PROVIDER_RESPONSE_TOO_LARGE');
            if (!response.body)
                throw Error('PROVIDER_EMPTY_BODY');
            const reader = response.body.getReader(), chunks: Uint8Array[] = [];
            let size = 0;
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    size += part.value.byteLength;
                    if (size > 4000000)
                        throw Error('PROVIDER_RESPONSE_TOO_LARGE');
                    chunks.push(part.value);
                }
            }
            finally {
                await reader.cancel().catch(() => { });
            }
            const buffer = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) {
                buffer.set(part, offset);
                offset += part.byteLength;
            }
            const snapshot = compareSgo(previous, normalizeSgo(JSON.parse(new TextDecoder().decode(buffer)), input, now()));
            // Receipt includes previous/current comparison rows; enforce the actual serialized DB limit.
            if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 190000)
                throw Error('SNAPSHOT_STORAGE_LIMIT');
            await deps.store.finish(input, { snapshot });
            return { ...SGO_FLAGS, status: snapshot.quotes.length ? 'RETRIEVED' : 'NO_QUOTES', reason: 'Observed bookmaker quotes; account availability, settlement and EV unverified.', requestsUsed, snapshot };
        }
        catch (error) {
            // Never echo provider payloads, URLs with credentials or arbitrary exception strings.
            const allowed = ['PROVIDER_UNAUTHORIZED', 'PROVIDER_ACCESS_DENIED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_HTTP_FAILURE', 'PROVIDER_RESPONSE_TOO_LARGE',
                'PROVIDER_EMPTY_BODY', 'PROVIDER_SCHEMA_INVALID', 'PROVIDER_EVENT_IDENTITY_INVALID', 'PROVIDER_EVENT_CLOCK_INVALID', 'PROVIDER_TEAM_IDENTITY_INVALID', 'PROVIDER_CURSOR_INVALID', 'PROVIDER_DUPLICATE_QUOTE', 'SNAPSHOT_STORAGE_LIMIT'];
            const reason = error instanceof Error && allowed.includes(error.message) ? error.message : 'REQUEST_OR_SAVE_UNCONFIRMED';
            try {
                await deps.store.finish(input, { reason });
            }
            catch { /* no retry; committed state remains uncertain */ }
            return { ...SGO_FLAGS, status: reason === 'REQUEST_OR_SAVE_UNCONFIRMED' ? 'RECONCILE_REQUIRED' : 'ERROR', reason,
                requestsUsed, snapshot: null };
        }
    }
    return { refresh };
}
