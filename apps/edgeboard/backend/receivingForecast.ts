/** Source-backed conditional research forecasts. Never grants betting/execution approval. */
import artifact from './correctedReceivingArtifact.json' with {type:'json'};
import manifest from './correctedReceivingManifest.json' with {type:'json'};
import installedSeed from './receivingHistorySeed.json' with {type:'json'};
import {canonicalJson,correctedReceivingReadiness} from './correctedReceiving.ts';
import {csvRows} from './historicalNfl.ts';

export const RECEIVING_SCHEDULE_URL='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
export const receivingStatsUrl=(year:number)=>`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`;
const SEED_SHA='995a1f266c0bfba209b12f4d3bfb80641f42af99e8de5cc3aca82add66bcfe3c';
const SEASON=2026, TTL=10*60*1000, LIMIT=16_000_000;
const FLAGS={bettingDecision:'HOLD',liveApproved:false,verifiedPositiveEv:false,executionEnabled:false,
  modelVersion:artifact.version,artifactSha256:manifest.sourceArtifactSha256,scope:'CONDITIONAL_RECORDED_PLAYER_RECEIVING_60_PLUS'} as const;
const LIMITATIONS=['FORWARD_VALIDATION_REQUIRED','ROSTER_PARTICIPATION_UNVERIFIED','NO_EXECUTABLE_MARKET_PRICE_OR_EV','HISTORICAL_PUBLICATION_CLOCKS_UNPROVEN'];
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(value);
const team=(value:string)=>({LA:'LAR',STL:'LAR',OAK:'LV',SD:'LAC',WSH:'WAS'}[value]??value);
function fail(reason:string):never {throw Error(reason);}
const sha=async(text:string)=>[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const sigmoid=(z:number)=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));

/** nfldata documents gametime as Eastern. Match timezone parts, including DST, without local-time guesses. */
export function easternKickoff(day:string,clock:string):number {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(clock)) return NaN;
  const [y,m,d]=day.split('-').map(Number),[h,min]=clock.split(':').map(Number);
  const naive=Date.UTC(y,m-1,d,h,min);
  if(h>23||min>59||new Date(naive).toISOString().slice(0,10)!==day)return NaN;
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const matches=[4,5].map(offset=>naive+offset*3600000).filter(value=>{
    const p=Object.fromEntries(fmt.formatToParts(value).map(v=>[v.type,v.value]));
    return `${p.year}-${p.month}-${p.day}`===day&&`${p.hour}:${p.minute}`===clock;
  });
  return matches.length===1?matches[0]:NaN;
}
type ForecastFetch = (url:string,init:RequestInit)=>Promise<Response>;

