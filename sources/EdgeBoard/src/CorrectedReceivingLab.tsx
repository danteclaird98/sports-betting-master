import { useEffect, useState } from 'react';
import { api } from '@appdeploy/client';

type Metric = { n: number; brier: number; log_loss: number };
type ResearchState = {
  status: string;
  liveApproved: boolean;
  verifiedPositiveEv: boolean;
  productionEnabled: boolean;
  executionEnabled: boolean;
  artifactSha256: string;
  artifactAvailableAt: string;
  reason: string;
};
type Readiness = ResearchState & {
  artifactVerified: boolean;
  independentOfOdds: boolean;
  untouchedHoldout: boolean;
};
type FrozenReport = ResearchState & {
  report: null | {
    counts: Record<string, number>;
    exclusions: { insufficient_prior_rows: number };
    negative_yard_rows_retained: number;
    partition_metrics: {
      consumed_diagnostic: {
        p_raw: Metric;
        p_calibrated: Metric;
        train_base_rate: Metric;
      };
    };
  };
};
type Receipt = ResearchState & {
  probability: number | null;
  eligibilityVerified?: boolean;
};

const sourceUrl = 'https://github.com/nflverse/nflverse-data/releases/tag/stats_player';
const message = (error: unknown) => error instanceof Error ? error.message : 'Model unavailable. HOLD remains in place.';
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isResearchState(value: unknown): value is ResearchState & Record<string, unknown> {
  return object(value) && value.status === 'HOLD' && value.liveApproved === false
    && value.verifiedPositiveEv === false && value.productionEnabled === false
    && value.executionEnabled === false && typeof value.reason === 'string'
    && typeof value.artifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.artifactSha256)
    && typeof value.artifactAvailableAt === 'string' && Number.isFinite(Date.parse(value.artifactAvailableAt));
}

function validMetric(value: unknown): value is Metric {
  return object(value) && count(value.n) && finite(value.brier) && value.brier >= 0
    && value.brier <= 1 && finite(value.log_loss) && value.log_loss >= 0;
}

function validInspection(readiness: unknown, report: unknown): readiness is Readiness {
  if (!isResearchState(readiness) || !isResearchState(report) || !object(readiness)
    || readiness.artifactVerified !== true || readiness.independentOfOdds !== true
    || readiness.untouchedHoldout !== false || readiness.artifactSha256 !== report.artifactSha256
    || readiness.artifactAvailableAt !== report.artifactAvailableAt || !object(report)
    || !object(report.report)) return false;
  const details = report.report;
  const counts = details.counts;
  if (!object(counts) || !['train', 'selection', 'calibration', 'consumed_diagnostic'].every(key => count(counts[key]))
    || !object(details.exclusions) || !count(details.exclusions.insufficient_prior_rows)
    || !count(details.negative_yard_rows_retained) || !object(details.partition_metrics)
    || !object(details.partition_metrics.consumed_diagnostic)) return false;
  const diagnostic = details.partition_metrics.consumed_diagnostic;
  return ['p_raw', 'p_calibrated', 'train_base_rate'].every(key => {
    const metric = diagnostic[key];
    return validMetric(metric) && metric.n === counts.consumed_diagnostic;
  });
}

