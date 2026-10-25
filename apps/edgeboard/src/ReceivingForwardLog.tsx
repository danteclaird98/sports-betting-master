import { useEffect, useRef, useState } from 'react';
import { api, auth } from '../../../runtime/client.ts';
import ReceivingForwardEvaluation from './ReceivingForwardEvaluation';
import { createSgoOwnerSession as createOwnerSession } from '../shared/sgoOwner';

type Item = {
  id: string; owner: string; savedAt: string; receiptSha256: string; protocolSha256: string;
  forecast: { playerId: string; gameId: string; kickoffAt: string; probability: number;
    rawProbability: number; calibratedProbability: number };
};
type Page = { owner: string; items: Item[]; nextToken: string | null; protocol: Record<string, unknown>; protocolSha256: string };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const time = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
function validPage(value: unknown, owner: string): value is Page {
  if (!object(value) || value.owner !== owner || !Array.isArray(value.items) || value.items.length > 10
    || !object(value.protocol) || !hash(value.protocolSha256)
    || value.bettingDecision !== 'HOLD' || value.liveApproved !== false || value.executionEnabled !== false
    || !(value.nextToken === null || (typeof value.nextToken === 'string' && value.nextToken.length <= 3000))) return false;
  const protocol = value.protocol;
  return value.items.every(item => object(item) && item.owner === owner && typeof item.id === 'string'
    && hash(item.receiptSha256) && item.protocolSha256 === value.protocolSha256 && time(item.savedAt)
    && object(item.forecast) && item.forecast.calculationStatus === 'CALCULATED'
    && item.forecast.artifactSha256 === protocol.artifactSha256
    && item.forecast.bettingDecision === 'HOLD' && item.forecast.liveApproved === false
    && item.forecast.executionEnabled === false && time(item.forecast.kickoffAt)
    && typeof item.forecast.playerId === 'string' && typeof item.forecast.gameId === 'string'
    && [item.forecast.probability, item.forecast.rawProbability, item.forecast.calibratedProbability].every(probability));
}
const percent = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function ReceivingForwardLog({ playerId, gameId }: { playerId: string; gameId: string }) {
  const [owner, setOwner] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [saved, setSaved] = useState<Item | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [download, setDownload] = useState<{ page: Page; url: string } | null>(null);
  const generation = useRef(0);
  const session = useRef<ReturnType<typeof createOwnerSession> | null>(null);
  if (!session.current) session.current = createOwnerSession(async () => (await auth.getUser())?.userId ?? null, next => {
    generation.current++;
    setOwner(next); setPage(null); setSaved(null); setMessage(''); setBusy(false); setRecoveryRequired(false);
  });
  useEffect(() => {
    const guard = session.current!;
    const sync = () => { void guard.sync().catch(() => setMessage('Account could not be verified. Sign in and reload.')); };
    sync();
    const timer = setInterval(sync, 15_000);
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      generation.current++; guard.invalidate(); clearInterval(timer);
      window.removeEventListener('focus', sync); window.removeEventListener('storage', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  useEffect(() => { generation.current++; setSaved(null); setMessage(''); setBusy(false); }, [playerId, gameId]);
  useEffect(() => {
    if (!page) { setDownload(null); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...page }, null, 2)], { type: 'application/json' }));
    setDownload({ page, url });
    return () => URL.revokeObjectURL(url);
  }, [page]);

  async function signIn() {
    try { await auth.signIn(); await session.current!.sync(); }
    catch { setMessage('Sign-in was not completed. Allow the sign-in popup and retry.'); }
  }
  async function request(save: boolean, token?: string) {
    const current = ++generation.current;
    setBusy(true); setMessage('');
    try {
      const ticket = await session.current!.capture();
      // Initial identity adoption may invalidate this request; user can retry under that account.
      if (current !== generation.current) return;
      const suffix = `?owner=${encodeURIComponent(ticket.owner)}`;
      if (save) {
        if (!playerId || !gameId || recoveryRequired) throw Error('Select a forecast and reload saved history before saving again.');
        setRecoveryRequired(true);
        const { data } = await api.post('/api/receiving-forward' + suffix, { playerId, gameId });
        if (current !== generation.current || !await session.current!.accepts(ticket, data?.owner) || current !== generation.current) return;
        const candidate = { ...data, items: [data.item], nextToken: null };
        if (!validPage(candidate, ticket.owner) || !['SAVED', 'EXISTING'].includes(data.saveStatus)
          || data.item.forecast.playerId !== playerId || data.item.forecast.gameId !== gameId) throw Error('Save response could not be verified. Reload saved history.');
        setSaved(data.item); setPage(candidate); setRecoveryRequired(false);
        setMessage(data.saveStatus === 'SAVED' ? 'Server forecast saved. The calculation was rerun from source data; its saved values are shown below.' : 'The first saved forecast already exists and was kept unchanged.');
      } else {
        setPage(null);
        const { data } = await api.get('/api/receiving-forward' + suffix + (token ? `&nextToken=${encodeURIComponent(token)}` : ''));
        if (current !== generation.current || !await session.current!.accepts(ticket, data?.owner) || current !== generation.current) return;
        if (!validPage(data, ticket.owner)) throw Error('Saved forecast response could not be verified. Retry reload.');
        setPage(data); setSaved(null); setRecoveryRequired(false);
      }
    } catch (failure) {
      if (current === generation.current) setMessage(failure instanceof Error ? failure.message : 'Request unconfirmed. Reload saved history before retrying the same selection.');
    } finally { if (current === generation.current) setBusy(false); }
  }

  return <div className="correctedScoreReceipt" aria-busy={busy}>
    <h3>Forward forecast log · independent of odds</h3>
    <p>Save a server-calculated forecast at least two minutes before kickoff. The first saved forecast for each player/game is retained; later saves cannot replace it. Raw and calibrated predictions are both recorded for later comparison. No provider key or sportsbook price is needed.</p>
    <p>These are manually selected research records. The app provides no edit/delete action; hashes are not an independent timestamp or protection against an administrator changing data.</p>
    {!owner && <button type="button" className="scanButton" onClick={signIn}>Sign in to save forecasts</button>}
    <div className="correctedModelActions" style={{ flexWrap: 'wrap' }}>
      <button type="button" className="scanButton" disabled={!owner || !playerId || !gameId || busy || recoveryRequired} onClick={() => request(true)}>Calculate & save selected forecast</button>
      <button type="button" className="scanButton" disabled={!owner || busy} onClick={() => request(false)}>Reload saved forecast log</button>
      {page?.nextToken && <button type="button" disabled={busy} onClick={() => request(false, page.nextToken!)}>Next saved forecast page</button>}
    </div>
    {message && <p role="status">{message}</p>}
    {recoveryRequired && <p role="alert">Save outcome is unconfirmed. Reload the log before retrying; use the same player/game. A missing page does not prove no write occurred.</p>}
    {saved && <p>Saved selection {saved.forecast.playerId} · {saved.forecast.gameId}: selected {percent(saved.forecast.probability)}, raw {percent(saved.forecast.rawProbability)}, calibrated {percent(saved.forecast.calibratedProbability)}.</p>}
    {page && <>
      <p>This page contains {page.items.length} saved forecasts. {page.nextToken ? 'More pages exist; export each page separately.' : 'No further page token was returned.'}</p>
      {page.items.map(item => <p key={item.id}>{item.forecast.playerId} · {item.forecast.gameId} · selected {percent(item.forecast.probability)} · raw {percent(item.forecast.rawProbability)} · server submission {new Date(item.savedAt).toLocaleString()}</p>)}
      {download?.page === page && <a href={download.url} download="edgeboard-forward-forecast-page.json">Download saved forecasts and frozen protocol</a>}
      <details><summary>Frozen evaluation protocol and limitations</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(page.protocol, null, 2)}</pre></details>
    </>}
    <ReceivingForwardEvaluation key={owner ?? 'anonymous'} owner={owner} session={session.current!} />
    <p>Betting decision remains HOLD. Forward results do not exist until saved games finish and official outcomes are published.</p>
  </div>;
}
