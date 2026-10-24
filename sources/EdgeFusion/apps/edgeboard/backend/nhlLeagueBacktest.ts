import { evaluateNhlShots, type NhlGame } from './nhlShotsBacktest';

// Full-league retrospective model. NHL skater summary caps unfiltered results at 10,000.
// Query complete disjoint game-date windows and reject/trisect capped responses.
type Raw = {
  playerId?: number; gameId?: number; gameDate?: string;
  positionCode?: string; teamAbbrev?: string;
  shots?: number; timeOnIcePerGame?: number; homeRoad?: string;
};
const seasons = [20222023, 20232024, 20242025, 20252026];
type Data = { rows: NhlGame[]; sources: string[]; partitions: Array<{season:number;from:string;to:string;rows:number}>;
  teamsBySeason: Record<string,number>; rejected: number; fetchedAt: string };
let cache: Promise<Data> | null = null;
let resultCache: {at:number; report:unknown} | null = null;
const historicalPredictionCache=new Map<number,Promise<Map<string,{probability:number;outcome:number}>>>();

function nextMonth(date:string) {
  const [year,month]=date.slice(0,7).split('-').map(Number);
  const next = new Date(Date.UTC(year,month,1));
  return next.toISOString().slice(0,10);
}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function fetchRange(season:number, from:string, to:string, depth=0):
  Promise<{data:Raw[];urls:string[];parts:Array<{season:number;from:string;to:string;rows:number}>}> {
  const exp = 'seasonId='+season+' and gameTypeId=2 and gameDate>=\''+from+'\' and gameDate<\''+to+'\'';
  const args = new URLSearchParams({isAggregate:'false',isGame:'true',start:'0',limit:'-1',cayenneExp:exp});
  const url = 'https://api.nhle.com/stats/rest/en/skater/summary?'+args.toString();
  let response: Response | undefined;
  for(let attempt=0;attempt<3;attempt++) {
    try {
      response = await fetch(url,{signal:AbortSignal.timeout(22000)});
      if(response.ok) break;
      if(response.status!==429&&response.status<500) throw Error('NHL HTTP '+response.status);
    } catch(e) {
      if(attempt===2) throw e;
    }
    if(attempt===2) throw Error('NHL stats HTTP '+response?.status);
    await sleep(350*(attempt+1));
  }
  if(!response?.ok) throw Error('NHL window request failed '+season+' '+from);
  const json = await response.json() as {total?:number;data?:Raw[]};
  if(!Array.isArray(json.data)||typeof json.total!=='number'||json.data.length!==json.total)
    throw Error('NHL incomplete response: '+season+' '+from+' — '+to);
  if(json.total>=10000) {
    if(depth>=5) throw Error('Official NHL 10k cap cannot be split further: '+from+' '+to);
    const left=Date.parse(from+'T00:00:00Z'),right=Date.parse(to+'T00:00:00Z');
    const halfway = new Date(Math.floor((left+right)/2/86400000)*86400000).toISOString().slice(0,10);
    if(halfway<=from||halfway>=to) throw Error('NHL source capped even after date subdivision.');
    const sections=await Promise.all([fetchRange(season,from,halfway,depth+1),fetchRange(season,halfway,to,depth+1)]);
    return {data:sections.flatMap(s=>s.data),urls:sections.flatMap(s=>s.urls),parts:sections.flatMap(s=>s.parts)};
  }
  if(json.data.some(r=>!r.gameDate||r.gameDate<from||r.gameDate>=to))
    throw Error('NHL date filters ignored: '+from+' '+to);
  return {data:json.data,urls:[url],parts:[{season,from,to,rows:json.total}]};
}
async function download(): Promise<Data> {
  const rows:NhlGame[]=[],sources:string[]=[],partitions:Data['partitions']=[];
  const teamsBySeason:Record<string,Set<string>>={};
  const keys=new Set<string>();
  let rejected=0;
  for(const season of seasons) {
    const year=Math.floor(season/10000);
    let cursor=year+'-10-01';
    const windows:Array<[string,string]>=[];
    const end=year+1+'-05-01';
    while(cursor<end){const to=nextMonth(cursor);windows.push([cursor,to]);cursor=to;}
    const chunks=await Promise.all(windows.map(([from,to])=>fetchRange(season,from,to)));
    const teamSet=teamsBySeason[String(season)]??=new Set();
    for(const chunk of chunks) {
      sources.push(...chunk.urls); partitions.push(...chunk.parts);
      for(const row of chunk.data) {
        const {playerId,gameId,gameDate,shots,timeOnIcePerGame,teamAbbrev,positionCode,homeRoad}=row;
        if(!Number.isInteger(playerId)||!Number.isInteger(gameId)||!Number.isInteger(shots)||
          !Number.isFinite(timeOnIcePerGame)||(shots as number)<0||(shots as number)>20||
          (timeOnIcePerGame as number)<60||(timeOnIcePerGame as number)>2400||
          typeof gameDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)||
          Number(gameDate.slice(0,4))<year||Number(gameDate.slice(0,4))>year+1||
          String(gameId).slice(0,4)!==String(season).slice(0,4)||
          !teamAbbrev||!['C','L','R','D'].includes(positionCode??'')||
          !['H','R'].includes(homeRoad??'')) {rejected++;continue;}
        const key=playerId+'|'+gameId;
        if(keys.has(key)) throw Error('NHL duplicate player-game: '+key);
        keys.add(key);teamSet.add(teamAbbrev as string);
        rows.push({player:playerId as number,game:gameId as number,date:gameDate,
          season,team:teamAbbrev as string,shots:shots as number,toi:timeOnIcePerGame as number,
          home:homeRoad==='H',defense:positionCode==='D'});
      }
    }
    if(teamSet.size!==32) throw Error('NHL incomplete league coverage '+season+': '+teamSet.size+'/32 teams');
  }
  const coverage=Object.fromEntries(Object.entries(teamsBySeason).map(([k,v])=>[k,v.size]));
  if(rows.length<140000||rejected>rows.length/100)
    throw Error('NHL incomplete or malformed league-wide games: '+rows.length+' rows, '+rejected+' exclusions');
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.game-b.game||a.player-b.player);
  return {rows,sources,partitions,teamsBySeason:coverage,rejected,fetchedAt:new Date().toISOString()};
}
export async function getNhlHistoricalPredictions(gameId:number) {
  if(String(gameId).slice(0,6)!=='202502') throw Error('Held-out price audit supports 2025-26 only.');
  const previous=historicalPredictionCache.get(gameId);
  if(previous) return previous;
  const task=(async()=>{
    if(!cache) cache=download().catch(e=>{cache=null;throw e;});
    const d=await cache;
    const predictions=new Map<string,{probability:number;outcome:number}>();
    for(const threshold of [2,3]) {
      const result=evaluateNhlShots(d.rows,threshold,{trainingCap:22000,iterations:115,bootstrapRuns:1,includeHeldoutPredictions:true});
      for(const p of result.heldoutPredictions??[]) if(p.gameId===gameId)
        predictions.set(p.playerId+'|'+(threshold-0.5),{probability:p.probability,outcome:p.outcome});
    }
    return predictions;
  })();
  historicalPredictionCache.set(gameId,task);
  try{return await task;}catch(e){historicalPredictionCache.delete(gameId);throw e;}
}
export async function nhlLeagueBacktest() {
  if(resultCache&&Date.now()-resultCache.at<1800000) return resultCache.report;
  if(!cache) cache=download().catch(e=>{cache=null;throw e;});
  const data=await cache;
  const settings={trainingCap:22000,iterations:115,bootstrapRuns:200};
  const report={
    status:'HISTORICAL_RESEARCH_ONLY',liveApproved:false,verifiedPositiveEv:false,recommendation:'HOLD',
    modelVersion:'nhl-sog-leaguewide-retrospective-v1',
    source:{provider:'Official NHL Stats REST API',gameRows:data.rows.length,
      uniquePlayers:new Set(data.rows.map(r=>r.player)).size,
      gameCount:new Set(data.rows.map(r=>r.game)).size,
      fetchedAt:data.fetchedAt,months:data.partitions.length,
      completeMonthlyCountsVerified:true,seasonTeamCoverage:data.teamsBySeason,
      rejectedRows:data.rejected,requestUrls:data.sources},
    design:'League-wide regular season. 2022–24 training, 2024–25 validation for model selection, untouched 2025–26 test. Training limited to 22,000 deterministic evenly spaced historical observations for bounded compute. Outcomes use earlier game data only.',
    markets:[evaluateNhlShots(data.rows,2,settings),evaluateNhlShots(data.rows,3,settings)],
    blockers:[
      'Retrospective final game logs do not establish original point-in-time data vintages.',
      'Player appearances only: inactive players and pregame scratch selection not modeled.',
      'Expected ice time, lineup changes, injured teammates, and projected lines are missing.',
      'Unmatched historical book quotes: no demonstrated sportsbook EV, ROI or calibration versus the closing market.',
      'Game-level bootstrap is aggregate forecast comparison, not per-player probability uncertainty.',
      'No validated same-game parlay joint probability or automatic wagers.'
    ]
  };
  resultCache={at:Date.now(),report};
  return report;
}
