import { useState } from 'react';
import { api, auth } from '@appdeploy/client';

type Quote = {
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
  fresh: boolean;
  sourceStatus: string;
};
type Feed = {
  status: string;
  retrievedAt: string;
  quotes: Quote[];
  freshCount: number;
  partialBoard: boolean;
  creditsRemaining: number | null;
  sourceHealth: Array<{ family: string; status: string; rows: number }>;
};
export default function CaesarsFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [archiveNote, setArchiveNote] = useState('');
  async function archiveQuotes() {
    if (!feed?.quotes?.length) return;
    try {
      if (!auth.isSignedIn()) await auth.signIn();
      if (!auth.isSignedIn()) return;
      const { data } = await api.post('/api/quote-archive', { sport, quotes: feed.quotes.slice(0, 50).map(q => ({ ...q, sportsbook: 'Caesars' })) });
      setArchiveNote('Saved ' + (data as { observations: number }).observations + ' observed quotes to your private research archive.');
    } catch { setArchiveNote('Could not archive prices; nothing saved.'); }
  }
  const [sport, setSport] = useState('americanfootball_nfl');
  async function load() {
    setBusy(true);
    setError('');
    setFeed(null);
    try {
      const { data } = await api.get('/api/caesars-feed?sport=' + encodeURIComponent(sport));
      setFeed(data as Feed);
    } catch {
      setError(
        'Caesars feed could not load. Retry; no substitute prices are shown.',
      );
    } finally {
      setBusy(false);
    }
  }
  const filtered =
    feed?.quotes.filter((q) =>
      [q.player, q.event, q.eventId, q.market, q.selection]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <section>
      <h3>Caesars multi-sport prices</h3>
      <p>
        Load Caesars game lines and player props through ParlayAPI. Uses
        existing provider credits, caches requests for 60 seconds and does not
        refresh automatically. Select one sport per request to control provider-credit use.
      </p>
      <label>Sport <select value={sport} onChange={e => { setSport(e.target.value); setFeed(null); }}>
        <option value='americanfootball_nfl'>NFL</option><option value='americanfootball_ncaaf'>College football</option><option value='baseball_mlb'>MLB</option><option value='basketball_nba'>NBA</option><option value='basketball_wnba'>WNBA</option><option value='icehockey_nhl'>NHL</option>
      </select></label>
      <button disabled={busy} onClick={load}>
        {busy ? 'Loading Caesars…' : 'Load selected Caesars prices'}
      </button>
      {error && <p role="alert">{error}</p>}
      {feed && <button type='button' disabled={!feed.quotes.length} onClick={archiveQuotes}>Archive first 50 observed prices</button>}
      {archiveNote && <p>{archiveNote}</p>}
      {feed && (
        <>
          <p>
            <strong>{feed.status}</strong> · {feed.quotes.length} Caesars
            observations · {feed.freshCount} with source timestamps within 120
            seconds at retrieval.
          </p>
          <p>
            Retrieved {feed.retrievedAt}. Provider credits remaining:{' '}
            {feed.creditsRemaining ?? 'unknown'}.{' '}
            {feed.partialBoard
              ? 'Partial board; additional rows may exist.'
              : 'No pagination flag reported; complete coverage is not guaranteed.'}
          </p>
          {feed.sourceHealth.map((s) => (
            <p key={s.family}>
              {s.family}: {s.status} · {s.rows} source rows
            </p>
          ))}
          <p>
            SCREEN ONLY. Account availability and settlement rules are
            unverified. Exact SGP payouts and promo eligibility must be checked
            in Caesars; individual prices are not multiplied into a parlay
            price. Probability and EV remain unavailable.
          </p>
          <label>
            Find player, market or event{' '}
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="setupTable">
            <table>
              <thead>
                <tr>
                  <th>Player / event</th>
                  <th>Market / selection</th>
                  <th>Caesars price</th>
                  <th>Source time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((q, i) => (
                  <tr key={i}>
                    <td>
                      {q.player ?? q.event ?? 'Event unknown'}
                      <small>
                        {q.event ?? q.eventId ?? 'Event identity unavailable'}
                      </small>
                    </td>
                    <td>
                      {q.market} · {q.selection} {q.line ?? ''}
                      <small>
                        {q.period} · source status {q.sourceStatus}
                      </small>
                    </td>
                    <td>
                      {q.americanOdds > 0 ? '+' : ''}
                      {q.americanOdds}
                    </td>
                    <td>
                      {q.oddsAt ?? 'Timestamp unknown'}
                      <small>
                        {q.fresh
                          ? 'Within 120 seconds at retrieval'
                          : 'Stale or unknown'}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <p>
              No matching Caesars quotes. Other sportsbooks are not substituted.
            </p>
          )}
          {filtered.length > 200 && (
            <p>
              Showing the first 200 matching observations. Narrow the search to
              see a specific player or market.
            </p>
          )}
        </>
      )}
    </section>
  );
}
