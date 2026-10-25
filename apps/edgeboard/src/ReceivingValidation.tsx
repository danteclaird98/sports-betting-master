import { useEffect, useRef, useState } from 'react';
import { api } from '../../../runtime/client.ts';

type Metric = { n: number; brier: number; log_loss: number };
type Evaluation = {
  evaluatedAt: string;
  modelVersion: string;
  dataAvailable: boolean;
  prospectiveValidationAvailable: false;
  modelParametersChanged: false;
  selectedCalibrationChanged: false;
  counts: { eligibleRows: number; scoredRows: number; warmupRows: number; scoredGames: number; scoredPlayers: number; weeks: number[]; seasonComplete: boolean };
  metrics: { selected: Metric; raw: Metric; trainBaseRate: Metric };
  source: { url: string; sha256: string; retrievedAt: string };
  limitations: string[];
  nextRequiredEvidence: string[];
};
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
function valid(value: unknown): value is Evaluation {
  if (!object(value) || !object(value.counts) || !object(value.metrics) || !object(value.source)
    || value.dataAvailable !== true || value.prospectiveValidationAvailable !== false
    || value.modelParametersChanged !== false || value.selectedCalibrationChanged !== false
    || typeof value.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(value.evaluatedAt))
    || typeof value.modelVersion !== 'string' || !strings(value.limitations) || !strings(value.nextRequiredEvidence)) return false;
  const counts = value.counts;
  if (!['eligibleRows', 'scoredRows', 'warmupRows', 'scoredGames', 'scoredPlayers'].every(k => count(counts[k]))
    || !Array.isArray(counts.weeks) || !counts.weeks.every(count)
    || typeof counts.seasonComplete !== 'boolean'
    || typeof value.source.url !== 'string' || !value.source.url.startsWith('https://github.com/nflverse/')
    || typeof value.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source.sha256)
    || typeof value.source.retrievedAt !== 'string' || !Number.isFinite(Date.parse(value.source.retrievedAt))) return false;
  const metrics = value.metrics;
  return ['selected', 'raw', 'trainBaseRate'].every(k => {
    const m = metrics[k];
    return object(m) && m.n === counts.scoredRows && finite(m.brier) && m.brier >= 0 && m.brier <= 1
      && finite(m.log_loss) && m.log_loss >= 0;
  });
}

export default function ReceivingValidation() {
  const [report, setReport] = useState<Evaluation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  async function inspect() {
    const current = ++request.current;
    setBusy(true); setError(''); setReport(null);
    try {
      const { data } = await api.get('/api/receiving-validation');
      if (current !== request.current) return;
      if (data?.evidenceStatus !== 'AVAILABLE' || data.modelIntegrityVerified !== true
        || data.bettingDecision !== 'HOLD' || data.liveApproved !== false || data.verifiedPositiveEv !== false
        || data.executionEnabled !== false || !valid(data.evaluation)) {
        throw new Error('2026 validation evidence is unavailable or could not be verified. No approval was granted.');
      }
      setReport(data.evaluation);
    } catch (failure) {
      if (current === request.current) setError(failure instanceof Error ? failure.message : 'Validation evidence unavailable. Try again.');
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  const rows: [string, Metric][] = report ? [
    ['Selected frozen model', report.metrics.selected],
    ['Raw model diagnostic', report.metrics.raw],
    ['Training-base-rate baseline', report.metrics.trainBaseRate],
  ] : [];
  return <section className="panel lab correctedReceivingPanel" aria-busy={busy}>
    <h2>Separate 2026 validation evidence</h2>
    <p>Frozen weights and calibration were tested against a later season without fitting them again. This retrospective check supports model research; live betting approval still requires prospective evidence and an exact executable market.</p>
    <button className="scanButton" type="button" disabled={busy} onClick={inspect}>{busy ? 'Loading evidence…' : 'Inspect 2026 validation'}</button>
    {error && <p role="alert" className="correctedModelError">{error}</p>}
    {report && <>
      <p role="status">Evidence available · {report.counts.scoredRows.toLocaleString()} scored player-games across {report.counts.scoredGames} games and {report.counts.scoredPlayers} players. Weeks {report.counts.weeks.join(', ')}{report.counts.seasonComplete ? '.' : ' · partial season; latest week may be incomplete.'}</p>
      <div className="correctedTableScroll"><table>
        <caption>Frozen 2026 retrospective comparison — lower losses are better</caption>
        <thead><tr><th>Model</th><th>Brier loss</th><th>Log loss</th></tr></thead>
        <tbody>{rows.map(([label, m]) => <tr key={label}><th scope="row">{label}</th><td>{m.brier.toFixed(6)}</td><td>{m.log_loss.toFixed(6)}</td></tr>)}</tbody>
      </table></div>
      <p>The selected calibration was preserved. Raw results are diagnostic comparisons, not a replacement chosen after seeing 2026.</p>
      <details><summary>Evidence and remaining approval requirements</summary>
        <p>Model {report.modelVersion}. Evaluation completed {new Date(report.evaluatedAt).toLocaleString()}.</p>
        <p><a href={report.source.url} target="_blank" rel="noopener noreferrer">Official 2026 nflverse source</a> retrieved {new Date(report.source.retrievedAt).toLocaleString()}. SHA-256: <code>{report.source.sha256}</code>.</p>
        <ul>{report.limitations.map(x => <li key={x}>{x}</li>)}</ul>
        <h3>Needed before betting approval</h3><ul>{report.nextRequiredEvidence.map(x => <li key={x}>{x}</li>)}</ul>
      </details>
    </>}
  </section>;
}
