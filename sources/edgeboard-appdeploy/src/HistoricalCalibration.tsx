import { useState } from 'react';
import { api, auth } from '@appdeploy/client';

type History = { rows: number; seasons: number[]; columnsPresent: string[]; columnsMissing: string[]; scoredGames: number; rowsWithMoneylines: number; note: string };
export default function HistoricalCalibration() {
  const [data, setData] = useState<History | null>(null);
  const [notice, setNotice] = useState('');
  const [archive, setArchive] = useState('');
  const [calibration, setCalibration] = useState('');
  async function runResearch() {
    setCalibration('Evaluating chronological historical seasons…');
    try { const { data } = await api.get('/api/nfl-historical-calibration'); setCalibration(JSON.stringify(data, null, 2)); }
    catch { setCalibration('Historical evaluation failed; no betting model approved.'); }
  }
  async function inspect() {
    setNotice('Inspecting source…');
    try {
      const { data } = await api.get('/api/historical-nfl-health');
      setData(data as History); setNotice('Historical source inspected. Not approved for wager pricing.');
    } catch { setNotice('Historical source could not be verified. No model was trained.'); }
  }
  async function listArchives() {
    try {
      if (!auth.isSignedIn()) await auth.signIn();
      if (!auth.isSignedIn()) return;
      const { data } = await api.get('/api/quote-archive');
      setArchive(JSON.stringify(data, null, 2));
    } catch { setArchive('Private quote archive could not be loaded.'); }
  }
  return <section className='panel lab'>
    <h2>Historical calibration & point-in-time data</h2>
    <p>Inspect NFL historical records without fitting a model. Past moneylines lacking the quoted bookmaker and observation time cannot establish executable Caesars EV.</p>
    <button className='scanButton' type='button' onClick={inspect}>Inspect free NFL history</button>
    <button className='scanButton' type='button' onClick={runResearch}>Evaluate chronological NFL calibration</button>
    <button className='scanButton' type='button' onClick={listArchives}>View saved quote batches</button>
    <p>{notice}</p>
    {data && <div><p>{data.rows} rows; {data.scoredGames} with scores; {data.rowsWithMoneylines} with moneylines.</p><p>Seasons: {data.seasons.join('–')}. Missing columns: {data.columnsMissing.join(', ') || 'none'}.</p><p>{data.note}</p></div>}
    {archive && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{archive}</pre>}
    {calibration && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:430,overflowY:'auto'}}>{calibration}</pre>}
    <p>Model approval remains blocked until independent historical provenance, out-of-sample calibration and real execution constraints are verified.</p>
  </section>;
}
