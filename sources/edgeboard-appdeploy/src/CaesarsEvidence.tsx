import { useState } from 'react';
import { api, auth } from '@appdeploy/client';
type Rules = {warning:string;rules:Array<{jurisdiction:string;subject:string;description:string;source:string;effective:string}>};
export default function CaesarsEvidence() {
  const [rules,setRules]=useState<Rules|null>(null);
  const [records,setRecords]=useState<unknown>(null);
  const [result,setResult]=useState('');
  const [busy,setBusy]=useState(false);
  const [ticketId,setTicket]=useState('');
  const [event,setEvent]=useState('');
  const [selection,setSelection]=useState('');
  const [state,setState]=useState('');
  const [acceptedOdds,setOdds]=useState('');
  const [acceptedStake,setStake]=useState('');
  const [acceptedAt,setAcceptedAt]=useState('');
  const [offeredOdds,setOfferedOdds]=useState('');
  const [offeredAt,setOfferedAt]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  async function act(fn:()=>Promise<void>) {setBusy(true);setResult('');try{await fn();}catch(e){setResult(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}}
  async function authenticate() {if (!auth.isSignedIn()) await auth.signIn();if (!auth.isSignedIn()) throw Error('Sign in is required.');}
  return <section className='panel lab' id='caesars-execution-evidence'>
    <h2>Caesars rulebook and accepted-price evidence</h2>
    <p>Rulebooks differ across states and venues. Ticket-specific settlement remains unverified until its applicable in-app terms are confirmed. A displayed sportsbook quote is not proof of an accepted bet.</p>
    <button className='scanButton' disabled={busy} type='button' onClick={()=>act(async()=>{const r=await api.get('/api/caesars-rules');setRules(r.data as Rules);})}>View jurisdiction-scoped rule references</button>
    {rules && <div><p>{rules.warning}</p>{rules.rules.map(r=><details key={r.jurisdiction}><summary>{r.jurisdiction} — {r.subject}</summary><p>{r.description} ({r.effective})</p><a href={r.source} target='_blank' rel='noreferrer'>Published rule reference</a></details>)}</div>}
    <h3>Archive an accepted Caesars ticket</h3>
    <p>Optional, signed-in, private, manual record. This does not place wagers or fetch account credentials. Enter the accepted odds from a genuine ticket; leave offered price blank if unknown.</p>
    <div className='controlGrid'>
      <label className='field'>Ticket ID<input value={ticketId} onChange={e=>setTicket(e.target.value)}/></label>
      <label className='field'>Event<input value={event} onChange={e=>setEvent(e.target.value)} placeholder='Bills @ Rams'/></label>
      <label className='field'>Exact picks / market fingerprint<input value={selection} onChange={e=>setSelection(e.target.value)} placeholder='Four leg SGP, exact lines'/></label>
      <label className='field'>Account jurisdiction<input value={state} onChange={e=>setState(e.target.value)} placeholder='NV'/></label>
      <label className='field'>Accepted American odds<input value={acceptedOdds} onChange={e=>setOdds(e.target.value)} placeholder='+146'/></label>
      <label className='field'>Accepted stake (USD)<input type='number' min='0' step='.01' value={acceptedStake} onChange={e=>setStake(e.target.value)}/></label>
      <label className='field'>Accepted at (ISO with timezone)<input value={acceptedAt} onChange={e=>setAcceptedAt(e.target.value)} placeholder='2026-10-12T17:00:00-07:00'/></label>
      <label className='field'>Offered odds (optional)<input value={offeredOdds} onChange={e=>setOfferedOdds(e.target.value)}/></label>
      <label className='field'>Offer time (optional; ISO)<input value={offeredAt} onChange={e=>setOfferedAt(e.target.value)}/></label>
    </div>
    <label><input type='checkbox' checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirm these details come from an accepted Caesars ticket.</label>
    <button className='scanButton' disabled={busy||!confirmed} type='button' onClick={()=>act(async()=>{await authenticate();const r=await api.post('/api/execution-evidence',{ticketId,event,selectionSignature:selection,jurisdiction:state,acceptedAmerican:Number(acceptedOdds),acceptedStake:Number(acceptedStake),acceptedAt,offeredAmerican:offeredOdds===''?null:Number(offeredOdds),offeredAt:offeredAt||null,receiptConfirmed:confirmed});setResult(JSON.stringify(r.data,null,2));setConfirmed(false);})}>Save accepted-ticket record</button>
    <button className='scanButton' disabled={busy} type='button' onClick={()=>act(async()=>{await authenticate();const r=await api.get('/api/execution-evidence');setRecords(r.data);})}>View my archived ticket evidence</button>
    {result && <p role='status'>{result}</p>}
    {records!==null && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:300,overflowY:'auto'}}>{JSON.stringify(records,null,2)}</pre>}
    <p>Every manually entered record is labeled providerAuthenticated=false. No claim of actual Caesars data access or live EV can be made from this record alone.</p>
  </section>;
}
