import { useEffect, useRef, useState } from 'react';
import { api, auth } from '../../../runtime/client';
import { createSgoOwnerSession } from '../shared/sgoOwner';
import { SGO_LEAGUES, freshness, type SgoLeague, type SgoMode, type SgoSnapshot, type SgoReceipt } from '../backend/sportsGameOddsCore';
type Reply = {
    status: string;
    reason: string;
    requestsUsed: number;
    snapshot: SgoSnapshot | null;
    bettingDecision: 'HOLD';
    liveApproved: false;
    executionEnabled: false;
    verifiedPositiveEv: false;
};
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const validFlags = (v: Record<string, unknown>) => v.bettingDecision === 'HOLD' && v.liveApproved === false && v.executionEnabled === false && v.verifiedPositiveEv === false;
function validQuote(q: unknown): boolean {
    return object(q) && ['key', 'eventId', 'event', 'oddId', 'bookmaker', 'stat', 'entityId', 'period', 'side'].every(k => typeof q[k] === 'string')
        && typeof q.americanOdds === 'number' && Number.isInteger(q.americanOdds) && Math.abs(q.americanOdds) >= 100
        && (q.line === null || typeof q.line === 'number' && Number.isFinite(q.line))
        && (q.oddsAt === null || typeof q.oddsAt === 'string' && Number.isFinite(Date.parse(q.oddsAt)));
}
function validSnapshot(v: unknown): v is SgoSnapshot {
    if (!object(v) || typeof v.retrievedAt !== 'string' || !Number.isFinite(Date.parse(v.retrievedAt))
        || !Array.isArray(v.quotes) || v.quotes.length > 150 || !Array.isArray(v.movements) || v.movements.length > 50
        || typeof v.requestId !== 'string' || !SGO_LEAGUES.includes(v.league as SgoLeague) || !['live', 'upcoming'].includes(String(v.mode))
        || typeof v.movementCount !== 'number' || !Number.isSafeInteger(v.movementCount) || v.movementCount < v.movements.length
        || typeof v.movementTruncated !== 'boolean' || typeof v.truncated !== 'boolean' || typeof v.providerFiltered !== 'boolean'
        || v.nextCursor !== null && typeof v.nextCursor !== 'string')
        return false;
    return v.quotes.every(validQuote) && v.movements.every(m => object(m) && typeof m.key === 'string'
        && validQuote(m.previous) && validQuote(m.current) && object(m.previous) && object(m.current)
        && m.key === m.previous.key && m.key === m.current.key);
}
const time = (v: string | null) => v ? new Date(v).toLocaleString() : 'Source time unavailable';
const price = (v: number) => v > 0 ? '+' + v : String(v);
export default function SportsGameOddsTracker() {
    const [league, setLeague] = useState<SgoLeague>('NFL');
    const [mode, setMode] = useState<SgoMode>('upcoming');
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [signedIn, setSignedIn] = useState(auth.isSignedIn());
    const [confirmed, setConfirmed] = useState(false);
    const [higherPlan, setHigherPlan] = useState(false);
    const [cap, setCap] = useState(3);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('Check configuration to begin. No provider request runs when this panel opens.');
    const [snapshot, setSnapshot] = useState<SgoSnapshot | null>(null);
    const [history, setHistory] = useState<SgoReceipt[]>([]);
    const [historyToken, setHistoryToken] = useState<string | null>(null);
    const [sessionRemaining, setSessionRemaining] = useState(0);
    const [unresolved, setUnresolved] = useState(false);
    const [historyReviewed, setHistoryReviewed] = useState(false);
    const [download, setDownload] = useState<{ snapshot: SgoSnapshot; url: string } | null>(null);
    const [tick, setTick] = useState(0);
    const generation = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inFlight = useRef(false), pendingId = useRef<string | null>(null), pendingCursor = useRef<string | null>(null), remaining = useRef(0);
    const confirmationSequence = useRef(0);
    const confirmedAccount = useRef<{ owner: string; epoch: number } | null>(null);
    const ownerSession = useRef<ReturnType<typeof createSgoOwnerSession> | null>(null);
    if (!ownerSession.current) ownerSession.current = createSgoOwnerSession(async () => (await auth.getUser())?.userId ?? null, owner => {
        generation.current++; confirmationSequence.current++;
        stop(); pendingId.current = null; pendingCursor.current = null; confirmedAccount.current = null;
        setSignedIn(Boolean(owner)); setSnapshot(null); setHistory([]); setHistoryToken(null);
        setConfirmed(false); setHigherPlan(false); setUnresolved(false); setHistoryReviewed(false); setBusy(false);
        setMessage(owner ? 'Signed-in account verified. Reload history and confirm provider usage for this account.' : 'Signed out. Private snapshots, history and provider authorization were cleared.');
    });
    function stop() {
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = null;
        remaining.current = 0;
        setSessionRemaining(0);
    }
    useEffect(() => {
        const syncOwner = () => { void ownerSession.current!.sync().catch(() => {}); };
        const onHide = () => { if (document.visibilityState !== 'visible') stop(); syncOwner(); };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('focus', syncOwner);
        window.addEventListener('storage', syncOwner);
        void ownerSession.current!.sync().catch(() => {});
        const clock = setInterval(() => { setTick(x => x + 1); void ownerSession.current!.sync().catch(() => {}); }, 15000);
        return () => {
            generation.current++;
            ownerSession.current!.invalidate(); confirmationSequence.current++;
            if (timer.current)
                clearTimeout(timer.current);
            remaining.current = 0;
            clearInterval(clock);
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('focus', syncOwner);
            window.removeEventListener('storage', syncOwner);
        };
    }, []);
    useEffect(() => {
        if (!snapshot) {
            setDownload(null);
            return;
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
        setDownload({ snapshot, url });
        return () => URL.revokeObjectURL(url);
    }, [snapshot]);
    function edit() {
        stop();
        generation.current++; confirmationSequence.current++;
        pendingId.current = null;
        setUnresolved(false);
        setSnapshot(null);
        setHistory([]);
        setHistoryToken(null);
        setHistoryReviewed(false);
        confirmedAccount.current = null;
        setConfirmed(false);
        setMessage('Selection changed; authorize a new request when ready.');
    }
    async function confirmUsage(checked: boolean) {
        const confirmation = ++confirmationSequence.current;
        stop(); confirmedAccount.current = null; setConfirmed(false);
        if (!checked) return;
        const current = generation.current;
        try {
            const ticket = await ownerSession.current!.capture();
            if (current !== generation.current || confirmation !== confirmationSequence.current) return;
            confirmedAccount.current = ticket; setConfirmed(true);
        } catch { if (current === generation.current) setMessage('Sign in and verify the account before authorizing provider usage.'); }
    }
    async function check() {
        const current = generation.current;
        setBusy(true);
        try {
            const { data } = await api.get('/api/sgo/status');
            if (current !== generation.current)
                return;
            if (!object(data) || typeof data.configured !== 'boolean' || !validFlags(data) || data.providerRequestsUsed !== 0)
                throw Error('Configuration response could not be verified.');
            setConfigured(data.configured);
            setMessage(String(data.action));
        }
        catch {
            if (current === generation.current) {
                setConfigured(null);
                setMessage('Configuration check unavailable. Try again; no provider request was authorized.');
            }
        }
        finally {
            if (current === generation.current)
                setBusy(false);
        }
    }
    async function signIn() {
        try {
            await auth.signIn();
            await ownerSession.current!.sync();
        }
        catch {
            setMessage('Sign-in was not completed. Allow the sign-in popup and try again.');
        }
    }
    async function loadHistory(token: string | null = null) {
        stop();
        let current = generation.current;
        setBusy(true);
        try {
            const ticket = await ownerSession.current!.capture();
            current = generation.current; setBusy(true);
            const query = new URLSearchParams({ league, mode, owner: ticket.owner });
            if (token)
                query.set('nextToken', token);
            const { data } = await api.get('/api/sgo/history?' + query);
            if (current !== generation.current) return;
            if (!await ownerSession.current!.accepts(ticket, data?.owner)) throw Error('Account changed; private history was discarded.');
            if (current !== generation.current)
                return;
            if (!object(data) || !validFlags(data) || !Array.isArray(data.items) || data.items.length > 3
                || !data.items.every(r => object(r) && typeof r.id === 'string' && ['PENDING', 'FAILED', 'COMPLETE'].includes(String(r.status)) && (!r.snapshot || validSnapshot(r.snapshot)))
                || data.nextToken !== null && typeof data.nextToken !== 'string')
                throw Error('History response invalid.');
            setHistory(data.items as SgoReceipt[]);
            setHistoryToken(data.nextToken as string | null);
            setHistoryReviewed(true);
            setMessage('Saved history loaded. This did not request provider prices. A pending or failed receipt is not proof that no quota was consumed.');
        }
        catch {
            if (current === generation.current)
                setMessage('History could not be loaded. Retry history before repeating an uncertain provider request.');
        }
        finally {
            if (current === generation.current)
                setBusy(false);
        }
    }
    async function refresh(cursor: string | null = null, session = false) {
        if (inFlight.current || document.visibilityState !== 'visible' || !auth.isSignedIn()) {
            stop();
            setSignedIn(auth.isSignedIn());
            return;
        }
        if (!confirmed || !configured) {
            stop();
            return;
        }
        inFlight.current = true;
        setBusy(true);
        let current = generation.current;
        try {
            const ticket = await ownerSession.current!.capture();
            current = generation.current; setBusy(true);
            if (!confirmedAccount.current || confirmedAccount.current.owner !== ticket.owner || confirmedAccount.current.epoch !== ticket.epoch) { stop(); setMessage('Account changed. Confirm provider usage again before requesting prices.'); return; }
            if (!pendingId.current) pendingCursor.current = cursor;
            const requestId = pendingId.current ?? crypto.randomUUID(); pendingId.current = requestId;
            setHistoryReviewed(false); setMessage('Requesting one bounded provider page…');
            const { data } = await api.post('/api/sgo/refresh?owner=' + encodeURIComponent(ticket.owner), { requestId, league, mode, cursor: pendingCursor.current, confirmRequest: true });
            if (current !== generation.current)
                return;
            if (!await ownerSession.current!.accepts(ticket, data?.owner)) throw Error('Account changed; private response was discarded.');
            if (current !== generation.current) return;
            if (!object(data) || !validFlags(data) || typeof data.status !== 'string' || typeof data.reason !== 'string'
                || (data.snapshot !== null && !validSnapshot(data.snapshot)))
                throw Error('Unverified provider response.');
            const reply = data as Reply;
            if (!['RETRIEVED', 'NO_QUOTES', 'REPLAYED'].includes(reply.status) || !reply.snapshot) {
                stop();
                setUnresolved(true);
                setSnapshot(null);
                setMessage(reply.reason + '. Review saved history; no automatic retry will run.');
                return;
            }
            if (reply.snapshot.requestId !== requestId || reply.snapshot.league !== league || reply.snapshot.mode !== mode)
                throw Error('Selection identity mismatch.');
            setSnapshot(reply.snapshot);
            setUnresolved(false);
            pendingId.current = null;
            setMessage(`${reply.status}: ${reply.snapshot.quotes.length} bookmaker observations; ${reply.requestsUsed} provider request attempted. Provider object usage and entitlement limits apply.`);
            if (session && remaining.current > 0 && document.visibilityState === 'visible') {
                remaining.current--;
                setSessionRemaining(remaining.current);
                if (remaining.current > 0)
                    timer.current = setTimeout(() => { if (remaining.current > 0)
                        void refresh(null, true); }, 60000);
            }
        }
        catch {
            if (current === generation.current) {
                stop();
                setSnapshot(null);
                setUnresolved(true);
                setMessage('Request or save could not be confirmed. Review history or reconcile this same request ID; no automatic provider retry will run.');
            }
        }
        finally {
            inFlight.current = false;
            if (current === generation.current)
                setBusy(false);
        }
    }
    function start() {
        if (!higherPlan || !confirmed || !configured || inFlight.current)
            return;
        remaining.current = cap;
        setSessionRemaining(cap);
        void refresh(null, true);
    }
    return <section className="simplePanel" id="sportsgameodds-tracker" data-refresh-tick={tick} aria-busy={busy}>
    <div className="correctedModelHeading"><h2>SportsGameOdds tracker</h2><span className="correctedHold">Optional provider · HOLD</span></div>
    <p>Compare real bookmaker observations over time. This provider runs alongside ParlayAPI. Source markets, periods and player IDs stay separate; an odds move does not establish a verified edge.</p>
    <div className="simpleButtons">
      <button className="simpleSecondary" type="button" disabled={busy || sessionRemaining > 0} onClick={check}>Check configuration · no provider call</button>
      {!signedIn && <button className="simpleSecondary" type="button" onClick={signIn}>Sign in for provider requests and history</button>}
    </div>
    {configured === false && <p>Store SPORTSGAMEODDS_KEY through the secure setup form. No key belongs in this page or chat. <a href="https://sportsgameodds.com/docs/basics/quickstart" target="_blank" rel="noopener noreferrer">Provider setup</a></p>}
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '16px 0' }}>
      <label>League <select value={league} disabled={busy} onChange={e => { edit(); setLeague(e.target.value as SgoLeague); }}>{SGO_LEAGUES.map(x => <option key={x}>{x}</option>)}</select></label>
      <label>Events <select value={mode} disabled={busy} onChange={e => { edit(); setMode(e.target.value as SgoMode); }}><option value="upcoming">Upcoming</option><option value="live">In progress</option></select></label>
    </div>
    <label style={{ display: 'block', marginBottom: 12 }}><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => void confirmUsage(e.target.checked)}/> I authorize provider usage: one request per manual load, up to 3 event objects per page. Provider request and object quotas apply; this is not a zero-credit check.</label>
    <div className="simpleButtons">
      <button className="simpleSecondary" type="button" disabled={busy || !signedIn || !configured || !confirmed || sessionRemaining > 0 || unresolved} onClick={() => void refresh()}>Load bookmaker observations · 1 request</button>
      {snapshot?.nextCursor && <button className="simpleSecondary" type="button" disabled={busy || !signedIn || !configured || sessionRemaining > 0 || unresolved || !confirmed} onClick={() => void refresh(snapshot.nextCursor)}>Load next provider page · 1 request</button>}
      <button className="simpleSecondary" type="button" disabled={busy || !signedIn} onClick={() => void loadHistory()}>Reload saved history · no provider call</button>
      {unresolved && <button className="simpleSecondary" type="button" disabled={busy || !signedIn || !configured || !confirmed} onClick={() => void refresh()}>Reconcile same request</button>}
    </div>
    {unresolved && <p>Request to reconcile: <code>{pendingId.current}</code>. After inspecting saved history, you may explicitly authorize a new request. A pending server lease may still require waiting.</p>}
    {unresolved && historyReviewed && <button className="simpleSecondary" type="button" disabled={busy} onClick={() => { pendingId.current = null; pendingCursor.current = null; setUnresolved(false); confirmationSequence.current++; confirmedAccount.current = null; setConfirmed(false); setHistoryReviewed(false); setMessage('New request selected. Confirm provider usage again before loading; the server cooldown still applies.'); }}>Use a new request after history review</button>}
    <details style={{ marginTop: 16 }}><summary>Optional capped tracking for higher-limit plans</summary>
      <p>Manual refresh is recommended for free plans. This visible-page session checks the first provider page every 60 seconds, up to the selected request cap. It stops on page hide, navigation, selection changes, sign-out or any error; it never resumes automatically.</p>
      <label><input type="checkbox" checked={higherPlan} disabled={busy || sessionRemaining > 0} onChange={e => setHigherPlan(e.target.checked)}/> My plan supports polling, and I authorize this capped session.</label>{' '}
      <label>Request cap <select value={cap} disabled={busy || sessionRemaining > 0} onChange={e => setCap(Number(e.target.value))}><option value={3}>3</option><option value={5}>5</option></select></label>
      <div className="simpleButtons"><button className="simpleSecondary" type="button" disabled={busy || !signedIn || !configured || !confirmed || !higherPlan || sessionRemaining > 0 || unresolved} onClick={start}>Start capped tracking</button><button className="simpleSecondary" type="button" disabled={sessionRemaining === 0} onClick={stop}>Stop tracking</button></div>
      <p role="status">{sessionRemaining > 0 ? `${sessionRemaining} authorized requests remaining, including any in progress.` : 'Tracking stopped.'}</p>
    </details>
    <p role="status" className="simpleFeedback">{message}</p>
    {snapshot && <>
      <p>Observed {time(snapshot.retrievedAt)} · {snapshot.returnedEvents} events · {snapshot.quotes.length} retained quotes · {snapshot.skippedQuotes} unsupported or unavailable entries skipped. {snapshot.truncated ? 'Quote display/storage cap reached; coverage is partial.' : ''} {snapshot.providerFiltered ? 'Provider reported restricted or filtered coverage.' : ''} {snapshot.nextCursor ? 'More provider pages exist; this is not the full board.' : ''}</p>
      {download?.snapshot === snapshot && <a className="correctedAuditDownload" href={download.url} download="edgeboard-sportsgameodds-observation.json">Download observation receipt</a>}
      <p>Saved baseline: {time(snapshot.baselineAt)}. Only matching native event/odd/book IDs with advancing source clocks and fresh observations are compared. Missing or suspended quotes never create a movement.</p>
      <div className="correctedTableScroll"><table><caption>Bookmaker observations — account availability and settlement unverified</caption><thead><tr><th>Event / player</th><th>Exact market / period / side</th><th>Book</th><th>Line</th><th>Price</th><th>Source time / freshness</th></tr></thead><tbody>
        {snapshot.quotes.map(q => <tr key={q.key}><td>{q.event}<br />{q.playerName ?? q.playerId ?? q.entityId}</td><td>{q.stat} · {q.betType} · {q.period} · {q.side}<br /><small>{q.oddId}</small></td><td>{q.bookmaker}</td><td>{q.line ?? '—'}</td><td>{price(q.americanOdds)}</td><td>{time(q.oddsAt)}<br />{freshness(q)}</td></tr>)}
      </tbody></table></div>
      <h3>Observed movement</h3>{snapshot.movementTruncated && <p>Showing the first 50 of {snapshot.movementCount} comparable movements; the stored movement list is capped.</p>}{snapshot.movements.length === 0 ? <p>No comparable movement detected in these saved observations. This is not proof that the entire board was unchanged.</p> : <ul>{snapshot.movements.map(m => <li key={m.key}>{m.event} · {m.oddId} · {m.bookmaker}: line {m.previous.line ?? '—'} → {m.current.line ?? '—'}; price {price(m.previous.americanOdds)} → {price(m.current.americanOdds)}</li>)}</ul>}
      <p>Betting decision: HOLD. No independent probability, positive-EV approval or wagering execution is supplied by this tracker.</p>
    </>}
    <h3>Saved request history</h3>
    {history.length === 0 ? <p>No history loaded. Reload history to inspect saved receipts and uncertain requests.</p> : <ul>{history.map(r => <li key={r.id}>{time(r.createdAt)} · {r.status} · {r.snapshot ? `${r.snapshot.quotes.length} quotes / ${r.snapshot.movements.length} changes` : r.reason ?? 'Request outcome pending'}{r.snapshot && <button className="simpleSecondary" type="button" disabled={busy} onClick={() => { stop(); setSnapshot(r.snapshot!); }}>View saved snapshot</button>}</li>)}</ul>}
    {historyToken && <button className="simpleSecondary" type="button" disabled={busy} onClick={() => void loadHistory(historyToken)}>Next saved history page</button>}
  </section>;
}
