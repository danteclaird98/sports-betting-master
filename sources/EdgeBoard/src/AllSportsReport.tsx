import { useState } from 'react';
import { api } from '@appdeploy/client';

type Row = { sport: string; name: string; status: string; eventCount: number;
  gamePrices: number; propSides: number; qualifyingCount: number };
type Report = { generatedAt: string; caution: string; sports: Row[] };
export default function AllSportsReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function scan() {
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ timezone: 'America/Los_Angeles' });
      const response = await api.get('/api/all-sports-report?' + params.toString());
      setReport(response.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Research unavailable');
    } finally { setBusy(false); }
  }
  return <section className='researchSetup'>
    <h2>Eight-sport market coverage</h2>
    <p>Research MLB, NHL, NFL, college football, NBA, WNBA, tennis and MMA with free data. No paid requests, automatic wagers, or unvalidated EV claims.</p>
    <button disabled={busy} onClick={scan}>{busy ? 'Scanning markets…' : 'Scan all eight sports'}</button>
    {error && <p role='alert'>{error}</p>}
    {report && <div>
      <p>Updated {report.generatedAt}. {report.caution}</p>
      <div className='setupTable'><table>
        <thead><tr><th>Sport</th><th>Pregame events</th><th>Market quotes</th><th>Prop market sides</th><th>Qualified</th></tr></thead>
        <tbody>{report.sports.map(row => <tr key={row.sport}><td>{row.name}</td><td>{row.eventCount}</td><td>{row.gamePrices}</td><td>{row.propSides}</td><td>{row.qualifyingCount}</td></tr>)}</tbody>
      </table></div>
      <p>Use Ask EdgeBoard below for exact observed prices and reasons each opportunity was rejected.</p>
    </div>}
  </section>;
}