/** Only fixed public evidence URLs; allow GitHub's signed release asset hop, never arbitrary redirects. */
export function createForecastReader(fetcher:ForecastFetch=(url,init)=>fetch(url,init)) {
  return async function publicText(url:string):Promise<string>{
    if(url!==RECEIVING_SCHEDULE_URL && ![2021,2022,2023,2024,2025,2026].some(year=>url===receivingStatsUrl(year)))fail('PUBLIC_SOURCE_URL_UNSUPPORTED');
    const signal=AbortSignal.timeout(20_000);
    let current=url,redirects=0,response:Response;
    while(true){
      signal.throwIfAborted();
      response=await fetcher(current,{signal,redirect:'manual'});
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('location');
      await response.body?.cancel().catch(()=>{});
      if(url===RECEIVING_SCHEDULE_URL||!location||redirects>=3)fail('PUBLIC_SOURCE_REDIRECT_UNSUPPORTED');
      let destination:URL;
      try{destination=new URL(location,current);}catch{fail('PUBLIC_SOURCE_REDIRECT_UNSUPPORTED');}
      if(destination.protocol!=='https:'||destination.hostname!=='release-assets.githubusercontent.com'
        ||destination.username||destination.password||destination.port||destination.hash
        ||!destination.pathname.startsWith('/github-production-release-asset/')
        ||destination.pathname==='/github-production-release-asset/')fail('PUBLIC_SOURCE_REDIRECT_UNSUPPORTED');
      current=destination.href;redirects++;
    }
    if(!response.ok){await response.body?.cancel().catch(()=>{});fail(`PUBLIC_SOURCE_HTTP_${response.status}`);}
    if(Number(response.headers.get('content-length'))>LIMIT){await response.body?.cancel().catch(()=>{});fail('PUBLIC_SOURCE_TOO_LARGE');}
    if(!response.body)fail('PUBLIC_SOURCE_EMPTY_BODY');
    const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
    try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>LIMIT)fail('PUBLIC_SOURCE_TOO_LARGE');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});}
    return text;
  };
}
const publicText=createForecastReader();
function records(text:string,required:string[]):Record<string,string>[] {
  const [headers,...rows]=csvRows(text);
  if(!headers||required.some(k=>!headers.includes(k))||new Set(headers).size!==headers.length)fail('PUBLIC_SOURCE_SCHEMA_MISMATCH');
  const columns=required.map(key=>[key,headers.indexOf(key)] as const);
  return rows.map(values=>{if(values.length!==headers.length)fail('PUBLIC_SOURCE_ROW_WIDTH_MISMATCH');return Object.fromEntries(columns.map(([key,index])=>[key,values[index]]));});
}
type Game={gameId:string;kickoffAt:string;homeTeam:string;awayTeam:string;season:number;week:number;completed:boolean};
type Row={playerId:string;name:string;position:string;team:string;season:number;week:number;gameId:string;yards:number;kickoff:number};
type Source={retrievedAt:string;season:number;files:{url:string;sha256:string;observedAt:string}[];publicationClockVerified:false;historicalSeed?:{canonicalSha256:string;sourceHashes:Record<string,string>;availability:'PINNED_BUILD_ARTIFACT'}};
type Snapshot={rows:Row[];games:Game[];source:Source;expiresAt:number;priorOffsets:Map<string,number>};
type Dependencies={loadText?:(url:string)=>Promise<string>;now?:()=>number;expectedHashes?:Record<string,string>;readiness?:()=>Promise<{artifactVerified:boolean}>;seed?:typeof installedSeed;seedSha256?:string};

