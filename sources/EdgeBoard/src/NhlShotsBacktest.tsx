import { useState } from 'react';
import { api } from '@appdeploy/client';
type Stats = {n:number;brier:number;logLoss:number;ece:number;outcomeRate:number;meanPredicted:number;
  reliability:Array<{bin:number;n:number;predicted:number;observed:number}>};
type Market = {line:string;splits:{train:number;validation:number;heldOutTest:number};selectedRegularization:number;
  test:Stats;validation:Stats;benchmarks:{rollingPriorHitRate:Stats;constantTrainingRate:Stats};
  brierImprovementVsRolling:number;improvement95Bootstrap:[number,number];clearBaselineWith95Confidence:boolean};
type Report = {status:string;recommendation:string;liveApproved:boolean;verifiedPositiveEv:boolean;
  source:{provider:string;gameRows:number;players:number;rejectedRows:number;fetchedAt:string;urls:string[]};
  design:string;markets:Market[];blockingIssues:string[]};
const f=(n:number)=>n.toFixed(4);
export default function NhlShotsBacktest() {
  const [data,setData]=useState<Report|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function run() {
    setBusy(true);setError('');
    try {const r=await api.get('/api/nhl-shots-backtest');setData(r.data as Report);}
    catch(e) {setData(null);setError(e instanceof Error?e.message:'NHL official data unavailable');}
    finally {setBusy(false);}
  }
  return <section className='panel lab' id='nhl-shots-backtest'>
    <h2>NHL shots on goal · historical test</h2>
    <p>Official NHL per-game boxscores for Dallas and Colorado, 2022–2026. Train on 2022–24, tune on 2024–25, then test on unseen 2025–26 results. This is a restricted-sample model development experiment, not a live betting signal.</p>
    <button type='button' className='scanButton' disabled={busy} onClick={run}>
      {busy?'Loading official games and testing…':'Run official-history NHL shots backtest'}
    </button>
    {error&&<p role='alert'>NHL test unavailable: {error}. Live recommendations remain blocked.</p>}
    {data&&<div>
      <p role='status'><strong>{data.status} · HOLD</strong>. Live approved: No. Verified positive EV: No.</p>
      <p>Source: {data.source.provider}. {data.source.gameRows.toLocaleString()} valid player-game rows for {data.source.players} skaters; {data.source.rejectedRows} rejected. Retrieved: {data.source.fetchedAt}.</p>
      <p>{data.design}</p>
      {data.markets.map(m=><div key={m.line}>
        <h3>{m.line}</h3>
        <p>Training / validation / untouched test: {m.splits.train} / {m.splits.validation} / {m.splits.heldOutTest}.</p>
        <table style={{width:'100%',textAlign:'left'}}>
          <thead><tr><th>Held-out 2025–26</th><th>Brier (lower better)</th><th>Log loss</th><th>ECE</th></tr></thead>
          <tbody>
            <tr><td>Logistic model</td><td>{f(m.test.brier)}</td><td>{f(m.test.logLoss)}</td><td>{f(m.test.ece)}</td></tr>
            <tr><td>Rolling historical rate</td><td>{f(m.benchmarks.rollingPriorHitRate.brier)}</td><td>{f(m.benchmarks.rollingPriorHitRate.logLoss)}</td><td>{f(m.benchmarks.rollingPriorHitRate.ece)}</td></tr>
            <tr><td>Train-set base rate</td><td>{f(m.benchmarks.constantTrainingRate.brier)}</td><td>{f(m.benchmarks.constantTrainingRate.logLoss)}</td><td>{f(m.benchmarks.constantTrainingRate.ece)}</td></tr>
          </tbody>
        </table>
        <p>Model Brier improvement against rolling baseline: {f(m.brierImprovementVsRolling)}; event-bootstrap 95% interval [{f(m.improvement95Bootstrap[0])}, {f(m.improvement95Bootstrap[1])}]. {m.clearBaselineWith95Confidence?'Positive interval, but sportsbook performance is still unverified.':'No conclusive improvement versus the rolling baseline.'}</p>
        <details><summary>Held-out calibration bins</summary><table style={{width:'100%',textAlign:'left'}}>
          <thead><tr><th>Predicted bin</th><th>N</th><th>Forecast</th><th>Actual</th></tr></thead>
          <tbody>{m.test.reliability.map(b=><tr key={b.bin}><td>{b.bin*10}–{b.bin*10+10}%</td><td>{b.n}</td><td>{(100*b.predicted).toFixed(1)}%</td><td>{(100*b.observed).toFixed(1)}%</td></tr>)}</tbody></table></details>
      </div>)}
      <h3>Why this cannot approve a live wager</h3>
      <ul>{data.blockingIssues.map(reason=><li key={reason}>{reason}</li>)}</ul>
      <details><summary>Official source URLs</summary><ul>{data.source.urls.map(url=><li key={url}><a href={url} target='_blank' rel='noreferrer'>NHL team-season game stats</a></li>)}</ul></details>
    </div>}
  </section>;
}