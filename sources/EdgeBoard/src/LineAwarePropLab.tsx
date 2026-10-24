import { useState } from 'react';
import { api } from '@appdeploy/client';

type Score = { n:number; brier:number; logLoss:number; reliability?: {
  count:number;expectedCalibrationError:number } | null };
type Report = {
  status:string; selection:string; market:string; configuration:{
    trainingSeasons:string;modelSelection:string;calibrationFit:string;diagnosticWindow:string;ladder:number[];selectionLoss:number };
  dataset:{testThresholdObservations:number;testPlayerGames:number;distinctGames:number;selectionCandidates:number};
  test:{uncalibrated:Score;plattCalibrated:Score;staticLeagueBaseline:Score};
  calibration:{brierImprovement:number;logLossImprovement:number;improvesBoth:boolean};
  comparisons:{againstMatchedSportsbook:boolean;verifiedBettingROI:null};
  caveats:string[];
};
const markets=[
  ['receptions','Receptions (2.5 / 4.5 / 6.5 / 8.5)'],
  ['receiving_yards','Receiving yards (24.5 / 49.5 / 74.5 / 99.5)'],
  ['rushing_yards','Rushing yards (24.5 / 49.5 / 74.5 / 99.5)'],
  ['passing_yards','Passing yards (174.5 / 224.5 / 274.5 / 324.5)'],
];
function fmt(n:number) {return Number.isFinite(n)?n.toFixed(4):'—';}
export default function LineAwarePropLab() {
  const [market,setMarket]=useState('receptions');
  const [report,setReport]=useState<Report|null>(null);
  const [testStatus,setTestStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function run(fixture=false) {
    setBusy(true);setError('');
    if (!fixture) setReport(null);
    try {
      const path=fixture?'/api/nfl-line-aware-selftest':'/api/nfl-line-aware-backtest?market='+encodeURIComponent(market);
      const response=await api.get(path);
      if (fixture) setTestStatus(String(response.data.status));
      else setReport(response.data as Report);
    } catch(e) {setError(e instanceof Error?e.message:'Historical sample unavailable. HOLD.');}
    finally{setBusy(false);}
  }
  return (
    <section className='panel lab'>
      <h2>NFL line-specific probability research</h2>
      <p>Research-only model evaluates multiple exact reception and yardage thresholds. Uses prior player history; selects settings on early 2024, fits calibration on late 2024, and reports reused 2025 retrospective diagnostics. Valid negative yardage remains in history.</p>
      <p><strong>Important:</strong> Thresholds are research examples, not historical sportsbook offers. Even a strong historical score is not proof of a +EV bet.</p>
      <div className='setupActions'>
        <label>Prop market{' '}
          <select value={market} onChange={e=>{setMarket(e.target.value);setReport(null);}}>
            {markets.map(([key,label])=><option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button type='button' disabled={busy} onClick={()=>run(false)}>{busy?'Evaluating…':'Run line-specific historical diagnostic'}</button>
        <button type='button' disabled={busy} onClick={()=>run(true)}>Test threshold math (synthetic)</button>
      </div>
      {testStatus && <p>Deterministic integrity test: {testStatus}; not proof of betting performance.</p>}
      {error && <p role='alert' className='errorBox'>{error}</p>}
      {report && (
        <div>
          <p><strong>{report.selection}</strong> · historical model experiment only · reused 2025 player games {report.dataset.testPlayerGames.toLocaleString()} across {report.dataset.distinctGames} games.</p>
          <div className='setupTable'>
            <table><thead><tr><th>2025 metric</th><th>Historical base rate</th><th>Line-aware raw</th><th>2024-calibrated</th></tr></thead>
              <tbody>
                <tr><td>Brier (lower is better)</td><td>{fmt(report.test.staticLeagueBaseline.brier)}</td><td>{fmt(report.test.uncalibrated.brier)}</td><td>{fmt(report.test.plattCalibrated.brier)}</td></tr>
                <tr><td>Log loss (lower is better)</td><td>{fmt(report.test.staticLeagueBaseline.logLoss)}</td><td>{fmt(report.test.uncalibrated.logLoss)}</td><td>{fmt(report.test.plattCalibrated.logLoss)}</td></tr>
              </tbody>
            </table>
          </div>
          <p>Thresholds: {report.configuration.ladder.join(', ')} · Hyperparameters tested: {report.dataset.selectionCandidates}. The 2025 results were not used for fitting.</p>
          <p>Matched independent sportsbook benchmark: <strong>NOT AVAILABLE</strong>. Historical betting ROI: <strong>NOT MEASURED</strong>.</p>
          <details><summary>Full model diagnostics and caveats</summary>
            <ul>{report.caveats.map(line=><li key={line}>{line}</li>)}</ul>
            <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:340,overflowY:'auto'}}>{JSON.stringify(report,null,2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