/** Injectable loader/clock support deterministic, network-free tests; HTTP routes use the installed singleton. */
export function createReceivingForecastService(deps:Dependencies={}) {
  const now=deps.now??(()=>Date.now()),loadText=deps.loadText??publicText;
  const hashes:Record<string,string>=deps.expectedHashes??artifact.source_hashes;
  const readiness=deps.readiness??correctedReceivingReadiness;
  const model=JSON.parse(JSON.stringify(artifact)) as typeof artifact;
  const modelVerified=async()=> (await readiness()).artifactVerified&&(await sha(canonicalJson(model)))===manifest.canonicalArtifactSha256;
  // Full CSV injection is retained for test parity; deployed exports always use the hash-verified compact seed.
  const useSeed=deps.seed!==undefined||deps.expectedHashes===undefined;
  const seed=deps.seed??installedSeed,seedHash=deps.seedSha256??SEED_SHA;
  let cache:Snapshot|undefined,inflight:Promise<Snapshot>|undefined;
  async function snapshot():Promise<Snapshot>{
    const decision=now();if(!Number.isFinite(decision))fail('INVALID_SERVER_CLOCK');
    if(cache&&decision<cache.expiresAt&&Date.parse(cache.source.retrievedAt)<=decision)return cache;
    if(inflight)return inflight;
    inflight=(async()=>{
      const files:Source['files']=[];
      async function read(url:string,expected?:string){
        const text=await loadText(url);if(new TextEncoder().encode(text).byteLength>LIMIT)fail('PUBLIC_SOURCE_TOO_LARGE');
        const hash=await sha(text),observedAt=new Date(now()).toISOString();
        if(expected&&hash!==expected)fail('FROZEN_HISTORICAL_SOURCE_HASH_MISMATCH');
        files.push({url,sha256:hash,observedAt});return text;
      }
      const [currentText,scheduleText]=await Promise.all([read(receivingStatsUrl(SEASON)),read(RECEIVING_SCHEDULE_URL)]);
      const schedule=records(scheduleText,['game_id','season','game_type','week','gameday','gametime','home_team','away_team','home_score','away_score']);
      const games:Game[]=[],gameMap=new Map<string,Game>();
      for(const r of schedule){
        if(r.game_type!=='REG'||Number(r.season)<2021||Number(r.season)>SEASON)continue;
        if(!id(r.game_id)||gameMap.has(r.game_id))fail('SCHEDULE_IDENTITY_INVALID');
        const kickoff=easternKickoff(r.gameday,r.gametime);
        if(!Number.isFinite(kickoff))fail('SCHEDULE_KICKOFF_UNVERIFIED');
        const season=Number(r.season),week=Number(r.week);
        if(!Number.isInteger(week)||week<1||week>18)fail('SCHEDULE_WEEK_INVALID');
        const completed=[r.home_score,r.away_score].every(x=>x.trim()!==''&&Number.isFinite(Number(x)));
        const g={gameId:r.game_id,kickoffAt:new Date(kickoff).toISOString(),homeTeam:team(r.home_team),awayTeam:team(r.away_team),season,week,completed};
        games.push(g);gameMap.set(g.gameId,g);
      }
      // A missing current season must never silently become a stale 2025 selector.
      const current=records(currentText,['player_id','player_display_name','position','season','week','season_type','game_id','team','receiving_yards']);
      if(!current.some(r=>Number(r.season)===SEASON&&r.season_type==='REG'&&['WR','RB','TE'].includes(r.position)))fail('CURRENT_SEASON_PLAYER_ROWS_UNAVAILABLE');
      const older=useSeed?[]:await Promise.all([2021,2022,2023,2024,2025].map(async year=>{
        const expected=hashes[`stats_player_week_${year}.csv`];if(!expected)fail('FROZEN_SOURCE_HASH_MISSING');
        return {year,rows:records(await read(receivingStatsUrl(year),expected),['player_id','player_display_name','position','season','week','season_type','game_id','team','receiving_yards'])};
      }));
      const rows:Row[]=[],seenGame=new Set<string>(),seenWeek=new Set<string>(),loadedAt=now(),priorOffsets=new Map<string,number>();
      if(useSeed){
        if(await sha(canonicalJson(seed))!==seedHash||seed.version!==1||seed.throughSeason!==2025||canonicalJson(seed.sourceHashes)!==canonicalJson(artifact.source_hashes))fail('HISTORICAL_SEED_INTEGRITY_FAILURE');
        for(const [playerId,raw] of Object.entries(seed.players)){
          const [count,last8]=raw as [number,[string,number,string][]];
          if(!id(playerId)||!Number.isInteger(count)||last8.length!==Math.min(count,8)||!last8.length)fail('HISTORICAL_SEED_SCHEMA_INVALID');
          priorOffsets.set(playerId,count-last8.length);
          for(const [gameId,yards,recordedTeam] of last8){
            const game=gameMap.get(gameId);
            if(!id(gameId)||!game||game.season>2025||!game.completed||Date.parse(game.kickoffAt)>=loadedAt||![game.homeTeam,game.awayTeam].includes(team(recordedTeam))||!Number.isSafeInteger(yards)||seenGame.has(`${playerId}|${gameId}`))fail('HISTORICAL_SEED_SCHEDULE_MISMATCH');
            seenGame.add(`${playerId}|${gameId}`);seenWeek.add(`${playerId}|${game.season}|${game.week}`);
            rows.push({playerId,name:playerId,position:'WR',team:team(recordedTeam),season:game.season,week:game.week,gameId,yards,kickoff:Date.parse(game.kickoffAt)});
          }
        }
      }
      for(const {year,rows:sourceRows} of [...older,{year:SEASON,rows:current}])for(const r of sourceRows){
        if(r.season_type!=='REG'||!['WR','RB','TE'].includes(r.position))continue;
        const season=Number(r.season),week=Number(r.week);
        if(season!==year||!Number.isInteger(week)||week<1||week>18||!id(r.player_id)||!id(r.game_id))fail('PLAYER_ROW_IDENTITY_INVALID');
        const gameKey=`${r.player_id}|${r.game_id}`,weekKey=`${r.player_id}|${season}|${week}`;
        if(seenGame.has(gameKey)||seenWeek.has(weekKey))fail('DUPLICATE_PLAYER_GAME_OR_WEEK');
        seenGame.add(gameKey);seenWeek.add(weekKey);
        if(r.receiving_yards.trim()==='')continue;
        const yards=Number(r.receiving_yards);if(!Number.isFinite(yards)||!Number.isSafeInteger(yards))fail('INVALID_RECEIVING_YARDS');
        const game=gameMap.get(r.game_id);if(!game||game.season!==season||game.week!==week)fail('HISTORICAL_GAME_NOT_JOINABLE');
        const recordedTeam=team(r.team);if(![game.homeTeam,game.awayTeam].includes(recordedTeam))fail('PLAYER_TEAM_SCHEDULE_MISMATCH');
        // Exclude unresolved/current games; their results are unavailable at this observed clock.
        if(!game.completed||Date.parse(game.kickoffAt)>=loadedAt)continue;
        rows.push({playerId:r.player_id,name:r.player_display_name||r.player_id,position:r.position,team:recordedTeam,season,week,gameId:r.game_id,yards,kickoff:Date.parse(game.kickoffAt)});
      }
      rows.sort((a,b)=>a.season-b.season||a.week-b.week||a.gameId.localeCompare(b.gameId));
      if(!rows.some(r=>r.season===SEASON))fail('CURRENT_SEASON_COMPLETED_PLAYER_ROWS_UNAVAILABLE');
      const source:Source={retrievedAt:new Date(now()).toISOString(),season:SEASON,files:files.sort((a,b)=>a.url.localeCompare(b.url)),publicationClockVerified:false,...(useSeed?{historicalSeed:{canonicalSha256:seedHash,sourceHashes:seed.sourceHashes,availability:'PINNED_BUILD_ARTIFACT' as const}}:{})};
      cache={rows,games,source,expiresAt:now()+TTL,priorOffsets};return cache;
    })();
    try{return await inflight;}finally{inflight=undefined;}
  }
  function relevant(snapshot:Snapshot,clock:number){
    const availableRows=snapshot.rows.filter(r=>r.kickoff<clock);
    const latest=new Map<string,Row>(),counts=new Map<string,number>(snapshot.priorOffsets);
    for(const row of availableRows){counts.set(row.playerId,(counts.get(row.playerId)??0)+1);if(row.season===SEASON)latest.set(row.playerId,row);}
    const games=snapshot.games.filter(g=>g.season===SEASON&&!g.completed&&Date.parse(g.kickoffAt)>clock).sort((a,b)=>a.kickoffAt.localeCompare(b.kickoffAt));
    const nextByTeam=new Map<string,string>();
    for(const game of games)for(const t of [game.homeTeam,game.awayTeam])if(!nextByTeam.has(t))nextByTeam.set(t,game.gameId);
    return {availableRows,latest,counts,games,nextByTeam};
  }
  const blocked=(reason:string)=>({...FLAGS,calculationStatus:'BLOCKED' as const,probability:null,reason,blockers:[reason,...LIMITATIONS]});
  async function options(query=''){
    try{
      if(typeof query!=='string'||query.length>100)fail('INVALID_PLAYER_QUERY');
      if(!await modelVerified())fail('ARTIFACT_INTEGRITY_FAILURE');
      const data=await snapshot(),clock=now(),{latest,counts,games,nextByTeam}=relevant(data,clock);
      const search=query.trim().toLowerCase();
      const players=[...latest.values()].filter(r=>(counts.get(r.playerId)??0)>=3&&games.some(g=>[g.homeTeam,g.awayTeam].includes(r.team))&&`${r.name} ${r.team} ${r.playerId}`.toLowerCase().includes(search))
        .map(r=>({playerId:r.playerId,name:r.name,position:r.position,team:r.team,priorGames:counts.get(r.playerId)!,latestSeason:r.season,latestWeek:r.week,nextGameId:nextByTeam.get(r.team)!})).sort((a,b)=>a.name.localeCompare(b.name));
      return {...FLAGS,calculationStatus:players.length&&games.length?'AVAILABLE' as const:'DATA_UNAVAILABLE' as const,reason:players.length&&games.length?'SOURCE_BACKED_RESEARCH_AVAILABLE':'NO_ELIGIBLE_CURRENT_PLAYERS_OR_FUTURE_GAMES',players,games:games.filter(g=>[...latest.values()].some(p=>nextByTeam.get(p.team)===g.gameId)).map(({gameId,kickoffAt,homeTeam,awayTeam})=>({gameId,kickoffAt,homeTeam,awayTeam})),source:data.source};
    }catch(error){return {...FLAGS,calculationStatus:'DATA_UNAVAILABLE' as const,reason:error instanceof Error?error.message:'PUBLIC_SOURCE_UNAVAILABLE',players:[],games:[],source:{retrievedAt:new Date(now()).toISOString(),season:SEASON,files:[],publicationClockVerified:false}};}
  }
  async function forecast(body:unknown){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join('|')!=='gameId|playerId')return blocked('INVALID_REQUEST_SCHEMA');
    const {playerId,gameId}=body as Record<string,unknown>;if(!id(playerId)||!id(gameId))return blocked('INVALID_REQUEST_IDENTITY');
    try{
      if(!await modelVerified())fail('ARTIFACT_INTEGRITY_FAILURE');
      const data=await snapshot(),clock=now();
      if(!Number.isFinite(clock)||clock<Date.parse(manifest.artifactAvailableAt))fail('MODEL_NOT_AVAILABLE_AT_SERVER_CLOCK');
      if(Date.parse(data.source.retrievedAt)>clock)fail('SOURCE_OBSERVED_AFTER_SERVER_CLOCK');
      const {availableRows,latest,games,nextByTeam}=relevant(data,clock),player=latest.get(playerId),game=games.find(g=>g.gameId===gameId);
      if(!game)fail('TARGET_NOT_FUTURE_REGULAR_SEASON_GAME');
      if(!player)fail('CURRENT_SEASON_PLAYER_UNAVAILABLE');
      if(![game.homeTeam,game.awayTeam].includes(player.team))fail('PLAYER_TEAM_TARGET_MISMATCH');
      if(nextByTeam.get(player.team)!==gameId)fail('TARGET_NOT_NEXT_TEAM_GAME');
      const history=availableRows.filter(r=>r.playerId===playerId&&r.gameId!==gameId&&r.kickoff<Date.parse(game.kickoffAt));
      if(history.length<3)fail('INSUFFICIENT_HISTORY');
      const mean=(n:number)=>history.slice(-n).reduce((s,r)=>s+r.yards,0)/Math.min(n,history.length);
      const hits=(n:number)=>history.slice(-n).filter(r=>r.yards>=60).length/Math.min(n,history.length);
      const priorGames=history.length+(data.priorOffsets.get(playerId)??0);
      const features=[mean(3),mean(8),hits(3),hits(8),priorGames];
      const logit=model.intercept+features.reduce((s,x,i)=>s+model.coefficients[i]*(x-model.mean[i])/model.scale[i],0);
      const rawProbability=sigmoid(logit),calibratedProbability=sigmoid(model.calibration.intercept+model.calibration.slope*logit);
      if(![...features,rawProbability,calibratedProbability].every(Number.isFinite))fail('NONFINITE_FORECAST');
      return {...FLAGS,calculationStatus:'CALCULATED' as const,probability:model.calibration.selected?calibratedProbability:rawProbability,rawProbability,calibratedProbability,
        playerId,gameId,kickoffAt:game.kickoffAt,decisionAt:new Date(clock).toISOString(),features,reason:'SOURCE_BACKED_CONDITIONAL_RESEARCH_FORECAST',blockers:LIMITATIONS,
        sourceReceipt:{...data.source,historyGames:priorGames,retainedHistoryRows:history.length,lastHistoryGame:history.at(-1)?.gameId,participationVerified:false,settlement:'>=60 receiving yards, full game, conditional recorded player row',clockLimitation:'Completed scores observed at retrieval; original result/publication timestamps unavailable. No resolvedAt times inferred.'}};
    }catch(error){return blocked(error instanceof Error?error.message:'PUBLIC_SOURCE_UNAVAILABLE');}
  }
  return {options,forecast};
}
const installed=createReceivingForecastService();
export const receivingForecastOptions=installed.options;
export const receivingForecast=installed.forecast;
