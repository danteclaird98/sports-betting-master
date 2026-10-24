import { useState } from 'react';
import { api, auth } from '@appdeploy/client';
import CaesarsFeed from './CaesarsFeed';
type Comparison = {
  event: string;
  player: string;
  market: string;
  line: number;
  period: string;
  selection: string;
  referenceBookCount: number;
  bestVerifiedPrice: { book: string; decimalOdds: number } | null;
  quotes: Array<{
    book: string;
    decimalOdds: number;
    oddsAt: string | null;
    fresh: boolean;
  }>;
};
type ReferenceResult = {
  status: string;
  rowsLoaded?: number;
  referenceBookCount?: number;
  comparisons: Comparison[];
  nextOffset?: number | null;
  partialBoard?: boolean;
  diagnostics?: {
    rows: number;
    missingCanonicalEventId: number;
    missingCanonicalPlayerId: number;
    missingPeriod: number;
    missingSettlementRules: number;
    unknownOrOldTimestamp: number;
    futureTimestamp: number;
    inactiveOrUnknownStatus: number;
    incompleteTwoWayPrice: number;
    technicallyComparableRows: number;
  };
  note?: string;
};
type ScanResult = {
  candidatesScreened: number;
  returnedRows: number;
  nextOffset: number | null;
  offset: number;
  researchPassCount: number;
  generatedAt: string;
  edges: Array<{
    id: string;
    player: string;
    marketLabel: string;
    side: string;
    line: number;
  }>;
};
type Metric = { n: number; brier: number; logLoss: number };
type MlbReport = {
  status: string;
  liveApproved: boolean;
  scope: string;
  test: Metric;
  baseRate: Metric;
  bySegment: Array<
    Metric & { segment: string; baseRate: Metric; fairCoin: Metric }
  >;
  bySeason: Array<Metric & { season: number }>;
  splits: Array<{ name: string; seasons: number[]; n: number }>;
  uncertainty: { interval95: number[] };
  conclusion: string;
  promotionBlockers: string[];
  replayAssumptions: string[];
  source: { snapshots: Array<{ season: number; url: string; sha256: string }> };
};
type BaselineReport = {
  status: string;
  liveApproved: boolean;
  scope: string;
  source: { url: string; commit: string; downloadedAt: string };
  test: Metric;
  baseRate: Metric;
  splits: Array<{ name: string; n: number; seasons: number[]; ties: number }>;
  uncertainty: { interval95: number[] };
  conclusion: string;
  promotionBlockers: string[];
  replayAssumptions: string[];
  brierDefinition: string;
};
type ModelResult = {
  status: string;
  liveApproved: boolean;
  test: Metric;
  baseRate: Metric;
  marketBenchmark: Metric;
  conclusion: string;
  promotionBlockers: string[];
  splits: Array<{ name: string; samples: number; events: number }>;
  uncertainty: { interval95: number[] };
  returns: {
    selected: number;
    roi: number | null;
    selectionPolicy?: string;
    excludedRepeatedEventObservations?: number;
  };
};
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const schema = {
  source:
    'Replace with historical provider and point-in-time collection method',
  featureNames: ['projected_opportunities', 'prior_rate'],
  featureDefinitions: [
    'Pre-decision opportunity projection and source',
    'Rate computed only from outcomes available before decision',
  ],
  rows: [],
  rowSchema: {
    id: 'unique selection ID',
    eventId: 'stable event ID',
    sport: 'americanfootball_nfl',
    market: 'one exact market and settlement scope',
    decisionAt: 'ISO timezone timestamp',
    featuresAt: 'ISO timestamp <= decisionAt',
    settledAt: 'confirmed ISO settlement after decisionAt',
    oddsAt: 'ISO timestamp <= decisionAt',
    features: ['number per named feature'],
    outcome: '0 loss or 1 win',
    decimalOdds: 'offered decimal odds',
    oppositeDecimalOdds: 'exact matched opposite-side decimal odds',
    available: 'boolean historical availability',
    feePerUnit: 'number >=0 and <1',
    settlement: 'binary_no_push',
  },
};
export default function ResearchSetup() {
  const [sport, setSport] = useState('americanfootball_nfl');
  const [signedIn, setSignedIn] = useState(auth.isSignedIn());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [refs, setRefs] = useState<ReferenceResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ModelResult | null>(null);
  const [baseline, setBaseline] = useState<BaselineReport | null>(null);
  const [mlb, setMlb] = useState<MlbReport | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      const problem = e as {
        message?: string;
        response?: { data?: { error?: string; message?: string } };
      };
      setMessage(
        problem.response?.data?.error ??
          problem.response?.data?.message ??
          problem.message ??
          'Request failed. Retry when the source is available.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadBoard(offset = 0) {
    const { data } = await api.get(
      `/api/assistant-scan?sport=${encodeURIComponent(sport)}&scan=props&timing=pregame&limit=150&offset=${offset}`,
    );
    setScan(data.scan);
    setMessage(
      'Full matching board screened; displayed rows are paginated. Refreshed snapshots may reorder rows.',
    );
  }
  async function loadReferences(offset = 0) {
    const { data } = await api.post('/api/reference-props', { sport, offset });
    setRefs(data);
    setMessage(data.note ?? data.status);
  }
  async function evaluate() {
    setReport(null);
    if (!file) throw Error('Choose a historical JSON file first.');
    if (file.size > 5 * 1024 * 1024)
      throw Error('Historical JSON must be under 5 MB.');
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw Error('The file is not valid JSON.');
    }
    const response = await api.post('/api/model-evaluate', data);
    setReport(response.data);
    setMessage(
      'Evaluation complete. Candidate results do not approve a live model.',
    );
  }
  return (
    <details className="researchSetup" open>
      <summary>Model &amp; sportsbook references</summary>
      <p>
        Screen broadly. Compare exact wagers. Qualify only with a validated
        independent model. Market prices remain benchmarks; unsupported
        probability and EV are withheld.
      </p>
      <div className="setupActions">
        <label>
          Sport key{' '}
          <input
            aria-label="Research sport key"
            value={sport}
            onChange={(e) => {
              setSport(e.target.value);
              setScan(null);
              setRefs(null);
            }}
          />
        </label>
        <button disabled={busy} onClick={() => run(() => loadBoard())}>
          Screen full prop board
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (auth.isSignedIn()) {
                await auth.signOut();
                setSignedIn(false);
                setReport(null);
                setRefs(null);
              } else {
                await auth.signIn();
                setSignedIn(true);
              }
            })
          }
        >
          {signedIn
            ? 'Sign out of research tools'
            : 'Sign in to research tools'}
        </button>
      </div>
      {scan && (
        <section>
          <h3>Full-board screening</h3>
          <p>
            <strong>
              {scan.candidatesScreened.toLocaleString()} candidates screened
            </strong>{' '}
            · {scan.researchPassCount} qualifying · {scan.returnedRows} rows
            displayed · offset {scan.offset}. Snapshot {scan.generatedAt}.
          </p>
          <div className="setupTable">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Market</th>
                  <th>Selection</th>
                  <th>Line</th>
                </tr>
              </thead>
              <tbody>
                {scan.edges.map((r) => (
                  <tr key={r.id}>
                    <td>{r.player}</td>
                    <td>{r.marketLabel}</td>
                    <td>{r.side}</td>
                    <td>{r.line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || scan.offset === 0}
            onClick={() => run(() => loadBoard(Math.max(0, scan.offset - 150)))}
          >
            Previous prop page
          </button>{' '}
          <button
            disabled={busy || scan.nextOffset === null}
            onClick={() => run(() => loadBoard(scan.nextOffset!))}
          >
            Next prop page
          </button>
        </section>
      )}
      <CaesarsFeed />
      <section>
        <h3>Cross-book prop references</h3>
        <p>
          Signed-in requests use the configured Parlay credential and may
          consume provider credits. Each request is capped at 1,000 source rows
          and cached for 60 seconds. Exact periods, lines, identities and
          settlement rules stay separate. SharpAPI currently has no verified
          prop adapter here.
        </p>
        <button
          disabled={busy || !signedIn}
          onClick={() => run(() => loadReferences())}
        >
          Load sportsbook prop references
        </button>
        {!signedIn && (
          <p>
            Sign in required for provider-credit requests and model evaluation.
            Public scans remain available.
          </p>
        )}
        {refs && (
          <>
            <p>
              <strong>{refs.status}</strong> · {refs.rowsLoaded ?? 0} source
              rows · {refs.referenceBookCount ?? 0} sportsbooks. All comparisons
              are SCREEN ONLY; probability and EV unavailable.
              {refs.partialBoard ? ' Provider page incomplete; use Next sportsbook reference page.' : ''}
            </p>
            {refs.diagnostics && (
              <>
                <p><strong>Provider field-quality audit</strong> — counts are per row and may overlap. Even technically comparable quotes do not validate a predictive model or guarantee account availability.</p>
                <div className="coverageGrid">
                  <div><span>Rows with required fields</span><strong>{refs.diagnostics.technicallyComparableRows}/{refs.diagnostics.rows}</strong></div>
                  <div><span>Missing event ID</span><strong>{refs.diagnostics.missingCanonicalEventId}</strong></div>
                  <div><span>Missing player ID</span><strong>{refs.diagnostics.missingCanonicalPlayerId}</strong></div>
                  <div><span>Missing period</span><strong>{refs.diagnostics.missingPeriod}</strong></div>
                  <div><span>Missing settlement rules</span><strong>{refs.diagnostics.missingSettlementRules}</strong></div>
                  <div><span>Old/unknown timestamp</span><strong>{refs.diagnostics.unknownOrOldTimestamp}</strong></div>
                  <div><span>Future timestamp</span><strong>{refs.diagnostics.futureTimestamp}</strong></div>
                  <div><span>Inactive/unknown status</span><strong>{refs.diagnostics.inactiveOrUnknownStatus}</strong></div>
                  <div><span>One-sided/missing prices</span><strong>{refs.diagnostics.incompleteTwoWayPrice}</strong></div>
                </div>
              </>
            )}
            <div className="setupTable">
              <table>
                <thead>
                  <tr>
                    <th>Player / event</th>
                    <th>Exact market</th>
                    <th>Observed quotes</th>
                    <th>Verified best price</th>
                  </tr>
                </thead>
                <tbody>
                  {refs.comparisons.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.player}
                        <small>{r.event}</small>
                      </td>
                      <td>
                        {r.market} {r.selection} {r.line} · {r.period}
                      </td>
                      <td>
                        {r.quotes.map((q) => (
                          <small key={q.book}>
                            {q.book}: {q.decimalOdds.toFixed(3)} ·{' '}
                            {q.oddsAt ?? 'timestamp unknown'} ·{' '}
                            {q.fresh ? 'fresh' : 'stale/unknown'}
                          </small>
                        ))}
                      </td>
                      <td>
                        {r.bestVerifiedPrice
                          ? `${r.bestVerifiedPrice.book} ${r.bestVerifiedPrice.decimalOdds.toFixed(3)}; availability unknown`
                          : 'Withheld: identity, rules or freshness unverified'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              disabled={busy || refs.nextOffset == null}
              onClick={() => run(() => loadReferences(refs.nextOffset!))}
            >
              Next sportsbook reference page
            </button>
          </>
        )}
      </section>
      <section>
        <h3>Independent model evaluation</h3>
        <h4>Real-history MLB baseline</h4>
        <p>
          Independent home/away outcome regression using only prior-game run
          margins and win rates. Fixed chronological splits, calibration and
          postseason diagnostics are evaluated on official historical results.
          This is not a live model, prop model or proof of betting
          profitability.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { data } = await api.get('/api/mlb-baseline-report');
              setMlb(data);
              setMessage(
                'MLB evaluation loaded. Live approval and betting EV remain withheld.',
              );
            })
          }
        >
          Load evaluated MLB baseline
        </button>
        {mlb && (
          <>
            <p>
              <strong>{mlb.status}</strong> · live approved:{' '}
              {String(mlb.liveApproved)}
            </p>
            <p>{mlb.scope}</p>
            <p>
              {mlb.splits
                .map((s) => `${s.name} ${s.seasons.join('–')}: ${s.n} games`)
                .join(' · ')}
            </p>
            <div className="setupTable">
              <table>
                <thead>
                  <tr>
                    <th>Held-out results</th>
                    <th>Games</th>
                    <th>Binary Brier</th>
                    <th>Log loss</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Independent MLB model', ...mlb.test },
                    { label: 'Training home-team base rate', ...mlb.baseRate },
                    ...mlb.bySegment.flatMap((s) => [
                      { label: `${s.segment} model`, ...s },
                      { label: `${s.segment} home base rate`, ...s.baseRate },
                      { label: `${s.segment} fair coin`, ...s.fairCoin },
                    ]),
                    ...mlb.bySeason.map((s) => ({
                      label: String(s.season),
                      ...s,
                    })),
                  ].map((m) => (
                    <tr key={m.label}>
                      <td>{m.label}</td>
                      <td>{m.n}</td>
                      <td>{m.brier.toFixed(4)}</td>
                      <td>{m.logLoss.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{mlb.conclusion}</p>
            <p>
              Model minus base-rate log loss, paired week-block 95% interval:{' '}
              {mlb.uncertainty.interval95.map((v) => v.toFixed(4)).join(' to ')}
              . This is uncertainty in aggregate model performance, not a
              probability interval for today's wager.
            </p>
            <ul>
              {mlb.promotionBlockers.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <details>
              <summary>MLB replay assumptions and source snapshots</summary>
              <ul>
                {mlb.replayAssumptions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <ul>
                {mlb.source.snapshots.map((s) => (
                  <li key={s.season}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      Official {s.season} final results
                    </a>{' '}
                    · SHA-256 {s.sha256}
                  </li>
                ))}
              </ul>
            </details>
            <button
              onClick={() =>
                download('mlb-independent-baseline-report.json', mlb)
              }
            >
              Download real-history MLB report
            </button>
          </>
        )}
        <h4>Real-history NFL baseline</h4>
        <p>
          A fitted independent game-outcome model is now evaluated on nflverse
          historical results. It models away wins, ties and home wins using
          prior-game statistics, without using odds as features. It remains a
          retrospective baseline; sportsbook EV and live approval are withheld.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { data } = await api.get('/api/nfl-baseline-report');
              setBaseline(data);
              setMessage(
                'Real-history NFL evaluation loaded. Predictive improvement does not establish sportsbook positive EV.',
              );
            })
          }
        >
          Load evaluated NFL baseline
        </button>
        {baseline && (
          <>
            <p>
              <strong>{baseline.status}</strong> · {baseline.scope} · live
              approved: {String(baseline.liveApproved)}
            </p>
            <p>
              {baseline.splits
                .map(
                  (s) =>
                    `${s.name} ${s.seasons.join('–')}: ${s.n} games, ${s.ties} ties`,
                )
                .join(' · ')}
            </p>
            <div className="setupTable">
              <table>
                <thead>
                  <tr>
                    <th>Held-out results</th>
                    <th>Games</th>
                    <th>Multiclass Brier</th>
                    <th>Log loss</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Independent NFL model', baseline.test],
                    ['Training base-rate model', baseline.baseRate],
                  ].map(([label, value]) => {
                    const m = value as Metric;
                    return (
                      <tr key={String(label)}>
                        <td>{String(label)}</td>
                        <td>{m.n}</td>
                        <td>{m.brier.toFixed(4)}</td>
                        <td>{m.logLoss.toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              {baseline.conclusion} Paired week-block bootstrap log-loss
              difference, 95% interval:{' '}
              {baseline.uncertainty.interval95
                .map((v) => v.toFixed(4))
                .join(' to ')}
              .
            </p>
            <p>
              {baseline.brierDefinition} The downloadable report includes an
              untimestamped archived market benchmark. It does not establish
              executable EV or wagering returns; the candidate was inferior to
              that benchmark.
            </p>
            <ul>
              {baseline.promotionBlockers.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <details>
              <summary>Replay assumptions and provenance</summary>
              <ul>
                {baseline.replayAssumptions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p>
                Source:{' '}
                <a href={baseline.source.url} target="_blank" rel="noreferrer">
                  pinned nflverse games data
                </a>
                . Commit {baseline.source.commit}. Retrieved{' '}
                {baseline.source.downloadedAt}.
              </p>
            </details>
            <button
              onClick={() =>
                download('nfl-independent-baseline-report.json', baseline)
              }
            >
              Download real-history NFL report
            </button>
          </>
        )}
        <h4>Evaluate additional historical models</h4>
        <p>
          Import 300–5,000 settled historical samples from at least 150 events,
          for one preregistered sport/market. Regularized logistic regression
          uses independent features; chronological event-grouped splits keep
          test data out of fitting and model selection. Market odds are
          comparison baselines only.
        </p>
        <p>
          Train 60% / validation 20% / held-out test 20% by event. Future
          features, quotes, overlapping events, late labels and missing
          settlement fields are rejected. This binary candidate does not model
          pushes, partial settlements, prop count distributions or joint wagers.
        </p>
        <div className="setupActions">
          <button
            onClick={() => download('historical-model-schema.json', schema)}
          >
            Download historical schema
          </button>
          <label>
            Historical JSON{' '}
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Historical model dataset"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
              }}
            />
          </label>
          <button disabled={busy || !signedIn} onClick={() => run(evaluate)}>
            Train and evaluate candidate
          </button>
        </div>
        <p>
          Live model: <strong>NOT APPROVED</strong>. Imports are processed for
          this request, not stored. Training does not itself verify data
          provenance or profitability.
        </p>
        {report && (
          <>
            <h4>
              {report.status} · live approval {String(report.liveApproved)}
            </h4>
            <p>
              {report.splits
                .map(
                  (s) => `${s.name}: ${s.samples} samples / ${s.events} events`,
                )
                .join(' · ')}
            </p>
            <div className="setupTable">
              <table>
                <thead>
                  <tr>
                    <th>Held-out comparison</th>
                    <th>N</th>
                    <th>Brier</th>
                    <th>Log loss</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Independent candidate', report.test],
                    ['Training base rate', report.baseRate],
                    [
                      'Matched proportional no-vig market',
                      report.marketBenchmark,
                    ],
                  ].map(([label, metric]) => {
                    const m = metric as Metric;
                    return (
                      <tr key={String(label)}>
                        <td>{String(label)}</td>
                        <td>{m.n}</td>
                        <td>{m.brier.toFixed(4)}</td>
                        <td>{m.logLoss.toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              {report.conclusion} Paired event-bootstrap log-loss difference 95%
              interval:{' '}
              {report.uncertainty.interval95
                .map((n) => n.toFixed(4))
                .join(' to ')}
              .
            </p>
            <p>
              Historical simulation: {report.returns.selected} selections · ROI{' '}
              {report.returns.roi === null
                ? 'unavailable'
                : `${(100 * report.returns.roi).toFixed(2)}%`}
              . This is not actual wagering performance.
            </p>
            {report.returns.selectionPolicy && (
              <p>
                Replay policy: {report.returns.selectionPolicy}.{' '}
                {report.returns.excludedRepeatedEventObservations ?? 0} repeated
                qualifying observations excluded. This simulation does not
                establish profitable account fills.
              </p>
            )}
            <ul>
              {report.promotionBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <button
              onClick={() =>
                download('independent-model-evaluation.json', report)
              }
            >
              Download evaluation report
            </button>
          </>
        )}
      </section>
      {busy && <p role="status">Processing research request…</p>}
      {message && (
        <p role="status" className="setupMessage">
          {message}
        </p>
      )}
    </details>
  );
}
