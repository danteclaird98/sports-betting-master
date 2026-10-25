import { easternKickoff, RECEIVING_SCHEDULE_URL, receivingStatsUrl } from './receivingForecast.ts';
import { forwardHash, type ForwardReceipt } from './receivingForwardCore.ts';
import type { ForwardOutcome, ForwardOutcomeSource } from './receivingForwardEvaluationCore.ts';

const SEASON = 2026;
const STATS_URL = receivingStatsUrl(SEASON);
const SUMMARY_ROOT = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=';
const MAX_GAMES = 8;
const CSV_LIMIT = 16_000_000;
const SUMMARY_LIMIT = 2_000_000;
type RecordRow = Record<string, string>;
type Game = { gameId: string; espn: string; home: string; away: string; homeScore: number; awayScore: number; kickoff: number };
type Finality = { finalStatus: 'FINAL' | 'NOT_FINAL' | 'UNKNOWN'; unresolvedReason?: string };
type Dependencies = { loadText?: (url: string, signal?: AbortSignal) => Promise<string>; now?: () => number; deadlineMs?: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const TEAM_ALIASES: Record<string, string> = { LA:'LAR',STL:'LAR',OAK:'LV',SD:'LAC',WSH:'WAS' };
const normalizeTeam = (value: string) => TEAM_ALIASES[value] ?? value;
const integer = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string' || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
};

type OutcomeFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Canonical evidence URLs only; signed GitHub asset destinations are never returned or stored. */
export function createForwardOutcomeReader(fetcher: OutcomeFetch = (url, init) => fetch(url, init)) {
  return async function publicText(url: string, overallSignal?: AbortSignal) {
    const summary = url.startsWith(SUMMARY_ROOT) && /^\d{6,12}$/.test(url.slice(SUMMARY_ROOT.length));
    if (url !== RECEIVING_SCHEDULE_URL && url !== STATS_URL && !summary) throw Error('OUTCOME_SOURCE_URL_UNSUPPORTED');
    const limit = summary ? SUMMARY_LIMIT : CSV_LIMIT;
    const requestTimeout = AbortSignal.timeout(summary ? 5_000 : 12_000);
    const signal = overallSignal ? AbortSignal.any([overallSignal, requestTimeout]) : requestTimeout;
    signal.throwIfAborted();
    let current = url, redirects = 0;
    let response: Response;
    while (true) {
      signal.throwIfAborted();
      response = await fetcher(current, { redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (url !== STATS_URL || !location || redirects >= 3) throw Error('OUTCOME_SOURCE_REDIRECT_UNSUPPORTED');
      let destination: URL;
      try { destination = new URL(location, current); } catch { throw Error('OUTCOME_SOURCE_REDIRECT_UNSUPPORTED'); }
      if (destination.protocol !== 'https:' || destination.hostname !== 'release-assets.githubusercontent.com'
        || destination.username || destination.password || destination.port || destination.hash
        || !destination.pathname.startsWith('/github-production-release-asset/')
        || destination.pathname === '/github-production-release-asset/') throw Error('OUTCOME_SOURCE_REDIRECT_UNSUPPORTED');
      current = destination.href;
      redirects++;
    }
    if (!response.ok || !response.body) throw Error('OUTCOME_SOURCE_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > limit) throw Error('OUTCOME_SOURCE_TOO_LARGE');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes=0, result='';
    try {
      while (true) {
        signal.throwIfAborted();
        const part=await reader.read();
        if(part.done) break;
        bytes+=part.value.byteLength;
        if(bytes>limit) throw Error('OUTCOME_SOURCE_TOO_LARGE');
        result+=decoder.decode(part.value,{stream:true});
      }
      return result+decoder.decode();
    } finally { await reader.cancel().catch(()=>{}); }
  };
}
const publicText = createForwardOutcomeReader();

function records(text: string, required: string[]): RecordRow[] {
  // Fail closed on truncated quotes or quote characters inside unquoted values.
  // A published numeric field must not become a different value while parsing.
  const parsed: string[][] = [];
  let row: string[] = [], cell = '', state: 'START' | 'BARE' | 'QUOTED' | 'CLOSED' = 'START';
  const endCell = () => { row.push(cell); cell = ''; state = 'START'; };
  const endRow = () => { endCell(); if (row.some(Boolean)) parsed.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'QUOTED') {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else state = 'CLOSED';
      } else cell += char;
      continue;
    }
    if (char === ',') { endCell(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow(); continue;
    }
    if (state === 'CLOSED') throw Error('OUTCOME_SOURCE_SCHEMA_INVALID');
    if (char === '"') {
      if (state !== 'START') throw Error('OUTCOME_SOURCE_SCHEMA_INVALID');
      state = 'QUOTED';
    } else { cell += char; state = 'BARE'; }
  }
  if (state === 'QUOTED') throw Error('OUTCOME_SOURCE_SCHEMA_INVALID');
  if (state !== 'START' || row.length) endRow();
  const [header,...rows]=parsed;
  if(!header || new Set(header).size!==header.length || required.some(key=>!header.includes(key))) throw Error('OUTCOME_SOURCE_SCHEMA_INVALID');
  return rows.map(row=>{
    if(row.length!==header.length) throw Error('OUTCOME_SOURCE_SCHEMA_INVALID');
    return Object.fromEntries(required.map(key=>[key,row[header.indexOf(key)]]));
  });
}

function finality(text: string, game: Game): Finality {
  const unknown = (reason='GAME_COMPLETION_UNVERIFIED'): Finality => ({finalStatus:'UNKNOWN',unresolvedReason:reason});
  let data: unknown;
  try { data=JSON.parse(text); } catch { return unknown('FINAL_SOURCE_SCHEMA_INVALID'); }
  if(!object(data) || !object(data.header)) return unknown('FINAL_SOURCE_SCHEMA_INVALID');
  const header=data.header, season=header.season;
  if(String(header.id)!==game.espn || !object(season) || Number(season.year)!==SEASON || Number(season.type)!==2) return unknown('FINAL_EVENT_IDENTITY_UNVERIFIED');
  if(!Array.isArray(header.competitions) || header.competitions.length!==1 || !object(header.competitions[0])) return unknown('FINAL_EVENT_IDENTITY_UNVERIFIED');
  const competition=header.competitions[0];
  if(String(competition.id)!==game.espn || !Array.isArray(competition.competitors) || competition.competitors.length!==2) return unknown('FINAL_EVENT_IDENTITY_UNVERIFIED');
  const competitors=competition.competitors.filter(object);
  const home=competitors.filter(row=>row.homeAway==='home'),away=competitors.filter(row=>row.homeAway==='away');
  if(home.length!==1 || away.length!==1 || !object(home[0].team) || !object(away[0].team)
    || normalizeTeam(String(home[0].team.abbreviation))!==game.home || normalizeTeam(String(away[0].team.abbreviation))!==game.away
    || Date.parse(String(competition.date ?? header.date))!==game.kickoff) return unknown('FINAL_EVENT_IDENTITY_UNVERIFIED');
  const status=competition.status;
  if(!object(status) || !object(status.type)) return unknown();
  if(status.type.completed!==true || status.type.state!=='post') return {finalStatus:'NOT_FINAL',unresolvedReason:'GAME_NOT_FINAL'};
  if(integer(home[0].score)!==game.homeScore || integer(away[0].score)!==game.awayScore) return unknown('FINAL_SCORE_CONFLICT');
  return {finalStatus:'FINAL'};
}

/** Read-only outcome snapshots. Final summaries are checked before fetching player outcomes. */
export function createReceivingForwardOutcomeLoader(deps: Dependencies = {}) {
  const now=deps.now ?? Date.now, loadText=deps.loadText ?? publicText;
  const deadlineMs=deps.deadlineMs ?? 24_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 24_000) throw Error('OUTCOME_DEADLINE_INVALID');
  return async function load(receipts: ForwardReceipt[], finalGameOffset = 0, evaluationSignal?: AbortSignal): Promise<{outcomes:ForwardOutcome[];source:ForwardOutcomeSource}> {
    if (!Number.isSafeInteger(finalGameOffset) || finalGameOffset < 0 || finalGameOffset > 199) throw Error('INVALID_FINAL_GAME_OFFSET');
    let finalGameWindow: { offset: number; maximum: 8; totalDueGames: number; checked: number; nextOffset: number | null } | undefined;
    const files: ForwardOutcomeSource['files']=[];
    const source = (status: ForwardOutcomeSource['status'], reason?: string): ForwardOutcomeSource => ({
      status,reason,retrievedAt:new Date(now()).toISOString(),files:[...files],publicationClockVerified:false,
      ...(finalGameWindow ? { finalGameWindow } : {}),
    });
    if(!receipts.length) return {outcomes:[],source:source('NOT_REQUESTED','NO_SAVED_FORECASTS')};
    const due=receipts.filter(receipt=>Date.parse(receipt.forecast.kickoffAt)<=now());
    if(!due.length) return {outcomes:[],source:source('NOT_REQUESTED','NO_COMPLETED_GAMES_TO_EVALUATE')};
    const sourceSignal=AbortSignal.timeout(deadlineMs);
    const overallSignal=evaluationSignal ? AbortSignal.any([evaluationSignal,sourceSignal]) : sourceSignal;
    const deadlineAt=performance.now()+deadlineMs;
    const guardDeadline=() => { if(overallSignal.aborted || performance.now()>=deadlineAt) throw Error('OUTCOME_SOURCE_TIMEOUT'); };
    const ids=[...new Set(due.map(receipt=>receipt.forecast.gameId))].sort();
    const windowIds=ids.slice(finalGameOffset,finalGameOffset+MAX_GAMES);
    const selectedIds=new Set(windowIds);
    finalGameWindow={offset:finalGameOffset,maximum:8,totalDueGames:ids.length,checked:windowIds.length,
      nextOffset:finalGameOffset+windowIds.length<ids.length ? finalGameOffset+windowIds.length : null};
    const finals=new Map<string,Finality>(),games=new Map<string,Game>();
    async function read(url: string, limit: number) {
      guardDeadline();
      const text=await new Promise<string>((resolve,reject)=>{
        const abort=()=>reject(Error('OUTCOME_SOURCE_TIMEOUT'));
        overallSignal.addEventListener('abort',abort,{once:true});
        Promise.resolve().then(()=>loadText(url,overallSignal)).then(resolve,reject).finally(()=>overallSignal.removeEventListener('abort',abort));
        if(overallSignal.aborted)abort();
      });
      guardDeadline();
      if(new TextEncoder().encode(text).byteLength>limit) throw Error('OUTCOME_SOURCE_TOO_LARGE');
      const sha256=await forwardHash(text);
      guardDeadline();
      files.push({url,sha256,observedAt:new Date(now()).toISOString()});
      return text;
    }
    try {
      const schedule=records(await read(RECEIVING_SCHEDULE_URL,CSV_LIMIT),['game_id','season','game_type','gameday','gametime','home_team','away_team','home_score','away_score','espn']);
      guardDeadline();
      const toCheck: Game[]=[];
      for(const gameId of ids) {
        if (!selectedIds.has(gameId)) {
          finals.set(gameId,{finalStatus:'UNKNOWN',unresolvedReason:'FINAL_STATUS_CHECK_LIMIT'});continue;
        }
        const matching=schedule.filter(row=>row.game_id===gameId);
        const expected=due.filter(receipt=>receipt.forecast.gameId===gameId);
        const row=matching[0];
        if(matching.length!==1 || !row || Number(row.season)!==SEASON || row.game_type!=='REG' || !/^\d{6,12}$/.test(row.espn)
          || schedule.filter(candidate=>candidate.espn===row.espn && Number(candidate.season)===SEASON && candidate.game_type==='REG').length!==1) {
          finals.set(gameId,{finalStatus:'UNKNOWN',unresolvedReason:'SCHEDULE_IDENTITY_UNVERIFIED'});continue;
        }
        const kickoff=easternKickoff(row.gameday,row.gametime),homeScore=integer(row.home_score),awayScore=integer(row.away_score);
        if(!Number.isFinite(kickoff) || expected.some(receipt=>Date.parse(receipt.forecast.kickoffAt)!==kickoff)
          || !/^[A-Z]{2,3}$/.test(row.home_team) || !/^[A-Z]{2,3}$/.test(row.away_team) || normalizeTeam(row.home_team)===normalizeTeam(row.away_team)) {
          finals.set(gameId,{finalStatus:'UNKNOWN',unresolvedReason:'SCHEDULE_IDENTITY_UNVERIFIED'});continue;
        }
        if(homeScore===null || awayScore===null || homeScore<0 || awayScore<0) {
          finals.set(gameId,{finalStatus:'UNKNOWN',unresolvedReason:'GAME_COMPLETION_UNVERIFIED'});continue;
        }
        const game={gameId,espn:row.espn,home:normalizeTeam(row.home_team),away:normalizeTeam(row.away_team),homeScore,awayScore,kickoff};
        games.set(gameId,game);
        toCheck.push(game);
      }
      for(let start=0;start<toCheck.length;start+=4) {
        await Promise.all(toCheck.slice(start,start+4).map(async game=>{
          try { finals.set(game.gameId,finality(await read(SUMMARY_ROOT+game.espn,SUMMARY_LIMIT),game)); }
          catch { finals.set(game.gameId,{finalStatus:'UNKNOWN',unresolvedReason:'FINAL_SOURCE_UNAVAILABLE'}); }
        }));
      }
      // Only now can this outcomes snapshot be observed after the final-status evidence.
      const stats=records(await read(STATS_URL,CSV_LIMIT),['player_id','game_id','season','season_type','position','team','receiving_yards']);
      guardDeadline();
      const keys=new Set(receipts.map(receipt=>JSON.stringify([receipt.forecast.playerId,receipt.forecast.gameId])));
      const outcomes: ForwardOutcome[]=stats.filter(row=>keys.has(JSON.stringify([row.player_id,row.game_id]))).map(row=>{
        let status=finals.get(row.game_id) ?? {finalStatus:'NOT_FINAL' as const,unresolvedReason:'GAME_NOT_FINAL'};
        const game=games.get(row.game_id);
        if(Number(row.season)!==SEASON) status={finalStatus:'UNKNOWN',unresolvedReason:'OUTCOME_SEASON_UNVERIFIED'};
        else if(game && ![game.home,game.away].includes(normalizeTeam(row.team))) status={finalStatus:'UNKNOWN',unresolvedReason:'PLAYER_TEAM_SCHEDULE_MISMATCH'};
        return {playerId:row.player_id,gameId:row.game_id,seasonType:row.season_type,position:row.position,receivingYards:integer(row.receiving_yards),...status};
      });
      guardDeadline();
      return {outcomes,source:source('AVAILABLE',windowIds.length<ids.length ? 'BOUNDED_FINAL_STATUS_EVIDENCE' : undefined)};
    } catch (failure) {
      const reason = overallSignal.aborted ? 'OUTCOME_SOURCE_TIMEOUT' : failure instanceof Error && ['OUTCOME_SOURCE_URL_UNSUPPORTED', 'OUTCOME_SOURCE_REDIRECT_UNSUPPORTED', 'OUTCOME_SOURCE_TOO_LARGE', 'OUTCOME_SOURCE_SCHEMA_INVALID', 'OUTCOME_SOURCE_TIMEOUT'].includes(failure.message) ? failure.message : 'OUTCOME_SOURCE_UNAVAILABLE';
      return {outcomes:[],source:source('UNAVAILABLE',reason)};
    }
  };
}

export const loadReceivingForwardOutcomes = createReceivingForwardOutcomeLoader();
