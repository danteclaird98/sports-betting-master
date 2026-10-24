import { useState } from 'react';
import { api } from '@appdeploy/client';

type Quote={game:string;player:string;book:string;market:string;line:number;
  decimalOver:number;decimalUnder:number;fairOver:number;quoteAt:string};
type Report={status:string;recommendation:string;events:number;twoWayQuotes:number;providerCreditsUsed:number;
  books:string[];rejectReasons:Record<string,number>;quotesPreview:Quote[];limitations:string[]};
export default function HistoricalNflOddsV4Panel(){
  const [selected,setSelected]=useState<File|null>(null);
  const [mode,setMode]=useState('american');
  const [report,setReport]=useState<Report|null>(null);
  const [test,setTest]=useState('');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);
  async function audit(fixture=false){
    setLoading(true);setMessage('');
    try{
      if(fixture){const x=await api.get('/api/nfl-historical-v4-selftest');setTest(String(x.data.status));return;}
      if(!selected)throw Error('Select a historical JSON archive.');
      if(selected.size>850000)throw Error('Choose a JSON file smaller than 850 KB.');
      const payload=JSON.parse(await selected.text()) as unknown;
      const x=await api.post('/api/nfl-historical-v4-import',{oddsFormat:mode,payload});
      setReport(x.data as Report);
    }catch(e){setMessage(e instanceof Error?e.message:'Historical odds import unavailable.');}
    finally{setLoading(false);}
  }
  return <section className='panel lab'>
    <h2>Historical NFL sportsbook odds · independent-source preparation</h2>
    <p>Read actual archived sportsbook over/under quotes in The Odds API v4 JSON format. EdgeBoard checks exact player, line, sportsbook, timestamp and margin before use. External files are not automatically authenticated; nothing is billed or wagered.</p>
    <p>Historical player props require a paid provider plan. <a href='https://the-odds-api.com/liveapi/guides/v4/' target='_blank' rel='noreferrer'>Official API documentation</a>. Requests are not automatically made or charged.</p>
    <div className='setupActions'>
      <label>Archived odds format <select value={mode} onChange={e=>setMode(e.target.value)}><option value='american'>American prices</option><option value='decimal'>Decimal prices</option></select></label>
      <label>Raw historical snapshot JSON <input type='file' accept='.json,application/json' onChange={e=>{setSelected(e.target.files?.[0]??null);setReport(null);}}/></label>
      <button type='button' disabled={loading||!selected} onClick={()=>audit(false)}>Audit historical quotes</button>
      <button type='button' disabled={loading} onClick={()=>audit(true)}>Test odds-pair safeguards</button>
    </div>
    {test&&<p>Synthetic software test: {test}. This is not an authenticated market observation.</p>}
    {message&&<p role='alert' className='errorBox'>{message}</p>}
    {report&&<div>
      <p><strong>{report.recommendation}</strong> · {report.twoWayQuotes} two-sided historical market observations from {report.books.length} reported books. Verified bookmaker provenance: <strong>No</strong>. Historical betting ROI: <strong>Unavailable</strong>.</p>
      <div className='setupTable'><table><thead><tr><th>Player and game</th><th>Line</th><th>Reported book</th><th>Prices</th><th>Vig-free benchmark</th></tr></thead>
        <tbody>{report.quotesPreview.map((q,i)=><tr key={i}><td>{q.player}<small>{q.game}</small></td>
          <td>{q.market} {q.line}</td><td>{q.book}</td>
          <td>{q.decimalOver.toFixed(2)} / {q.decimalUnder.toFixed(2)}</td>
          <td>{(q.fairOver*100).toFixed(1)}% <small>Not independent model probability</small></td>
        </tr>)}</tbody></table></div>
      <details><summary>Provider and model evidence still missing</summary>
        <ul>{report.limitations.map(x=><li key={x}>{x}</li>)}</ul>
        <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(report.rejectReasons,null,2)}</pre>
      </details>
    </div>}
  </section>;
}
