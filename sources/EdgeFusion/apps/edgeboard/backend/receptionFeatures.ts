import { csvRows } from './historicalNfl';
import type { LiveGame, LivePlayer } from './liveTypes';

type Historical = { id: string; team: string; opponent: string; game: string; kickoff: number;
  catches: number; targets: number; snaps: number; share: number; position: string };
type Data = { records: Historical[]; espnToGsis: Map<string,string>; retrievedAt: string; sources: string[]; unmappedRows: number };
let cached: { season: number; expires: number; promise: Promise<Data> } | null = null;
const BASE = 'https://github.com/nflverse/nflverse-data/releases/download/';
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const normalizeTeam = (team: string) => ({ WSH: 'WAS', LAR: 'LA' }[team] ?? team);
const number = (value: string) => value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
function easternTime(day: string, time: string) {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month-1, date, hour, minute);
  let guess = desired;
  for (let i=0;i<2;i++) {
    const parts = Object.fromEntries(eastern.formatToParts(new Date(guess)).map(part => [part.type,part.value]));
    guess += desired-Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute));
  }
  return guess;
}
async function csv(path: string) {
  const response = await fetch(BASE+path, { signal: AbortSignal.timeout(18_000) });
  if (!response.ok) throw Error('Historical usage source unavailable: '+path+' HTTP '+response.status);
  const content = await response.text();
  if (content.length > 15_000_000) throw Error('Historical usage source exceeded its size limit.');
  const [headers,...data] = csvRows(content);
  if (!headers || !data.length) throw Error('Historical usage source returned no data: '+path);
  return { data, index: (name: string) => { const i=headers.indexOf(name); if (i<0) throw Error('Missing historical column '+name); return i; } };
}
async function load(season: number): Promise<Data> {
  const years = [season-1,season];
  const paths = ['players/players.csv','schedules/games.csv',
    ...years.map(year => 'stats_player/stats_player_week_'+year+'.csv'),
    ...years.map(year => 'snap_counts/snap_counts_'+year+'.csv')];
  const [players, schedule, ...seasons] = await Promise.all(paths.map(csv));
  const pfrToGsis = new Map<string,string>();
  const espnToGsis = new Map<string,string>();
  const ambiguous = new Set<string>();
  for (const row of players.data) {
    const id=row[players.index('gsis_id')];
    if (!id) continue;
    const pfr=row[players.index('pfr_id')];
    if (pfr) {
      if (pfrToGsis.has(pfr) && pfrToGsis.get(pfr)!==id) ambiguous.add(pfr);
      pfrToGsis.set(pfr,id);
    }
    const espn=number(row[players.index('espn_id')]);
    if (espn!==null) {
      const key=String(espn);
      if (espnToGsis.has(key) && espnToGsis.get(key)!==id) throw Error('Ambiguous ESPN-to-GSIS player identity.');
      espnToGsis.set(key,id);
    }
  }
  for (const id of ambiguous) pfrToGsis.delete(id);
  const dates = new Map<string,number>();
  for (const row of schedule.data) {
    const day=row[schedule.index('gameday')], time=row[schedule.index('gametime')];
    if (!day || !time) continue;
    dates.set(row[schedule.index('game_id')],easternTime(day,time));
  }
  const stats = new Map<string,{ catches:number; targets:number }>();
  const teamGames = new Set<string>();
  for (const table of seasons.slice(0,2)) {
    for (const row of table.data) {
      if (row[table.index('season_type')]!=='REG') continue;
      const game=row[table.index('game_id')], id=row[table.index('player_id')], team=row[table.index('team')];
      const catches=number(row[table.index('receptions')]), targets=number(row[table.index('targets')]);
      teamGames.add(game+'|'+team);
      if (catches===null || targets===null) continue;
      const key=game+'|'+team+'|'+id;
      if (stats.has(key)) throw Error('Duplicate player-game statistical identity.');
      stats.set(key,{ catches,targets });
    }
  }
  const records: Historical[]=[];
  const seen=new Set<string>();
  let unmappedRows=0;
  for (const table of seasons.slice(2)) {
    for (const row of table.data) {
      const position=row[table.index('position')];
      const snaps=number(row[table.index('offense_snaps')]);
      if (row[table.index('game_type')]!=='REG' || !['WR','TE','RB','FB'].includes(position) || snaps===null || snaps<=0) continue;
      const id=pfrToGsis.get(row[table.index('pfr_player_id')]);
      if (!id) { unmappedRows++; continue; }
      const game=row[table.index('game_id')], team=row[table.index('team')];
      const kickoff=dates.get(game), share=number(row[table.index('offense_pct')]);
      if (kickoff===undefined || share===null || !teamGames.has(game+'|'+team)) continue;
      const production=stats.get(game+'|'+team+'|'+id) ?? { catches:0,targets:0 };
      const key=game+'|'+id;
      if (seen.has(key)) throw Error('Duplicate historical snap identity.');
      seen.add(key);
      records.push({ id,team,opponent:row[table.index('opponent')],game,kickoff,
        catches:production.catches,targets:production.targets,snaps,share,position:position==='FB'?'RB':position });
    }
  }
  return { records,espnToGsis,retrievedAt:new Date().toISOString(),sources:paths.map(path=>BASE+path),unmappedRows };
}
export async function receptionFeatures(game: LiveGame, player: LivePlayer, now=Date.now()) {
  if (!Number.isInteger(game.season) || game.season<2024 || game.season>new Date().getUTCFullYear()+1) throw Error('Unverified game season.');
  if (!cached || cached.season!==game.season || cached.expires<now) {
    const promise=load(game.season).catch(error=>{ cached=null; throw error; });
    cached={ season:game.season,expires:now+3_600_000,promise };
  }
  const data=await cached.promise;
  const id=data.espnToGsis.get(player.espnId);
  if (!id) throw Error('No stable ESPN-to-GSIS identity for this player.');
  // Even at halftime the baseline must use inputs available before kickoff.
  const cutoff=Math.min(now,Date.parse(game.startTime));
  const past=data.records.filter(row=>row.kickoff+30*3_600_000<cutoff && row.kickoff>cutoff-400*86_400_000);
  const own=past.filter(row=>row.id===id).sort((a,b)=>a.kickoff-b.kickoff).slice(-8);
  if (own.length!==8) throw Error('Eight prior player games within 400 days are required.');
  const team=normalizeTeam(player.team);
  if (own.some(row=>row.team!==team)) throw Error('Recent team change requires a separate role model.');
  if (Math.floor((Date.parse(game.startTime)-own[7].kickoff)/86_400_000)>45) throw Error('Player history is stale after a long absence or offseason.');
  const home=player.teamId===game.home.id;
  if (!home && player.teamId!==game.away.id) throw Error('Player team does not belong to this game.');
  const opponent=normalizeTeam(home?game.away.abbreviation:game.home.abbreviation);
  const allowed=new Map<string,{ date:number; catches:number }>();
  for (const row of past.filter(row=>row.opponent===opponent)) {
    const entry=allowed.get(row.game) ?? { date:row.kickoff,catches:0 };
    entry.catches+=row.catches; allowed.set(row.game,entry);
  }
  const defense=[...allowed.values()].sort((a,b)=>a.date-b.date).slice(-8);
  if (defense.length<4) throw Error('Four prior opponent games are required.');
  const last3=own.slice(-3);
  const mean=(values:Historical[],field:'catches'|'targets'|'snaps'|'share')=>values.reduce((sum,row)=>sum+row[field],0)/values.length;
  const count=(field:'catches'|'targets')=>own.reduce((sum,row)=>sum+row[field],0);
  const features=[Math.log1p(mean(last3,'catches')),Math.log1p(mean(own,'catches')),
    Math.log1p(mean(last3,'targets')),Math.log1p(mean(own,'targets')),(count('catches')+2)/(count('targets')+3),
    mean(last3,'share'),mean(own,'share'),Math.log1p(mean(last3,'snaps')),
    defense.reduce((sum,row)=>sum+row.catches,0)/defense.length,
    Math.min(21,(Date.parse(game.startTime)-own[7].kickoff)/86_400_000),Number(home),Number(own[7].position==='WR'),Number(own[7].position==='TE')];
  return { gsisId:id,features,historyGames:8,retrievedAt:data.retrievedAt,sourceUrls:data.sources,
    inputCutoff:new Date(cutoff).toISOString(),inputPublicationTimesVerified:false,
    inputDelayAssumptionHours:30,unmappedRowsExcluded:data.unmappedRows };
}
