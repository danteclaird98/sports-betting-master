import { useState } from 'react';
import { api } from '../../../runtime/client.ts';

type Metric = { n: number; brier: number; log_loss: number };
type FrozenReport = { artifactSha256: string; artifactAvailableAt: string; reason: string;
  report: null | { counts: Record<string, number>; negative_yard_rows_retained: number;
    partition_metrics: { consumed_diagnostic: { p_raw: Metric; p_calibrated: Metric; train_base_rate: Metric } } } };
type Receipt = { probability: number | null; reason: string; status: string; eligibilityVerified?: boolean; artifactSha256: string };
const message = (e: unknown) => e instanceof Error ? e.message : 'Model unavailable. HOLD remains in place.';

export default function CorrectedReceivingLab() {
  const [report, setReport] = useState<FrozenReport | null>(null);
  const [input, setInput] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function inspect() {
    setBusy(true); setError(''); setReport(null);
    try { setReport((await api.get('/api/corrected-receiving-report')).data as FrozenReport); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function score() {
    setReceipt(null); setError('');
    let body: unknown;
    try { body = JSON.parse(input); } catch { setError('Enter valid history JSON. No probability was calculated.'); return; }
    setBusy(true);
    try { setReceipt((await api.post('/api/corrected-receiving-score', body)).data as Receipt); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const diagnostic = report?.report?.partition_metrics.consumed_diagnostic;
  return <section className="panel lab correctedReceivingPanel" id="corrected-receiving-model">
    <h2>Corrected receiving 60+ model</h2>
    <p><strong>Research only · HOLD</strong>. Fixed full-game NFL receiving yards ≥60 for recorded WR/RB/TE games.
      Valid negative-yard outcomes remain in training and history. This does not validate other lines, live markets or betting EV.</p>
    <button className="scanButton" type="button" disabled={busy} onClick={inspect}>Inspect frozen receiving model</button>
    {error && <p role="alert">{error}</p>}
    {report && !report.report && <p role="alert">Model integrity check failed. No report or forecast is available.</p>}
    {report?.report && <div>
      <p>Train: {report.report.counts.train.toLocaleString()} · selection: {report.report.counts.selection.toLocaleString()}
        {' '}· calibration: {report.report.counts.calibration.toLocaleString()} · reused 2025 diagnostic: {report.report.counts.consumed_diagnostic.toLocaleString()}.</p>
      <p>All {report.report.negative_yard_rows_retained} negative-yard records are retained in the raw eligible cohort.
        The old 2,777-row difference came from history warmup after the old negative-yard exclusion; the corrected warmup is 2,780.</p>
      {diagnostic && <div style={{ overflowX: 'auto' }}><table><caption>Reused 2025 diagnostic — lower losses are better</caption>
        <thead><tr><th>Model</th><th>Brier</th><th>Log loss</th></tr></thead>
        <tbody>{[['Training base rate', diagnostic.train_base_rate], ['Raw logistic', diagnostic.p_raw], ['Platt calibrated', diagnostic.p_calibrated]].map(([label, value]) => {
          const m = value as Metric;
          return <tr key={String(label)}><th scope="row">{String(label)}</th><td>{m.brier.toFixed(6)}</td><td>{m.log_loss.toFixed(6)}</td></tr>;
        })}</tbody></table></div>}
      <p>Calibration worsens both 2025 diagnostic losses. Its choice was made using late 2024 and was not changed after inspecting 2025.
        Calibration selection is in sample; independent forward validation remains required.</p>
      <details><summary>Artifact and cohort audit</summary><p>Available from {report.artifactAvailableAt}. Artifact SHA-256: <code style={{ overflowWrap: 'anywhere' }}>{report.artifactSha256}</code>.</p>
        <p>Revised historical files do not establish original publication times. Recorded-player games do not establish participation or void settlement.</p>
      </details>
    </div>}
    <details><summary>Score supplied player history — research only</summary>
      <p>Supply documented prior games and UTC observation clocks. Inputs are unverified; a returned probability remains a conditional research calculation, never a recommendation.</p>
      <p>The JSON object must contain request and history. Request requires playerId, gameId, kickoffAt, decisionAt, league NFL,
        position WR/RB/TE, seasonType REG, period FULL_GAME, stat receiving_yards, threshold 60 and comparison &gt;=.
        Each history record requires playerId, gameId, kickoffAt, resolvedAt, observedAt and receivingYards. At least three prior games are required.</p>
      <label htmlFor="receiving-history-json">Documented history JSON</label>
      <textarea id="receiving-history-json" rows={8} value={input} disabled={busy} maxLength={150000} style={{ width: '100%' }}
        onChange={e => { setInput(e.target.value); setReceipt(null); setError(''); }} />
      <button className="scanButton" type="button" disabled={busy || !input.trim()} onClick={score}>Calculate research probability</button>
      {receipt && <div role="status"><p><strong>HOLD</strong> — {receipt.probability === null ? 'No probability: ' : `Conditional research probability ${(receipt.probability * 100).toFixed(2)}%: `}{receipt.reason}.</p>
        <p>History and player eligibility are not independently verified. No EV or live approval.</p></div>}
    </details>
  </section>;
}
