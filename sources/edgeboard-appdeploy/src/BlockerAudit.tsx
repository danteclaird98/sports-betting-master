import { useState } from 'react';
import { api } from '@appdeploy/client';
type Blocker = {id: string;title:string;status:string;implemented:string[];missing:string[];solution:string;nextAction:string};
type Audit = {generatedAt:string;recommendation:string;liveApproved:boolean;blockers:Blocker[];evidencePolicy:string};
export default function BlockerAudit() {
  const [audit,setAudit] = useState<Audit|null>(null);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try { const result = await api.get('/api/blocker-audit'); setAudit(result.data as Audit); setMessage('Current code and evidence gates loaded.'); }
    catch { setMessage('Audit could not be loaded. Recommendation remains HOLD.'); }
    finally { setBusy(false); }
  }
  return <section className='panel lab' id='blocker-audit'>
    <h2>Four live-recommendation blockers</h2>
    <p>Each blocker shows implemented controls, evidence still missing, and the next verification action. No blocker clears merely because a feature is coded.</p>
    <button className='scanButton' type='button' onClick={refresh} disabled={busy}>{busy ? 'Loading…' : 'Scan four blockers'}</button>
    <p role='status'>{message}</p>
    {audit && <div><p><strong>Recommendation: {audit.recommendation}</strong> · Live approved: {audit.liveApproved ? 'Yes' : 'No'} · Audited {new Date(audit.generatedAt).toLocaleString()}</p>{audit.blockers.map((b,i)=><details key={b.id} open={i===0}><summary><strong>{i+1}. {b.title} — {b.status}</strong></summary><p><strong>Existing infrastructure:</strong> {b.implemented.join('; ')}</p><p><strong>Evidence still missing:</strong> {b.missing.join('; ')}</p><p><strong>Solution:</strong> {b.solution}</p><p><strong>Next action:</strong> {b.nextAction}</p></details>)}<p>{audit.evidencePolicy}</p></div>}
  </section>;
}
