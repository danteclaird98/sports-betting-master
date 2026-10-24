import { useState } from 'react';
import { api } from '@appdeploy/client';
type Readiness = { status: string; modelTrained: boolean; liveApproved: boolean; markets: string[]; requirements: string[]; recommendation: string; historicalTestCompleted: boolean; sportsbookBenchmarkVerified: boolean; provenanceVerified: boolean };
export default function NflPropLab() {
  const [data, setData] = useState<Readiness | null>(null);
  const [message, setMessage] = useState('');
  async function inspect() {
    try { const result = await api.get('/api/nfl-prop-readiness'); setData(result.data as Readiness); setMessage('Research-readiness check completed.'); }
    catch { setMessage('Research-readiness check unavailable. No model is approved.'); }
  }
  return <section className='panel lab' id='nfl-prop-lab'>
    <h2>NFL player-prop model lab</h2>
    <p>Research-only integration of the standalone prototype. Supports receiving, rushing, passing, catches and touchdowns. A real historical player-stat fit is available in the backtest panel, but no sportsbook-price benchmark has been validated.</p>
    <button className='scanButton' type='button' onClick={inspect}>Inspect player-prop model readiness</button>
    <p role='status'>{message}</p>
    {data && <div><p><strong>Decision: {data.recommendation}</strong> · {data.status} · Live approval: {data.liveApproved ? 'Yes' : 'No'} · Trained: {data.modelTrained ? 'Yes' : 'No'}</p><p>Markets: {data.markets.join(', ')}</p><p>Verified historical source: {data.provenanceVerified ? 'Yes' : 'No'} · Held-out test: {data.historicalTestCompleted ? 'Yes' : 'No'} · Market benchmark: {data.sportsbookBenchmarkVerified ? 'Yes' : 'No'}</p><h3>Evidence required before recommendations</h3><ul>{data.requirements.map(item => <li key={item}>{item}</li>)}</ul></div>}
    <p>The existing odds feeds and wager tracker remain unchanged. Synthetic integrity tests are not proof of model accuracy or profitability.</p>
  </section>;
}
