import { useState } from 'react';
import { api } from '@appdeploy/client';

type Entry = { event: string; market: string; selection: string; americanOdds: string; pushPossible: string };
const blank = (): Entry => ({ event: '', market: '', selection: '', americanOdds: '-110', pushPossible: 'unknown' });
type AuditResult = {
  status: string;
  headlinePayoutThreshold: number | null;
  offeredBreakEvenProbability: number | null;
  headlineThresholdMeaning: string;
  jointEvFormula: { statement: string; note: string } | null;
  pushIllustrations: Array<{ ifLegPushes: number; ifAllOtherLegsWin: { grossReturnPerUnit: number; netProfitPerUnit: number } | null; assumption: string }>;
  blockers: string[];
  risk: { dashboardMaxSlipStake?: number; recommendedStake: number; exceedsOnePercentGuideline?: boolean | null; exceedsParlayGuideline?: boolean | null };
  estimatedEv: null;
};
export default function ParlayAudit() {
  const [lines, setLines] = useState<Entry[]>([blank(), blank()]);
  const [kind, setKind] = useState<'ordinary' | 'same_game'>('ordinary');
  const [price, setPrice] = useState('');
  const [bankroll, setBankroll] = useState('');
  const [exposure, setExposure] = useState('');
  const [stake, setStake] = useState('');
  const [result, setResult] = useState<AuditResult | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  function update(index: number, key: keyof Entry, value: string) {
    setLines(old => old.map((row, i) => i === index ? { ...row, [key]: value } : row));
    setResult(null);
  }
  async function evaluate() {
    setBusy(true);
    setFailure('');
    setResult(null);
    try {
      const { data } = await api.post('/api/parlay-audit', {
        kind,
        legs: lines.map(line => ({
          ...line,
          americanOdds: Number(line.americanOdds),
          pushPossible: line.pushPossible === 'unknown' ? null : line.pushPossible === 'yes',
          sportsbook: 'Caesars (manually entered)',
        })),
        combinedAmericanOdds: price.trim() ? Number(price) : undefined,
        bankroll: bankroll.trim() ? Number(bankroll) : undefined,
        existingExposure: exposure.trim() ? Number(exposure) : undefined,
        stake: stake.trim() ? Number(stake) : undefined,
      });
      setResult(data as AuditResult);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Audit unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className='panel lab'>
      <h2>Caesars parlay audit · win / push / loss</h2>
      <p>Enter the exact accepted/offered combined price. All timestamps, prices and rules entered here remain unverified. No stake or EV is recommended without validated joint outcomes.</p>
      <label className='field'>Parlay type
        <select value={kind} onChange={e => { setKind(e.target.value as 'ordinary' | 'same_game'); setResult(null); }}>
          <option value='ordinary'>Ordinary parlay · different games</option>
          <option value='same_game'>Same-game parlay (SGP)</option>
        </select>
      </label>
      {lines.map((line, i) => (
        <div key={i} className='controlGrid'>
          <label className='field'>Event {i + 1}<input value={line.event} onChange={e => update(i, 'event', e.target.value)} /></label>
          <label className='field'>Market and line<input value={line.market} onChange={e => update(i, 'market', e.target.value)} placeholder='Total goals under 6.0' /></label>
          <label className='field'>Selection<input value={line.selection} onChange={e => update(i, 'selection', e.target.value)} /></label>
          <label className='field'>American odds<input value={line.americanOdds} onChange={e => update(i, 'americanOdds', e.target.value)} /></label>
          <label className='field'>Can this selection push?
            <select value={line.pushPossible} onChange={e => update(i, 'pushPossible', e.target.value)}>
              <option value='unknown'>Unknown / unverified</option>
              <option value='yes'>Yes (integer total/spread)</option>
              <option value='no'>No (verified half-point or two-way result)</option>
            </select>
          </label>
        </div>
      ))}
      <button type='button' disabled={lines.length >= 8} onClick={() => setLines(x => [...x, blank()])}>Add another leg</button>{' '}
      <button type='button' disabled={lines.length <= 2} onClick={() => setLines(x => x.slice(0, -1))}>Remove last leg</button>
      <div className='controlGrid'>
        <label className='field'>Exact Caesars combined odds<input value={price} onChange={e => setPrice(e.target.value)} placeholder='+248' /></label>
        <label className='field'>Bankroll (optional)<input inputMode='decimal' value={bankroll} onChange={e => setBankroll(e.target.value)} placeholder='130' /></label>
        <label className='field'>Existing open exposure (optional)<input inputMode='decimal' value={exposure} onChange={e => setExposure(e.target.value)} placeholder='0' /></label>
        <label className='field'>Proposed stake (optional)<input inputMode='decimal' value={stake} onChange={e => setStake(e.target.value)} placeholder='15' /></label>
      </div>
      <button className='scanButton' type='button' disabled={busy} onClick={evaluate}>{busy ? 'Checking…' : 'Audit parlay'}</button>
      {failure && <p role='alert'>{failure}</p>}
      {result && (
        <div aria-live='polite'>
          <h3>{result.status}: no verified positive EV</h3>
          <p>Headline all-win threshold: {result.headlinePayoutThreshold === null ? 'Missing combined price' : (100 * result.headlinePayoutThreshold).toFixed(2) + '%'}.</p>
          <p>{result.headlineThresholdMeaning}</p>
          <p>Valid no-push break-even estimate: {result.offeredBreakEvenProbability === null ? 'Unavailable — possible push, missing price, or SGP' : (100 * result.offeredBreakEvenProbability).toFixed(2) + '%'}.</p>
          {result.jointEvFormula && <p><strong>Push-aware EV relationship:</strong> {result.jointEvFormula.statement} {result.jointEvFormula.note}</p>}
          {result.pushIllustrations.map(item => (
            <p key={item.ifLegPushes}>If leg {item.ifLegPushes} pushes and every other leg wins: {item.ifAllOtherLegsWin ? (item.ifAllOtherLegsWin.grossReturnPerUnit.toFixed(3) + '× gross return per $1') : 'repriced SGP payout unavailable'}. {item.assumption}</p>
          ))}
          {result.risk.dashboardMaxSlipStake !== undefined && <p>0.5% parlay bankroll cap: ${result.risk.dashboardMaxSlipStake.toFixed(2)}. Proposed stake exceeds it: {String(result.risk.exceedsParlayGuideline)}.</p>}
          <h4>Why EdgeBoard abstains</h4>
          <ul>{result.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
          <p>Estimated joint EV unavailable · Stake recommendation: $0 · No wager placed.</p>
        </div>
      )}
    </section>
  );
}

