import { useState } from 'react';
import { api } from '@appdeploy/client';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';

type QueueItem = {
  lineId: string;
  event: string;
  startTime: string;
  player: string;
  market: string;
  line: number;
  higherDecimal: number | null;
  lowerDecimal: number | null;
  twoSided: boolean;
  quoteTimestampFresh: boolean;
  statusConfirmedOpen: boolean;
};
type Pipeline = {
  sport: string;
  recommendation: string;
  status: string;
  source: string;
  retrievedAt: string;
  sourceAgeSeconds: number | null;
  sourceStale: boolean;
  sourceTruncated: boolean;
  totalMatchingLines: number;
  creditsUsed: number;
  funnel: Record<string, number>;
  marketCounts: Array<{ market: string; lines: number }>;
  comparisonQueue: QueueItem[];
  comparisonQueueBasis: string;
  blockers: string[];
};
const sports = [
  ['americanfootball_nfl', 'NFL'],
  ['basketball_nba', 'NBA'],
  ['icehockey_nhl', 'NHL'],
  ['baseball_mlb', 'MLB'],
  ['americanfootball_ncaaf', 'College football'],
  ['soccer', 'Soccer'],
] as const;

export default function ResearchPipeline() {
  const [sport, setSport] = useState('americanfootball_nfl');
  const [report, setReport] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  async function inspect() {
    setLoading(true);
    setProblem('');
    setReport(null);
    try {
      const response = await api.get('/api/research-pipeline?sport=' + encodeURIComponent(sport));
      setReport(response.data as Pipeline);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Public source unavailable.');
    } finally {
      setLoading(false);
    }
  }
  const f = report?.funnel;
  return (
    <section className="panel lab" aria-label="Free research pipeline">
      <div className="sectionHead">
        <div>
          <h2><Activity size={20} /> Research pipeline audit</h2>
          <p>Inspect the $0 source before spending provider credits. Prioritize completeness, not supposed EV.</p>
        </div>
      </div>
      <div className="setupActions">
        <label>
          Sport{' '}
          <select value={sport} onChange={e => { setSport(e.target.value); setReport(null); }}>
            {sports.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button type="button" disabled={loading} onClick={inspect}>
          <RefreshCw size={15} /> {loading ? 'Inspecting…' : 'Inspect free prop coverage'}
        </button>
      </div>
      {problem && <div className="errorBox">{problem}</div>}
      {report && (
        <>
          <p><ShieldCheck size={15} /> <strong>{report.recommendation} — not a betting signal.</strong>{' '}
            {report.totalMatchingLines} matching source lines, {report.creditsUsed} provider credits spent.
          </p>
          <p className="sourceNote">
            Retrieved {report.retrievedAt} · source age {report.sourceAgeSeconds === null ? 'unknown' : report.sourceAgeSeconds + 's'}
            {report.sourceStale ? ' · STALE SNAPSHOT' : ''}
            {report.sourceTruncated ? ' · TRUNCATED FIRST 1,000 LINES' : ''}
          </p>
          {f && (
            <div className="coverageGrid">
              <div><span>Future pregame lines</span><strong>{f.futurePregameLines ?? 0}</strong></div>
              <div><span>Started events excluded</span><strong>{f.startedEventsExcluded ?? 0}</strong></div>
              <div><span>Suspended/closed excluded</span><strong>{f.closedOrSuspendedExcluded ?? 0}</strong></div>
              <div><span>Both sides priced</span><strong>{f.fullTwoSidePrices ?? 0}</strong></div>
              <div><span>One side priced</span><strong>{f.oneSidePrices ?? 0}</strong></div>
              <div><span>Fresh line timestamps</span><strong>{f.timestampedWithin120Seconds ?? 0}</strong></div>
              <div><span>Stale/unknown line timestamps</span><strong>{f.missingOrStaleLineTimestamp ?? 0}</strong></div>
              <div><span>Unconfirmed status</span><strong>{f.unconfirmedMarketStatus ?? 0}</strong></div>
              <div><span>Events / players</span><strong>{f.uniqueEvents ?? 0} / {f.uniquePlayers ?? 0}</strong></div>
            </div>
          )}
          <p className="hint">Comparison queue below is sorted by feed quality and kickoff, not win probability. Prices may not be executable.</p>
          {report.comparisonQueue.length ? (
            <div className="setupTable">
              <table>
                <thead><tr><th>Event / player</th><th>Market</th><th>Public decimal sides</th><th>Evidence</th></tr></thead>
                <tbody>
                  {report.comparisonQueue.map(item => (
                    <tr key={item.lineId}>
                      <td><strong>{item.player}</strong><small>{item.event} · {new Date(item.startTime).toLocaleString()}</small></td>
                      <td>{item.market} {item.line}</td>
                      <td>Higher {item.higherDecimal?.toFixed(3) ?? '—'} / Lower {item.lowerDecimal?.toFixed(3) ?? '—'}</td>
                      <td>
                        <small>{item.twoSided ? 'Two-sided public quote' : 'One side missing'}</small>
                        <small>{item.quoteTimestampFresh ? 'Line timestamp within 120s' : 'Quote timestamp unverified/stale'}</small>
                        <small>{item.statusConfirmedOpen ? 'Open-status field observed' : 'Status not confirmed open'}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p>No usable future pregame source lines. HOLD; this is not a model failure.</p>}
          <p><strong>Remaining blockers:</strong> {report.blockers.join(' ')}</p>
          <p>Next verification: <a href="#models">Model &amp; sportsbook references</a> — signed-in cross-book requests are opt-in and may use credits.</p>
        </>
      )}
    </section>
  );
}
