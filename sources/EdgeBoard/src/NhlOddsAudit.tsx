import { useEffect, useState } from 'react';
import { api } from '@appdeploy/client';

type Readiness={connected:boolean;status:string;provider:string;freeCreditsAdvertisedPerMonth:number;
  costCreditsPerGame:number;historicalSeasonCoverageWarning:string;instructions:string;recommendation:string};
type Audit={status:string;gameId:string;gameDate:string;matchedLines:number;sourceCapturedCount:number;
  rejectedReasons:Record<string,number>;distinctMatchedBooks:number;recommendation:string;
  preview:Array<Record<string,unknown>>;limitations:string[];providerCreditsConsumed:number};
export default function NhlOddsAudit() {
  const [ready,setReady]=useState<Readiness|null>(null);
  const [game,setGame]=useState('2025020002');
  const [estimate,setEstimate]=useState<string>('');
  const [audit,setAudit]=useState<Audit|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [consent,setConsent]=useState(false);
  const [tests,setTests]=useState<string>('');
  const [connectionTest,setConnectionTest]=useState<string>('');
  async function load() {
    try{const r=await api.get('/api/nhl-odds-readiness');setReady(r.data as Readiness);}
    catch{setError('NHL odds readiness unavailable; HOLD.');}
  }
  useEffect(()=>{load();},[]);
  async function checkConnection() {
    setBusy(true);setError('');setConnectionTest('');
    try {
      const response=await api.get('/api/nhl-odds-connection-check');
      setConnectionTest(JSON.stringify(response.data,null,2));
    }catch(e){setError(e instanceof Error?e.message:'Zero-credit provider check failed');}
    finally{setBusy(false);}
  }
  async function selftest(){
    setBusy(true);setError('');
    try{const r=await api.get('/api/nhl-odds-selftest');
      const x=r.data as {status:string;checks:Record<string,boolean>};
      setTests(x.status+' · '+Object.entries(x.checks).map(([k,v])=>k+': '+(v?'pass':'fail')).join(' · '));
    }catch(e){setError(e instanceof Error?e.message:'Quote rules unavailable');}
    finally{setBusy(false);}
  }
  async function preview() {
    setBusy(true);setError('');setEstimate('');setAudit(null);setConsent(false);
    try{const r=await api.post('/api/nhl-odds-price-preview',{gameId:game.trim()});
      setEstimate(JSON.stringify(r.data,null,2));}
    catch(e){setError(e instanceof Error?e.message:'Cost preview unavailable');}
    finally{setBusy(false);}
  }
  async function runAudit(){
    if(!consent||!estimate||!ready?.connected)return;
    setBusy(true);setError('');setAudit(null);
    try{const r=await api.post('/api/nhl-odds-market-audit',{gameId:game.trim(),confirmCredits:10});
      setAudit(r.data as Audit);
      setEstimate('');
    }catch(e){setError(e instanceof Error?e.message:'Quote audit unavailable; check connection or credits');}
    finally{setBusy(false);setConsent(false);}
  }
  return <section className='panel lab' id='nhl-odds-audit'>
    <h2>NHL shots · historical sportsbook-price audit</h2>
    <p><strong>HOLD.</strong> Verifies archived 2025–26 player shot lines against NHL IDs, game starts, official shot results and out-of-sample model probabilities. No live wagers and no historical ROI claim without a representative, point-in-time betting sample.</p>
    <p>Source: <a href='https://puckapi.com/data/player-props' target='_blank' rel='noreferrer'>PuckAPI archive</a> (limited coverage). Provider key: <strong>{ready?.connected?'Connected':'Not connected'}</strong>.
      Archive offers 500 free credits/month and costs 10 credits per game. No credits are spent automatically.</p>
    <p>{ready?.historicalSeasonCoverageWarning??'Checking source readiness…'}</p>
    <p>{ready?.instructions} A saved key is not an authenticated connection until the separate zero-credit estimate check succeeds.</p>
    <button className='scanButton' type='button' onClick={load} disabled={busy}>Refresh source connection</button>
    <button className='scanButton' type='button' onClick={checkConnection} disabled={!ready?.connected||busy}>Verify PuckAPI key via zero-credit estimate</button>
    {connectionTest&&<pre role='status' style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:200,overflowY:'auto'}}>{connectionTest}</pre>}
    <button className='scanButton' type='button' onClick={selftest} disabled={busy}>Test quote-validation safeguards (zero credits)</button>
    {tests&&<p role='status'>{tests}</p>}
    <label>Historical NHL game ID <input aria-label='NHL game id' value={game} onChange={e=>{setGame(e.target.value);setEstimate('');setConsent(false);setAudit(null);}} placeholder='2025020002' /></label>
    <button className='scanButton' type='button' onClick={preview} disabled={!ready?.connected||busy}>
      {busy?'Working…':'Preview provider credit cost (no charge)'}
    </button>
    {estimate&&<div>
      <h3>Cost preview — no archive charged yet</h3>
      <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:180,overflowY:'auto'}}>{estimate}</pre>
      <label><input type='checkbox' checked={consent} onChange={e=>setConsent(e.target.checked)} />
        I approve one PuckAPI historical game-prop lookup costing up to 10 provider credits (not money).</label>
      <button className='scanButton' type='button' disabled={!consent||busy||!ready?.connected} onClick={runAudit}>
        {busy?'Auditing…':'Use 10 credits and audit exact historical quotes'}
      </button>
    </div>}
    {error&&<p role='alert'>{error} — No conclusion or wager recommendation is issued.</p>}
    {audit&&<div>
      <p role='status'><strong>{audit.status} · HOLD</strong> — {audit.gameId}, {audit.gameDate}</p>
      <p>Archived quotes: {audit.sourceCapturedCount}; identity, time and settlement matched: {audit.matchedLines}; matching books: {audit.distinctMatchedBooks}; provider credits reported consumed: {audit.providerCreditsConsumed}.</p>
      <details><summary>Rejection reasons</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(audit.rejectedReasons,null,2)}</pre></details>
      <details><summary>First matched quote records (research only)</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:350,overflowY:'auto'}}>{JSON.stringify(audit.preview,null,2)}</pre></details>
      <p><strong>Validated ROI: unavailable.</strong> {audit.limitations.join(' ')}</p>
    </div>}
  </section>;
}