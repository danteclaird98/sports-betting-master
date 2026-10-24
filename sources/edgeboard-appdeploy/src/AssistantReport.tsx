import { useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
type Report = {
  recommendationReadiness: {
    recommendationsEnabled: boolean;
    blockers: string[];
    implemented: string[];
    modelRegistry: Array<{
      version: string;
      scope: string;
      liveApproved: boolean;
      reportPath?: string;
      promotionBlockers: string[];
    }>;
    settlementReferences: Array<{
      id: string;
      topic: string;
      source: string;
      status: string;
      missing: string[];
    }>;
  };
  generatedAt: string;
  refreshAfter: string;
  decision: string;
  requested: { sport: string; date: string; timezone: string };
  decisionReasons: string[];
  qualifyingOpportunities: unknown[];
  scope: {
    gameEvents: number;
    gameQuotes: number;
    propCandidatesScreened: number;
    liveAnalysis: string;
    pastOrBeyondFeedWindow: boolean;
    propMarketCounts: Array<{
      market: string;
      candidatesScreened: number;
      qualifyingCount: number;
    }>;
  };
  model: {
    status: string;
    liveApproved: boolean;
    marketBenchmark?: {
      n: number;
      model: { logLoss: number };
      market: { logLoss: number };
      pairedLogLossDifference95: number[];
      limitation: string;
    };
  };
  propPriceSamples?: Array<{ event: string; player: string; market: string; side: string; line: number; publicUnderdogDecimalPrice: number | null; decision: string }>;
  gamePrices: Array<{
    event: string;
    market: string;
    selection: string;
    line: number | null;
    sportsbook: string;
    americanOdds: number;
    validation: { status: string; exclusions: string[] };
  }>;
  sourceHealth: Array<{
    source: string;
    status: string;
    retrievedAt: string | null;
  }>;
};
function today() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts()
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
const reportSports = [
  ['baseball_mlb', 'MLB'],
  ['americanfootball_nfl', 'NFL'],
  ['americanfootball_ncaaf', 'College football'],
  ['basketball_nba', 'NBA'],
  ['basketball_wnba', 'WNBA'],
  ['icehockey_nhl', 'NHL'],
  ['tennis', 'Tennis props'],
  ['mma', 'MMA props'],
];
export default function AssistantReport() {
  const [sport, setSport] = useState('americanfootball_nfl');
  const [date, setDate] = useState(today);
  const [zone, setZone] = useState('America/Los_Angeles');
  const [paid, setPaid] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const query = new URLSearchParams({ sport, date, timezone: zone }).toString();
  const url = `https://api-v2.appdeploy.ai/app/edgeboard-kshzox/api/assistant-report?${query}`;
  async function generate() {
    const request = ++generation.current;
    setBusy(true);
    setMessage('');
    setReport(null);
    try {
      if (paid && !auth.isSignedIn()) await auth.signIn();
      const response = paid
        ? await api.post('/api/assistant-report', {
            sport,
            date,
            timezone: zone,
            includeReferences: true,
          })
        : await api.get(`/api/assistant-report?${query}`);
      if (request === generation.current) {
        setReport(response.data);
        setMessage('Report ready. Copy or download it for analysis.');
      }
    } catch (e) {
      if (request === generation.current)
        setMessage(
          e instanceof Error
            ? e.message
            : 'Report unavailable. Check the date/timezone and retry.',
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setMessage('Assistant report copied.');
    } catch {
      setMessage(
        'Clipboard unavailable. Use Download assistant report instead.',
      );
    }
  }
  function download() {
    if (!report) return;
    const blobUrl = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `edgeboard-${report.requested.sport}-${report.requested.date}.json`;
    a.click();
    URL.revokeObjectURL(blobUrl);
    setMessage('Assistant report downloaded.');
  }
  return (
    <section className="researchSetup" aria-label="Assistant research report">
      <h2>Ask EdgeBoard</h2>
      <p>
        One report for the assistant: requested-day markets, observed prices,
        full-board counts, model readiness, coverage and reasons to pass. Public
        reports use $0 feeds.
      </p>
      <div className="setupActions">
        <label>
          Report sport{' '}
          <select
            aria-label="Assistant report sport"
            disabled={busy}
            value={sport}
            onChange={(e) => {
              setSport(e.target.value);
              setReport(null);
            }}
          >
            {reportSports.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Research date{' '}
          <input
            aria-label="Assistant report date"
            type="date"
            disabled={busy}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setReport(null);
            }}
          />
        </label>
        <label>
          Timezone{' '}
          <input
            aria-label="Assistant report timezone"
            disabled={busy}
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              setReport(null);
            }}
          />
        </label>
        <button disabled={busy} onClick={generate}>
          {busy ? 'Building report…' : 'Build assistant report'}
        </button>
      </div>
      <p>
        <label>
          <span>
            <input
              type="checkbox"
              disabled={busy}
              checked={paid}
              onChange={(e) => {
                setPaid(e.target.checked);
                setReport(null);
              }}
            />{' '}
            Include sportsbook prop references (sign-in required; may use
            credits)
          </span>
        </label>
      </p>
      <p>
        <a href={url} target="_blank" rel="noreferrer">
          Open assistant JSON report
        </a>{' '}
        · signed-in reference results can be copied or downloaded.
      </p>
      {report && (
        <>
          <details>
            <summary>Settlement, model and stake readiness</summary>
            <p>
              Recommendations enabled:{' '}
              {String(report.recommendationReadiness.recommendationsEnabled)}.
              Calculation support does not prove model quality or verify a
              ticket.
            </p>
            <ul>
              {report.recommendationReadiness.blockers.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <h4>Evaluated model registry</h4>
            {report.recommendationReadiness.modelRegistry.map((m) => (
              <div key={m.version}>
                <p>
                  <strong>{m.version}</strong> · live approved:{' '}
                  {String(m.liveApproved)}
                </p>
                <p>{m.scope}</p>
                <ul>
                  {m.promotionBlockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p>Implemented calculation support:</p>
            <ul>
              {report.recommendationReadiness.implemented.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {report.recommendationReadiness.settlementReferences.map((r) => (
              <div key={r.id}>
                <p>
                  <a href={r.source} target="_blank" rel="noreferrer">
                    Official rule reference
                  </a>
                  : {r.topic}
                </p>
                <p>{r.status}</p>
                <ul>
                  {r.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
          <h3>{report.decision.split('_').join(' ')}</h3>
          <p>
            {report.requested.date} · {report.requested.timezone} · generated{' '}
            {report.generatedAt}. Refresh after {report.refreshAfter}; price
            validity remains unverified.
          </p>
          <p>
            <strong>{report.qualifyingOpportunities.length} qualifying</strong>{' '}
            · {report.scope.gameEvents} pregame events ·{' '}
            {report.scope.gameQuotes} observed game quotes ·{' '}
            {report.scope.propCandidatesScreened.toLocaleString()} prop
            market-side prices screened (not independently modeled).
          </p>
          {!!report.propPriceSamples?.length && <details><summary>Sample public prop prices · not Caesars or verified EV</summary>{report.propPriceSamples.map((p, i) => <p key={i}>{p.player} {p.side} {p.line} {p.market} ({p.event}); Underdog decimal {p.publicUnderdogDecimalPrice ?? 'unavailable'}, status {p.decision}. No approved independent probability.</p>)}</details>}
          {report.scope.pastOrBeyondFeedWindow && (
            <p>
              Requested date is outside the feed window. Missing coverage is not
              evidence of no betting edge.
            </p>
          )}
          <p>
            Model: {report.model.status} · live approved:{' '}
            {String(report.model.liveApproved)}. {report.scope.liveAnalysis}
          </p>
          {report.model.marketBenchmark && (
            <p>
              Matched archived moneyline evaluation:{' '}
              {report.model.marketBenchmark.n} held-out games. Candidate log
              loss {report.model.marketBenchmark.model.logLoss.toFixed(4)};
              market benchmark{' '}
              {report.model.marketBenchmark.market.logLoss.toFixed(4)} (lower is
              better). 95% week-block interval for candidate minus market: [
              {report.model.marketBenchmark.pairedLogLossDifference95
                .map((v) => v.toFixed(4))
                .join(', ')}
              ]. {report.model.marketBenchmark.limitation}
            </p>
          )}
          <details>
            <summary>Probability and price validation by wager</summary>
            <div className="setupTable">
              <table>
                <thead>
                  <tr>
                    <th>Event / selection</th>
                    <th>Exact market</th>
                    <th>Observed price</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {report.gamePrices.map((q, i) => (
                    <tr key={i}>
                      <td>
                        {q.event}
                        <br />
                        {q.selection}
                      </td>
                      <td>
                        {q.market}
                        {q.line !== null ? ` ${q.line}` : ''}
                      </td>
                      <td>
                        {q.sportsbook} {q.americanOdds > 0 ? '+' : ''}
                        {q.americanOdds}
                      </td>
                      <td>
                        {q.validation.status}
                        <ul>
                          {q.validation.exclusions.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.gamePrices.length && (
              <p>
                No upcoming game prices in this report. No probability or EV is
                manufactured.
              </p>
            )}
          </details>
          <ul>
            {report.decisionReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="setupTable">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Retrieved at</th>
                </tr>
              </thead>
              <tbody>
                {report.sourceHealth.map((s) => (
                  <tr key={s.source}>
                    <td>{s.source}</td>
                    <td>{s.status}</td>
                    <td>{s.retrievedAt ?? 'unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Full-board market counts</summary>
            <div className="setupTable">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Screened</th>
                    <th>Qualifying</th>
                  </tr>
                </thead>
                <tbody>
                  {report.scope.propMarketCounts.map((m) => (
                    <tr key={m.market}>
                      <td>{m.market}</td>
                      <td>{m.candidatesScreened}</td>
                      <td>{m.qualifyingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="setupActions">
            <button onClick={copy}>Copy assistant report</button>
            <button onClick={download}>Download assistant report</button>
            <button disabled={busy} onClick={generate}>
              Refresh assistant report
            </button>
          </div>
        </>
      )}
      {message && (
        <p className="setupMessage" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
