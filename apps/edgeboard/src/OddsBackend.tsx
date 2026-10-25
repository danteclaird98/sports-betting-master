import { useEffect, useRef, useState } from 'react';
import { api, auth } from '../../../runtime/client.ts';

type Event = { id: number; sport: string; league: string; home_team: string; away_team: string; start_time_utc: string };
type Market = { id: number; type: string; line: number | null; selections: { id: number; name: string }[] };
type Quote = { selection_id: number; bookmaker_id: number; price_american: number; fetched_at: string };
type Book = { id: number; name: string };
type Envelope = { state: string; dataMode: string | null; error?: string; data?: unknown };

export default function OddsBackend() {
  const [status, setStatus] = useState<Envelope | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [selected, setSelected] = useState('');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [latest, setLatest] = useState<Quote[]>([]);
  const [history, setHistory] = useState<Quote[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Check the connection before loading stored observations.');
  const generation = useRef(0);
  useEffect(() => () => { ++generation.current; }, []);

  function clear() { setEvents([]); setSelected(''); setMarkets([]); setLatest([]); setHistory([]); setBooks([]); }
  async function read(path: string) {
    const { data } = await api.get('/api/odds-backend/' + path);
    const value = data as Envelope;
    if (value.state !== 'READY') throw Error(value.error || 'Backend unavailable');
    return value;
  }
  async function run(action: (current: () => boolean) => Promise<void>) {
    const requestId = ++generation.current;
    setBusy(true); setMessage('');
    try { await action(() => generation.current === requestId); }
    catch {
      if (generation.current === requestId) {
        clear(); setStatus(null);
        setMessage('Stored odds unavailable. No observations or research conclusions were substituted. Check the connection and retry.');
      }
    } finally { if (generation.current === requestId) setBusy(false); }
  }
  function check() {
    void run(async (current) => {
      clear();
      const { data } = await api.get('/api/odds-backend/status');
      if (!current()) return;
      setStatus(data);
      setMessage(data.state === 'READY' ? 'Read-only backend connected. Stored prices are not executable quotes.' :
        data.state === 'NOT_CONFIGURED' ? 'Backend not connected. Configure the owned HTTPS service and its server-side read token.' :
        'Backend unavailable. Check the service and retry.');
    });
  }
  function load() {
    void run(async (current) => {
      clear();
      if (!auth.isSignedIn()) await auth.signIn();
      if (!auth.isSignedIn()) throw Error('Sign in required');
      const value = await read('events?limit=50');
      if (!current()) return;
      setStatus(value); setEvents(value.data as Event[]);
      setMessage('Showing up to 50 stored events. This does not scan providers or place wagers.');
    });
  }
  function detail() {
    const eventId = selected;
    void run(async (current) => {
      setMarkets([]); setLatest([]); setHistory([]); setBooks([]);
      const values = await Promise.all([read('events/' + eventId), read('events/' + eventId + '/markets?limit=100'),
        read('latest?event_id=' + eventId + '&limit=100'), read('bookmakers?limit=100')]);
      if (!current()) return;
      if (values.some((value) => value.dataMode !== values[0].dataMode)) throw Error('Backend mode changed');
      setStatus(values[0]); setMarkets(values[1].data as Market[]); setLatest(values[2].data as Quote[]); setBooks(values[3].data as Book[]);
      setMessage('Up to 100 markets and latest selection/bookmaker observations. Source quote clocks remain unavailable.');
    });
  }
  function loadHistory() {
    const eventId = selected;
    void run(async (current) => {
      setHistory([]);
      const value = await read('history?event_id=' + eventId + '&limit=100');
      if (!current()) return;
      if (status && value.dataMode !== status.dataMode) throw Error('Backend mode changed');
      setStatus(value); setHistory(value.data as Quote[]); setMessage('Showing the first 100 historical snapshots at most; fetched times are not source quote times.');
    });
  }
  const name = (id: number) => markets.flatMap((m) => m.selections).find((s) => s.id === id)?.name || 'Selection ' + id;
  const book = (id: number) => books.find((b) => b.id === id)?.name || 'Bookmaker ' + id;
  return <section className='panel lab' aria-label='Stored odds backend'>
    <h2>Stored odds backend</h2>
    <p>Read-only access to the existing aggregation service. Your current research tools and private ledgers remain separate.</p>
    <button type='button' className='scanButton' disabled={busy} onClick={check}>Check backend connection</button>
    <button type='button' className='scanButton' disabled={busy || status?.state !== 'READY'} onClick={load}>Load stored events</button>
    {status?.dataMode === 'mock' && <p role='note'><strong>SYNTHETIC MOCK DATA — examples only, never live odds or wager recommendations.</strong></p>}
    {status?.dataMode === 'configured_sources' && <p>Configured-source storage; freshness and provider entitlement require separate verification.</p>}
    <p role='status'>{message}</p>
    {events.length > 0 && <>
      <label>Stored event <select value={selected} disabled={busy} onChange={(e) => {
        ++generation.current; setSelected(e.target.value); setMarkets([]); setLatest([]); setHistory([]); setBooks([]);
      }}><option value=''>Choose an event</option>{events.map((e) => <option key={e.id} value={e.id}>
        {e.league}: {e.away_team} at {e.home_team} · {new Date(e.start_time_utc).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT
      </option>)}</select></label>
      <button type='button' className='scanButton' disabled={busy || !selected} onClick={detail}>View stored markets</button>
      <button type='button' className='scanButton' disabled={busy || !selected} onClick={loadHistory}>View snapshot history</button>
    </>}
    {markets.map((m) => <p key={m.id}>{m.type}{m.line === null ? '' : ' ' + m.line}: {m.selections.map((s) => s.name).join(', ')}</p>)}
    {latest.length > 0 && <><h3>Latest stored observations</h3><ul>{latest.map((q) => <li key={q.selection_id + ':' + q.bookmaker_id}>
      {name(q.selection_id)} · {book(q.bookmaker_id)} · {q.price_american > 0 ? '+' : ''}{q.price_american} · Fetched {q.fetched_at}
    </li>)}</ul></>}
    {history.length > 0 && <><h3>Snapshot history</h3><ul>{history.map((q, index) => <li key={index}>
      {name(q.selection_id)} · {book(q.bookmaker_id)} · {q.price_american} · Fetched {q.fetched_at}
    </li>)}</ul></>}
    <p>Source quote time and settlement equivalence: unavailable from this API. Model probability and EV: unavailable. Research-only; financial execution disabled.</p>
  </section>;
}
