import { useEffect, useRef, useState } from 'react';
import { api } from '../../../runtime/client.ts';
import type { createSgoOwnerSession } from '../shared/sgoOwner';
import { parseReceivingEvaluation, type ReceivingEvaluationReport } from '../shared/receivingEvaluationReport';

export default function ReceivingForwardEvaluation({ owner, session }: {
  owner: string | null;
  session: ReturnType<typeof createSgoOwnerSession>;
}) {
  const [report, setReport] = useState<ReceivingEvaluationReport | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<{report:ReceivingEvaluationReport;url:string} | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    generation.current++;
    setReport(null); setMessage(''); setBusy(false);
  }, [owner]);
  useEffect(() => {
    if (!report) { setDownload(null); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    setDownload({report,url});
    return () => URL.revokeObjectURL(url);
  }, [report]);

  async function evaluate(nextToken?: string, finalGameOffset = 0) {
    const current = ++generation.current;
    setBusy(true); setMessage(''); setReport(null);
    try {
      const ticket = await session.capture();
      if (current !== generation.current || ticket.owner !== owner) return;
      const { data } = await api.post('/api/receiving-forward-evaluation?owner='+encodeURIComponent(ticket.owner),{...(nextToken ? {nextToken} : {}),finalGameOffset});
      if (current !== generation.current || !await session.accepts(ticket,data?.owner) || current !== generation.current) return;
      setReport(parseReceivingEvaluation(data,ticket.owner));
    } catch (error) {
      if (current === generation.current) setMessage(error instanceof Error ? error.message : 'Evaluation unavailable. Retry; no saved forecast was changed.');
    } finally { if (current === generation.current) setBusy(false); }
  }

  const pending = report?.rows.filter(row => row.status === 'UNRESOLVED' && row.reason === 'GAME_NOT_STARTED') ?? [];
  const nextKickoff = pending.length ? Math.min(...pending.map(row => Date.parse(row.kickoffAt!))) : null;

  return <section className="correctedScoreReceipt" aria-busy={busy}>
    <h3>Evaluate saved forecasts · read only</h3>
    <p>Compare saved pregame probabilities with exact published player outcomes. A final game must be confirmed separately. Missing or ambiguous outcomes remain unresolved, never losses.</p>
    <p>Runs only when requested: at most 200 saved records and eight final-game checks per batch. Uses public sources and no sportsbook provider credits. This does not change receipts or approve wagers. Rerun after saving more forecasts or new outcomes are published.</p>
    <button type="button" className="scanButton" disabled={!owner || busy} onClick={() => evaluate()}>
      {busy ? 'Evaluating published outcomes…' : 'Evaluate saved forecasts'}
    </button>
    {!owner && <p>Sign in above to evaluate your private log.</p>}
    {message && <p role="alert">{message}</p>}
    {report && <div>
      <p role="status">{report.scoredCount > 0 ? 'Descriptive probability scores available.' : pending.length > 0 ? 'Saved forecasts are awaiting their games.' : report.recordsIncluded === 0 ? 'No saved forecasts in this batch.' : 'No scorable outcomes yet.'} Betting decision: HOLD.</p>
      {pending.length > 0 && nextKickoff !== null && <p>{pending.length} saved {pending.length === 1 ? 'forecast was' : 'forecasts were'} awaiting kickoff at this evaluation. Next scheduled kickoff: <time dateTime={new Date(nextKickoff).toISOString()}>{new Date(nextKickoff).toUTCString()}</time>. Evaluate again after the game finishes and player results are published. Waiting forecasts stay unresolved and do not count as losses.</p>}
      <p>Included: {report.recordsIncluded} · Scored: {report.scoredCount} · Unresolved: {report.unresolvedCount} · Unique scored games: {report.uniqueScoredGames}.</p>
      <p>{report.cohortComplete ? 'All archive pages returned by this evaluation were included.' : 'Partial archive batch: these scores do not describe the entire saved log.'}</p>
      <p>Final-game checks are capped at eight; unchecked games remain unresolved even if other games were scored. This manually selected sample is not an exhaustive player cohort.</p>
      <div style={{overflowX:'auto'}}>
        <table><caption>Same-outcome probability comparison · lower scores are better</caption><thead><tr><th scope="col">Variant</th><th scope="col">n</th><th scope="col">Brier</th><th scope="col">Log loss</th></tr></thead>
          <tbody>{(['selected','raw','trainBaseRate'] as const).map(variant => {
            const metric = report.scores[variant];
            return <tr key={variant}><th scope="row">{variant === 'trainBaseRate' ? 'Frozen training base rate' : variant === 'raw' ? 'Raw model' : 'Selected model'}</th><td>{metric?.n ?? 0}</td><td>{metric ? metric.brier.toFixed(4) : 'Unavailable'}</td><td>{metric ? metric.logLoss.toFixed(4) : 'Unavailable'}</td></tr>;
          })}</tbody></table>
      </div>
      <p>These are proper probability scores, not betting returns or proof of profitability. No confidence interval or model promotion is inferred.</p>
      <p>{report.source.status === 'NOT_REQUESTED' ? 'Public outcome sources were not requested' : 'Outcome source: '+report.source.status.replaceAll('_',' ')} · evaluation checked {new Date(report.source.retrievedAt).toLocaleString()}{report.source.reason ? ' · '+report.source.reason.replaceAll('_',' ') : ''}.</p>
      {download?.report === report && <a href={download.url} download="receiving-forward-evaluation.json">Download evaluation evidence</a>}
      {report.source.finalGameWindow?.nextOffset !== null && report.source.finalGameWindow?.nextOffset !== undefined &&
        <button type="button" disabled={busy} onClick={() => evaluate(report.historyRange.startToken ?? undefined,report.source.finalGameWindow!.nextOffset!)}>Check next set of final games</button>}
      {report.historyRange.nextToken && <button type="button" disabled={busy} onClick={() => evaluate(report.historyRange.nextToken!)}>Evaluate next archive batch</button>}
      <details><summary>Outcome matches, unresolved reasons and source evidence</summary>
        <ul>{report.rows.map((row,index) => <li key={row.receiptId+'|'+index}>{row.playerId ?? 'Unknown player'} · {row.gameId ?? 'Unknown game'}: {row.status === 'SCORED' ? `${row.receivingYards} receiving yards; ${row.outcome ? '60+ reached' : 'below 60'}` : 'Unresolved — '+row.reason.replaceAll('_',' ')}</li>)}</ul>
        <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:260,overflow:'auto'}}>{JSON.stringify({protocolSha256:report.protocolSha256,source:report.source,historyRange:report.historyRange,limitations:report.limitations},null,2)}</pre>
      </details>
    </div>}
  </section>;
}
