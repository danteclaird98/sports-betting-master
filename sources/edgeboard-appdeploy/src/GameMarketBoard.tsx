import { useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import { RefreshCw, ShieldCheck } from 'lucide-react';

type BestPrice = {
  key: string;
  event: string;
  league: string;
  commenceTime: string;
  market: 'moneyline' | 'spread' | 'total';
  selection: string;
  line: number | null;
  bestBook: string;
  bestAmericanOdds: number;
  bestDecimalOdds: number;
  rawImpliedProbability: number;
  deViggedComparator: number | null;
  bookMargin: number | null;
  otherBookCount: number;
  retrievedAt: string;
  researchStatus: 'SCREEN_ONLY';
  reasonsToAbstain: string[];
};

type GameMarketResponse = {
  provider: string;
  sourceMode: string;
  cost: string;
  sport: string;
  league: string;
  supported: boolean;
  pregame: boolean;
  live: boolean;
  historical: boolean;
  generatedAt: string;
  eventCount: number;
  quoteCount: number;
  bestPriceCount: number;
  oddsTimestampAvailable: boolean;
  quoteTimestampPolicy: string;
  modelPolicy: string;
  settlementPolicy: string;
  bestPrices: BestPrice[];
};

const supported = new Set([
  'baseball_mlb',
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  'basketball_nba',
  'basketball_wnba',
  'icehockey_nhl',
]);

function american(value: number) {
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
}

function marketLabel(item: BestPrice) {
  if (item.market === 'moneyline') return `${item.selection} ML`;
  const line = item.line === null ? '' : `${item.line > 0 ? '+' : ''}${item.line}`;
  return `${item.selection} ${line} ${item.market === 'total' ? 'total' : 'spread'}`;
}

function GameMarketBoard({ sport }: { sport: string }) {
  const [data, setData] = useState<GameMarketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [filter, setFilter] = useState<'all' | 'moneyline' | 'spread' | 'total'>('all');

  useEffect(() => {
    setData(null);
    setErrorText('');
  }, [sport]);

  const rows = useMemo(() => {
    if (!data) return [];
    const filtered = filter === 'all' ? data.bestPrices : data.bestPrices.filter(item => item.market === filter);
    return filtered.slice(0, 80);
  }, [data, filter]);

  async function load() {
    setLoading(true);
    setErrorText('');
    try {
      const { data: response } = await api.get(`/api/v1/game-odds?sport=${encodeURIComponent(sport)}&hours=48`);
      setData(response as GameMarketResponse);
    } catch (loadError) {
      setErrorText(loadError instanceof Error ? loadError.message : 'Free game markets could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  if (!supported.has(sport)) {
    return (
      <section className="panel lab">
        <div className="sectionHead">
          <div>
            <h2>Free game-market discovery</h2>
            <p>No verified no-key game-odds adapter is connected for this sport yet. Prop discovery can still use the free Underdog feed when that sport is on its board.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel lab">
      <div className="sectionHead">
        <div>
          <h2>Free game-market discovery</h2>
          <p>Pregame moneylines, exact spreads and exact totals from public ESPN sportsbook snapshots. This is price discovery, not an EV claim.</p>
        </div>
        <button className="miniButton" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> {data ? 'Refresh' : 'Load markets'}
        </button>
      </div>

      <div className="sportRow">
        {(['all', 'moneyline', 'spread', 'total'] as const).map(value => (
          <button key={value} type="button" className={filter === value ? 'chip active' : 'chip'} onClick={() => setFilter(value)}>
            {value === 'all' ? 'All game markets' : value}
          </button>
        ))}
      </div>

      {errorText && <div className="errorBox">{errorText}</div>}
      {!data && !errorText && (
        <div className="hint">No API key or paid subscription is required. Load only when you want the current 48-hour pregame board.</div>
      )}

      {data && (
        <>
          <div className="coverageGrid">
            <div><span>Events</span><strong>{data.eventCount}</strong></div>
            <div><span>Raw book quotes</span><strong>{data.quoteCount}</strong></div>
            <div><span>Exact best prices</span><strong>{data.bestPriceCount}</strong></div>
            <div><span>Cost</span><strong>{data.cost}</strong></div>
            <div><span>Odds timestamp</span><strong>{data.oddsTimestampAvailable ? 'available' : 'unknown'}</strong></div>
            <div><span>Research status</span><strong>SCREEN ONLY</strong></div>
          </div>

          <div className="signalNotice">
            <div>
              <strong><ShieldCheck size={16} /> Why no EV is shown</strong>
              <span>{data.quoteTimestampPolicy} {data.modelPolicy}</span>
            </div>
            <small>{data.settlementPolicy}</small>
          </div>

          {rows.length === 0 ? (
            <div className="empty"><strong>No supported pregame prices returned.</strong><span>That is a valid result; EdgeBoard does not fabricate unavailable markets.</span></div>
          ) : (
            <div className="gameMarketTable">
              {rows.map(item => (
                <article className="gameMarketRow" key={item.key}>
                  <div className="gameMarketMain">
                    <span>{item.league} · {new Date(item.commenceTime).toLocaleString()}</span>
                    <strong>{item.event}</strong>
                    <b>{marketLabel(item)}</b>
                  </div>
                  <div className="gameMarketPrice">
                    <span>Best verified price at retrieval</span>
                    <strong>{item.bestBook} · {american(item.bestAmericanOdds)} ({item.bestDecimalOdds.toFixed(2)}x)</strong>
                    <small>raw implied {(item.rawImpliedProbability * 100).toFixed(1)}%{item.deViggedComparator === null ? '' : ` · same-book de-vig ${(item.deViggedComparator * 100).toFixed(1)}%`} · {item.otherBookCount} other book{item.otherBookCount === 1 ? '' : 's'}</small>
                  </div>
                  <span className="verifyTag warnTag">SCREEN ONLY · NO EV</span>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default GameMarketBoard;
