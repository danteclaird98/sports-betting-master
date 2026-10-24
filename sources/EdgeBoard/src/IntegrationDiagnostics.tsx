import { useState } from 'react';
import { api, auth } from '@appdeploy/client';

export default function IntegrationDiagnostics() {
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    try {
      if (!auth.isSignedIn()) await auth.signIn();
      if (!auth.isSignedIn()) throw Error('Sign in required');
      const { data } = await api.post('/api/test-ledger-storage', {});
      setResult(JSON.stringify(data, null, 2));
    } catch (e) { setResult(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }
  return <section className='panel lab'>
    <h2>Integration verification</h2>
    <p>Run an authenticated create/read/update/delete test in a separate private diagnostic table. Your wagers are not touched.</p>
    <button className='scanButton' type='button' disabled={busy} onClick={check}>{busy ? 'Testing…' : 'Test private storage'}</button>
    <p>Caesars live verification: use the sport selector in the Caesars feed below. Each request may consume provider credits. No paid feed call is made by this diagnostic.</p>
    {result && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result}</pre>}
    <p>Historical model status: candidate only. Import source-verified settled samples through Model evaluation; live approval requires verified point-in-time features, out-of-sample calibration, and executable odds.</p>
  </section>;
}