export default function CorrectedReceivingLab() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [report, setReport] = useState<FrozenReport | null>(null);
  const [input, setInput] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inspectionFailed, setInspectionFailed] = useState(false);
  const [auditUrl, setAuditUrl] = useState<string | null>(null);
  const artifactVerified = readiness?.artifactVerified === true && report?.report !== null && report !== null;

  useEffect(() => {
    if (!artifactVerified || !readiness || !report) {
      setAuditUrl(null);
      return;
    }
    const audit = {
      exportedAt: new Date().toISOString(),
      sourceProvenance: sourceUrl,
      readiness,
      frozenReport: report,
      scoreReceipt: receipt,
      note: 'Research only. Supplied history is unverified. No EV or live approval.',
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' }));
    setAuditUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artifactVerified, readiness, report, receipt]);

  async function inspect() {
    setBusy(true);
    setError('');
    setReadiness(null);
    setReport(null);
    setReceipt(null);
    setInspectionFailed(false);
    try {
      const [readyResponse, reportResponse] = await Promise.all([
        api.get('/api/corrected-receiving-readiness'),
        api.get('/api/corrected-receiving-report'),
      ]);
      if (!validInspection(readyResponse.data, reportResponse.data)) {
        throw new Error('Model integrity or response verification failed. No report or forecast is available.');
      }
      setReadiness(readyResponse.data);
      setReport(reportResponse.data as FrozenReport);
    } catch (error) {
      setInspectionFailed(true);
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function score() {
    setReceipt(null);
    setError('');
    if (!artifactVerified) {
      setError('Inspect and verify the frozen model before calculating a research probability.');
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(input);
    } catch {
      setError('Enter valid history JSON. No probability was calculated.');
      return;
    }
    setBusy(true);
    try {
      const response = await api.post('/api/corrected-receiving-score', body);
      const result: unknown = response.data;
      if (object(result) && result.reason === 'ARTIFACT_INTEGRITY_FAILURE') {
        setReadiness(null);
        setReport(null);
        setInspectionFailed(true);
        throw new Error('Model integrity verification failed. No probability is available.');
      }
      if (!isResearchState(result) || !object(result) || result.artifactSha256 !== readiness?.artifactSha256
        || result.artifactAvailableAt !== readiness.artifactAvailableAt
        || !(result.probability === null || (finite(result.probability) && result.probability >= 0 && result.probability <= 1))) {
        throw new Error('Unverified model response. No probability is available.');
      }
      setReceipt(result as Receipt);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  const details = report?.report;
  const diagnostic = details?.partition_metrics.consumed_diagnostic;
  const scoredRows = details
    ? details.counts.train + details.counts.selection + details.counts.calibration + details.counts.consumed_diagnostic
    : 0;
  const warmupRows = details?.exclusions.insufficient_prior_rows ?? 0;
  const metricRows: [string, Metric][] = diagnostic ? [
    ['Training base rate', diagnostic.train_base_rate],
    ['Raw logistic', diagnostic.p_raw],
    ['Platt calibrated', diagnostic.p_calibrated],
  ] : [];

  return (
    <section className="panel lab correctedReceivingPanel" id="corrected-receiving-model" aria-busy={busy}>
      <div className="correctedModelHeading">
        <h2>Corrected receiving 60+ model</h2>
        <span className="correctedHold">Research only · HOLD</span>
      </div>
      <p>Fixed full-game NFL receiving yards ≥60 for recorded WR/RB/TE games. Valid negative-yard outcomes remain in training and history. This does not validate other lines, live markets or betting EV.</p>
      <div className="correctedModelActions">
        <button className="scanButton" type="button" disabled={busy} onClick={inspect}>
          {busy ? 'Working…' : 'Inspect frozen receiving model'}
        </button>
        {auditUrl && artifactVerified && <a className="correctedAuditDownload" href={auditUrl} download="edgeboard-receiving60-audit.json">Download audit JSON</a>}
      </div>
      <div className={`correctedIntegrity ${artifactVerified ? 'verified' : ''}`} role="status">
        <strong>Artifact integrity: {artifactVerified ? 'verified by backend' : inspectionFailed ? 'unavailable — verification failed' : busy ? 'checking' : 'not checked'}</strong>
        <span>{artifactVerified ? 'Artifact verified does not mean live approved. Forward validation is required; HOLD remains in place.' : 'Inspect the artifact before viewing metrics or calculating a probability.'}</span>
      </div>
      {error && <p role="alert" className="correctedModelError">{error}</p>}
      {details && artifactVerified && (
        <div>
          <dl className="correctedCohortMetrics">
            <div><dt>Eligible recorded games</dt><dd>{(scoredRows + warmupRows).toLocaleString()}</dd></div>
            <div><dt>Scored after warmup</dt><dd>{scoredRows.toLocaleString()}</dd></div>
            <div><dt>History warmup</dt><dd>{warmupRows.toLocaleString()}</dd></div>
            <div><dt>Negative-yard rows retained</dt><dd>{details.negative_yard_rows_retained.toLocaleString()}</dd></div>
          </dl>
          <p>Train: {details.counts.train.toLocaleString()} · selection: {details.counts.selection.toLocaleString()} · calibration: {details.counts.calibration.toLocaleString()} · reused 2025 diagnostic: {details.counts.consumed_diagnostic.toLocaleString()}.</p>
          <p>The old 2,777-row difference came from history warmup after the old negative-yard exclusion. The corrected cohort retains all {details.negative_yard_rows_retained} negative-yard records and has {warmupRows.toLocaleString()} warmup rows.</p>
          <div className="correctedTableScroll">
            <table>
              <caption>Reused 2025 diagnostic — lower losses are better</caption>
              <thead><tr><th scope="col">Model</th><th scope="col">Brier</th><th scope="col">Log loss</th></tr></thead>
              <tbody>{metricRows.map(([label, metric]) => (
                <tr key={label}><th scope="row">{label}</th><td>{metric.brier.toFixed(6)}</td><td>{metric.log_loss.toFixed(6)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="correctedCaution">Calibration worsens both 2025 diagnostic losses. Its choice was made using late 2024 and was not changed after inspecting 2025. Calibration selection is in sample; independent forward validation remains required.</p>
          <details>
            <summary>Artifact and cohort audit</summary>
            <p>Available from {report.artifactAvailableAt}. Artifact SHA-256: <code>{report.artifactSha256}</code>.</p>
            <p>Historical source: <a href={sourceUrl} target="_blank" rel="noopener noreferrer">nflverse player-stat releases</a>. Revised historical files do not establish original publication times. Recorded-player games do not establish participation or void settlement.</p>
            <p>The audit download contains the loaded backend readiness, frozen report and latest score receipt. History JSON is excluded; score receipts can contain supplied player/game identifiers and derived features.</p>
          </details>
        </div>
      )}
      <details>
        <summary>Score supplied player history — research only</summary>
        <p>Supply documented prior games and UTC observation clocks. Inputs are unverified; a returned probability remains a conditional research calculation, never a recommendation.</p>
        <p>The JSON object must contain request and history. Request requires playerId, gameId, kickoffAt, decisionAt, league NFL, position WR/RB/TE, seasonType REG, period FULL_GAME, stat receiving_yards, threshold 60 and comparison &gt;=. Each history record requires playerId, gameId, kickoffAt, resolvedAt, observedAt and receivingYards. At least three prior games are required.</p>
        <label htmlFor="receiving-history-json">Documented history JSON</label>
        <textarea
          id="receiving-history-json"
          rows={8}
          value={input}
          disabled={busy}
          maxLength={150000}
          className="correctedHistoryInput"
          onChange={event => { setInput(event.target.value); setReceipt(null); setError(''); }}
        />
        {!artifactVerified && <p>Inspect and verify the frozen model to enable calculation.</p>}
        <button className="scanButton" type="button" disabled={busy || !artifactVerified || !input.trim()} onClick={score}>Calculate research probability</button>
        {receipt && (
          <div className="correctedScoreReceipt" role="status">
            <p><strong>HOLD</strong> — {receipt.probability === null ? 'No probability: ' : `Conditional research probability ${(receipt.probability * 100).toFixed(2)}%: `}{receipt.reason}.</p>
            <p>History and player eligibility are not independently verified. No EV or live approval.</p>
          </div>
        )}
      </details>
    </section>
  );
}
