import { useState } from 'react';
import { api } from '@appdeploy/client';

type QuoteResult = {
  status: string;
  total: number;
  structurallyValid: number;
  rejectedCount: number;
  distinctGames: number;
  distinctBooks: number;
  independentlyAuthenticated: boolean;
  claimedRoi: number | null;
  rejected: Array<{ index: number; reasons: string[] }>;
  nextActions: string[];
  note: string;
};
const example = {
  sourceName: 'Replace with actual historical archive name',
  quotes: [
    {
      sourceUrl: 'https://source.example/verified-historical-archive',
      providerQuoteId: 'example-identifier',
      gameId: '2025_02_DAL_GB',
      playerId: 'replace-with-nflverse-id',
      market: 'receptions',
      line: 3.5,
      period: 'full_game',
      bookmaker: 'examplebook',
      overAmerican: -110,
      underAmerican: -110,
      capturedAt: '2025-09-13T20:00:00Z',
      kickoffAt: '2025-09-14T20:00:00Z',
      rulesVersion: 'version-id-from-rulebook',
    },
  ],
};
export default function HistoricalPropPriceAudit() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<QuoteResult | null>(null);
  const [fixture, setFixture] = useState('');
  async function run(kind: 'fixture' | 'audit') {
    setBusy(true);
    setError('');
    setReport(null);
    try {
      if (kind === 'fixture') {
        const result = await api.get('/api/nfl-historical-quote-selftest');
        setFixture(String(result.data.status));
        return;
      }
      if (!file) throw Error('Choose a JSON archive first.');
      if (file.size > 900_000) throw Error('JSON file must be below 900 KB.');
      const json = JSON.parse(await file.text()) as unknown;
      const result = await api.post('/api/nfl-historical-quote-validate', json);
      setReport(result.data as QuoteResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Historical archive unavailable');
    } finally {
      setBusy(false);
    }
  }
  function downloadSchema() {
    const blob = new Blob([JSON.stringify(example, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nfl-prop-archive-schema-example.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className='panel lab'>
      <h2>Historical NFL sportsbook-price validation</h2>
      <p>Validate externally obtained 2025 full-game quotes for exact fixed thresholds, identity, source fields and pre-kickoff timing. Does not download paid odds or treat user-supplied source claims as independently verified.</p>
      <div className='setupActions'>
        <button type='button' disabled={busy} onClick={downloadSchema}>Download JSON example</button>
        <button type='button' disabled={busy} onClick={() => run('fixture')}>Test quote safeguards (synthetic, free)</button>
        <input aria-label='Historical NFL quotes JSON' type='file' accept='.json,application/json' onChange={e => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
        <button type='button' disabled={busy || !file} onClick={() => run('audit')}>{busy ? 'Validating…' : 'Audit historical JSON without saving'}</button>
      </div>
      {fixture && <p>Integrity fixture: <strong>{fixture}</strong>. This does not validate live price access.</p>}
      {error && <div role='alert' className='errorBox'>{error}</div>}
      {report && (
        <>
          <p><strong>{report.status} — HOLD.</strong> {report.structurallyValid}/{report.total} quotes passed structural checks, {report.distinctGames} games, {report.distinctBooks} books. Independent provenance verified: {String(report.independentlyAuthenticated)}.</p>
          <p>{report.note}</p>
          {report.rejected.length > 0 && <div className='setupTable'><table><thead><tr><th>Row</th><th>Reason</th></tr></thead><tbody>
            {report.rejected.map(r => <tr key={r.index}><td>{r.index + 1}</td><td>{r.reasons.join('; ')}</td></tr>)}
          </tbody></table></div>}
          <p><strong>Next checks:</strong> {report.nextActions.join(' ')}</p>
        </>
      )}
    </section>
  );
}
