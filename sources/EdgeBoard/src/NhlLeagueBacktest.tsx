import { useState } from 'react';
import { api } from '@appdeploy/client';

type Scores = { n:number;brier:number;logLoss:number;ece:number };
type LineReport = {
  line:string;splits:{train:number;validation:number;heldOutTest:number;trainingRowsUsed?:number};
  test:Scores;benchmarks:{rollingPriorHitRate:Scores;constantTrainingRate:Scores};
  brierImprovementVsRolling:number;improvement95Bootstrap:[number,number];
  clearBaselineWith95Confidence:boolean;
};
type Report = {
  status:string;liveApproved:boolean;verifiedPositiveEv:boolean;recommendation:string;design:string;
  source:{gameRows:number;uniquePlayers:number;gameCount:number;months:number;rejectedRows:number;
    fetchedAt:string;seasonTeamCoverage:Record<string,number>;completeMonthlyCountsVerified:boolean};
  markets:LineReport[];blockers:string[];
};
const fixed=(n:number)=>Number.isFinite(n)?n.toFixed(4):'—';
export default function NhlLeagueBacktest() {
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  async function run() {
    setLoading(true);setError('');setReport(null);
    try { const res=await api.get('/api/nhl-league-backtest');setReport(res.data as Report); }
    catch(e) {setError(e instanceof Error?e.message:'NHL source unavailable');}
    finally {setLoading(false);}
  }
  return <section className='panel lab' id='nhl-league-backtest'>
    <h2>All 32 NHL teams · shots-on-goal validation</h2>
    <p>Full-league extension of the two-team pilot. NHL official monthly game logs are checked against reported row counts to avoid the 10,000-row API cap. No current wager or live EV is generated.</p>
    <button className='scanButton' type='button' disabled={loading} onClick={run}>
      {loading?'Fetching all NHL historical seasons…':'Run 32-team held-out test'}
    </button>
    {error&&<p role='alert'>League-wide evaluation unavailable: {error}. HOLD; no betting approval.</p>}
    {report&&<div>
      <p role='status'><strong>{report.status} · {report.recommendation}</strong> · Live approved: No · Verified positive EV: No</p>
      <p>Official source: {report.source.gameRows.toLocaleString()} player-game rows, {report.source.uniquePlayers} skaters, {report.source.gameCount.toLocaleString()} games, {report.source.months} verified date partitions, {report.source.rejectedRows} rejected rows. Loaded {report.source.fetchedAt}.</p>
      <p>Team coverage by season: {Object.entries(report.source.seasonTeamCoverage).map(([season,count])=>season+': '+count+'/32').join(' · ')}</p>
      <p>{report.design}</p>
      {report.markets.map(m=><div key={m.line}>
        <h3>{m.line}</h3>
        <p>Rows train / validate / unseen test: {m.splits.train.toLocaleString()} / {m.splits.validation.toLocaleString()} / {m.splits.heldOutTest.toLocaleString()}. Fit sample: {m.splits.trainingRowsUsed?.toLocaleString()??m.splits.train.toLocaleString()} training examples.</p>
        <table style={{width:'100%',textAlign:'left'}}>
          <thead><tr><th>2025–26 test</th><th>Brier</th><th>Log loss</th><th>ECE</th></tr></thead>
          <tbody>
            <tr><td>Logistic model</td><td>{fixed(m.test.brier)}</td><td>{fixed(m.test.logLoss)}</td><td>{fixed(m.test.ece)}</td></tr>
            <tr><td>Rolling baseline</td><td>{fixed(m.benchmarks.rollingPriorHitRate.brier)}</td><td>{fixed(m.benchmarks.rollingPriorHitRate.logLoss)}</td><td>{fixed(m.benchmarks.rollingPriorHitRate.ece)}</td></tr>
            <tr><td>Constant training rate</td><td>{fixed(m.benchmarks.constantTrainingRate.brier)}</td><td>{fixed(m.benchmarks.constantTrainingRate.logLoss)}</td><td>{fixed(m.benchmarks.constantTrainingRate.ece)}</td></tr>
          </tbody>
        </table>
        <p>Brier improvement over rolling baseline: {fixed(m.brierImprovementVsRolling)}. Game-cluster 95% bootstrap interval [{fixed(m.improvement95Bootstrap[0])}, {fixed(m.improvement95Bootstrap[1])}]. {m.clearBaselineWith95Confidence?'Historical improvement observed, not executable sportsbook edge.':'Historical improvement not established.'}</p>
      </div>)}
      <h3>Still required for a betting edge</h3>
      <ul>{report.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul>
    </div>}
  </section>;
}