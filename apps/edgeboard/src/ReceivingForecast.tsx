import { useEffect, useRef, useState } from 'react';
import { api } from '../../../runtime/client.ts';
import ReceivingForwardLog from './ReceivingForwardLog';
import { receivingGuidance } from '../shared/receivingBlockers';

type Player = { playerId: string; name: string; position: string; team: string; priorGames: number; latestSeason: number; latestWeek: number };
type Game = { gameId: string; kickoffAt: string; homeTeam: string; awayTeam: string };
type Source = Record<string, unknown> & { retrievedAt: string; season: number };
type Options = { calculationStatus: 'AVAILABLE' | 'DATA_UNAVAILABLE'; reason: string; players: Player[]; games: Game[]; source: Source };
type Forecast = {
  calculationStatus: 'CALCULATED' | 'BLOCKED'; probability: number | null;
  rawProbability?: number; calibratedProbability?: number;
  bettingDecision: 'HOLD'; liveApproved: false; verifiedPositiveEv: false; executionEnabled: false;
  reason: string; blockers: string[]; playerId?: string; gameId?: string;
  sourceReceipt?: unknown; modelVersion?: string; artifactSha256?: string;
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const timestamp = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Source request failed. Try loading again.';
const displayTime = (value: string) => new Date(value).toLocaleString();
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

function validOptions(value: unknown): value is Options {
  if (!object(value) || !['AVAILABLE', 'DATA_UNAVAILABLE'].includes(String(value.calculationStatus))
    || !text(value.reason) || !Array.isArray(value.players) || !Array.isArray(value.games)
    || !object(value.source) || !timestamp(value.source.retrievedAt) || !integer(value.source.season)) return false;
  if (!value.players.every(player => object(player)
    && ['playerId', 'name', 'position', 'team'].every(key => text(player[key]))
    && integer(player.priorGames) && integer(player.latestSeason) && integer(player.latestWeek))) return false;
  if (!value.games.every(game => object(game)
    && ['gameId', 'homeTeam', 'awayTeam'].every(key => text(game[key])) && timestamp(game.kickoffAt))) return false;
  if (new Set(value.players.map(player => player.playerId)).size !== value.players.length
    || new Set(value.games.map(game => game.gameId)).size !== value.games.length) return false;
  return value.calculationStatus !== 'AVAILABLE' || (value.players.length > 0 && value.games.length > 0);
}

function validForecast(value: unknown, playerId: string, gameId: string): value is Forecast {
  if (!object(value) || !['CALCULATED', 'BLOCKED'].includes(String(value.calculationStatus))
    || value.bettingDecision !== 'HOLD' || value.liveApproved !== false || value.verifiedPositiveEv !== false
    || value.executionEnabled !== false || (value.productionEnabled !== undefined && value.productionEnabled !== false)
    || !text(value.reason) || !Array.isArray(value.blockers)
    || value.blockers.length === 0 || !value.blockers.every(text)) return false;
  // A receipt for a different selection must never be displayed as the current forecast.
  if ((value.playerId !== undefined && value.playerId !== playerId) || (value.gameId !== undefined && value.gameId !== gameId)) return false;
  if (value.rawProbability !== undefined && !probability(value.rawProbability)) return false;
  if (value.calibratedProbability !== undefined && !probability(value.calibratedProbability)) return false;
  if (value.artifactSha256 !== undefined && (typeof value.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.artifactSha256))) return false;
  if (value.modelVersion !== undefined && !text(value.modelVersion)) return false;
  return value.calculationStatus === 'BLOCKED' ? value.probability === null
    : probability(value.probability) && value.playerId === playerId && value.gameId === gameId;
}

function SourceDetails({ source }: { source: Source }) {
  const ageHours = Math.max(0, (Date.now() - Date.parse(source.retrievedAt)) / 3_600_000);
  return <details className="correctedScoreReceipt">
    <summary>Source receipt · season {source.season} · retrieved {displayTime(source.retrievedAt)}</summary>
    <p>Retrieved {ageHours < 1 ? 'less than one hour' : `${Math.floor(ageHours)} hours`} ago. Retrieval time is separate from the latest game observed for each player. Data loads only when requested.</p>
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(source, null, 2)}</pre>
  </details>;
}

function ReasonNotice({ code }: { code: string }) {
  const guidance = receivingGuidance(code);
  return <div className="correctedCaution" role="status">
    <strong>{guidance.title}</strong>
    <p>{guidance.explanation}</p>
    <p><strong>Next step:</strong> {guidance.nextStep}</p>
    <small>Evidence code: <code>{code}</code></small>
  </div>;
}

export default function ReceivingForecast() {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Options | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [gameId, setGameId] = useState('');
  const [receipt, setReceipt] = useState<Forecast | null>(null);
  const [download, setDownload] = useState<{ receipt: Forecast; url: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    if (!receipt || receipt.calculationStatus !== 'CALCULATED') { setDownload(null); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
    setDownload({ receipt, url });
    return () => URL.revokeObjectURL(url);
  }, [receipt]);
  const selectedPlayer = options?.players.find(player => player.playerId === playerId);
  const futureGames = (options?.games.filter(game => selectedPlayer
    && (game.homeTeam === selectedPlayer.team || game.awayTeam === selectedPlayer.team)
    && Date.parse(game.kickoffAt) > Date.now()) ?? [])
    .sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt)).slice(0, 1);
  const selectedGame = futureGames.find(game => game.gameId === gameId);

  function invalidate() {
    generation.current += 1;
    setReceipt(null);
    setError('');
  }

  async function load() {
    const request = ++generation.current;
    setBusy(true); setReceipt(null); setError(''); setOptions(null); setPlayerId(''); setGameId('');
    try {
      const response = await api.get(`/api/receiving-forecast-options?query=${encodeURIComponent(query.trim())}`);
      if (request !== generation.current) return;
      if (!validOptions(response.data)) throw new Error('The source response could not be verified. No player list or probability is available. Reload the source or inspect the model audit.');
      setOptions(response.data);
    } catch (error) {
      if (request === generation.current) setError(errorMessage(error));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  async function calculate() {
    setReceipt(null); setError('');
    if (!selectedPlayer || !selectedGame || options?.calculationStatus !== 'AVAILABLE') {
      setError('Load sources and select a player and an upcoming game first.'); return;
    }
    if (Date.parse(selectedGame.kickoffAt) <= Date.now()) {
      setError('This game has already started. Load sources again and choose an upcoming game.'); return;
    }
    const requestedPlayer = playerId;
    const requestedGame = gameId;
    const request = ++generation.current;
    setBusy(true);
    try {
      const response = await api.post('/api/receiving-forecast', { playerId: requestedPlayer, gameId: requestedGame });
      if (request !== generation.current) return;
      if (!validForecast(response.data, requestedPlayer, requestedGame)) throw new Error('The forecast response could not be verified. No probability is available. Reload sources and try again.');
      setReceipt(response.data);
    } catch (error) {
      if (request === generation.current) setError(errorMessage(error));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  return <section className="panel lab correctedReceivingPanel" id="receiving-forecast" aria-busy={busy}>
    <div className="correctedModelHeading"><h2>Receiving yards forecast</h2><span className="correctedHold">Independent of odds</span></div>
    <p>Estimate the chance of at least 60 receiving yards from real, prior game history. Select a player and the next scheduled game for their latest observed team; EdgeBoard retrieves the history without requiring pasted JSON. This estimates the chance conditional on recorded participation and does not establish that the player will play.</p>
    <p className="correctedCaution">A calculated probability is a research estimate. Betting approval, a verified price edge and execution are separate checks. Loading this workspace does not authorize paid provider requests.</p>
    <div className="correctedModelActions" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
      <label style={{ display: 'grid', gap: 6 }}>Player name (optional)
        <input value={query} disabled={busy} maxLength={80} placeholder="Search source-backed players" onChange={event => { invalidate(); setQuery(event.target.value); setOptions(null); setPlayerId(''); setGameId(''); }} />
      </label>
      <button className="scanButton" type="button" disabled={busy} onClick={load}>{busy ? 'Working…' : 'Load source-backed players & games'}</button>
    </div>
    {error && <p className="correctedModelError" role="alert">{error}</p>}
    {options && <>
      <ReasonNotice code={options.reason} />
      <SourceDetails source={options.source} />
      {options.calculationStatus === 'DATA_UNAVAILABLE' && <p className="correctedCaution">No forecast was calculated. Follow the reason-specific next step above. The model audit below remains available; reloading source data does not complete model validation or grant betting approval.</p>}
      {options.calculationStatus === 'AVAILABLE' && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 16, margin: '16px 0' }}>
          <label style={{ display: 'grid', gap: 6 }}>Player
            <select value={playerId} disabled={busy} onChange={event => { invalidate(); setPlayerId(event.target.value); setGameId(''); }} style={{ width: '100%', minWidth: 0 }}>
              <option value="">Select a real player</option>
              {options.players.map(player => <option key={player.playerId} value={player.playerId}>{player.name} · {player.position} · {player.team}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>Next fixture for the observed team
            <select value={gameId} disabled={busy || !selectedPlayer} onChange={event => { invalidate(); setGameId(event.target.value); }} style={{ width: '100%', minWidth: 0 }}>
              <option value="">Select an upcoming game</option>
              {futureGames.map(game => <option key={game.gameId} value={game.gameId}>{game.awayTeam} at {game.homeTeam} · {displayTime(game.kickoffAt)}</option>)}
            </select>
          </label>
        </div>
        {selectedPlayer && <p>Latest observed game: {selectedPlayer.latestSeason}, week {selectedPlayer.latestWeek}. Available prior games: {selectedPlayer.priorGames}. The server checks the latest observed team against the next fixture; current roster membership and participation are unverified.</p>}
        {selectedPlayer && futureGames.length === 0 && <p role="status">No next future fixture is available for this player’s observed team. Load sources again to refresh the available games.</p>}
        <button className="scanButton" type="button" onClick={calculate} disabled={busy || !selectedPlayer || !selectedGame || Date.parse(selectedGame.kickoffAt) <= Date.now()}>Calculate conditional forecast</button>
      </>}
    </>}
    {receipt && <div className="correctedScoreReceipt" role="status">
      {receipt.calculationStatus === 'CALCULATED' && receipt.probability !== null
        ? <><h3>Forecast calculated · {percentage(receipt.probability)}</h3><p>{selectedPlayer?.name}: probability of at least 60 receiving yards in {selectedGame?.awayTeam} at {selectedGame?.homeTeam}, conditional on recorded participation. Current roster membership and participation remain unverified.</p>
          {receipt.rawProbability !== undefined && <p>Raw model: {percentage(receipt.rawProbability)}{receipt.calibratedProbability !== undefined ? ` · Calibrated: ${percentage(receipt.calibratedProbability)}` : ''}.</p>}</>
        : <h3>Forecast unavailable</h3>}
      {receipt.calculationStatus === 'CALCULATED' && download?.receipt === receipt && <>
        <a className="correctedAuditDownload" href={download.url} download="edgeboard-receiving60-forecast-receipt.json">Download forecast receipt JSON</a>
        <p>Exported local copy of this calculation’s full server receipt. This download is not proof of an immutable publication before kickoff.</p>
      </>}
      <ReasonNotice code={receipt.reason} />
      <h4>Betting decision: HOLD</h4><p>Betting approval is unavailable. No verified positive edge or execution approval.</p>
      <ul>{receipt.blockers.map((blocker, index) => {
        const guidance = receivingGuidance(blocker);
        return <li key={`${index}-${blocker}`}>
          <strong>{guidance.title}</strong>
          <p>{guidance.explanation}</p>
          <p><strong>Next step:</strong> {guidance.nextStep}</p>
          <small>Evidence code: <code>{blocker}</code></small>
        </li>;
      })}</ul>
      {(receipt.sourceReceipt !== undefined || receipt.artifactSha256 || receipt.modelVersion) && <details><summary>Calculation receipt</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto', fontSize: 12 }}>{JSON.stringify({ playerId: receipt.playerId, gameId: receipt.gameId, modelVersion: receipt.modelVersion, artifactSha256: receipt.artifactSha256, source: receipt.sourceReceipt }, null, 2)}</pre></details>}
    </div>}
    <ReceivingForwardLog playerId={playerId} gameId={gameId} />
  </section>;
}

