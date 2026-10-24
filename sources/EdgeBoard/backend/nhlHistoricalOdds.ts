import { secrets } from '@appdeploy/sdk';
import { getNhlHistoricalPredictions } from './nhlLeagueBacktest';

type ProviderLine = {
  game_id?:string; game_date?:string; player_name?:string; player_id?:number|null;
  market?:string; bookmaker?:string; line?:number|null;
  over_odds?:number|null; under_odds?:number|null; captured_at?:string; source?:string;
};
type SourceResponse = { snapshot_type?:string; games?:number; props?:ProviderLine[];count?:number };
type GameRecord = {gameId?:number;playerId?:number;shots?:number;skaterFullName?:string};
type OfficialGame = {id?:number;season?:number;gameType?:number;gameState?:string;startTimeUTC?:string;gameDate?:string};
const sourceUrl='https://mcp.puckapi.com/v1/get_player_props';
const market='player_shots_on_goal';
const expectedSeason='20252026';
const americanDecimal=(odds:number)=>odds>0?1+odds/100:1+100/Math.abs(odds);
const implied=(odds:number)=>1/americanDecimal(odds);
const allowedOdds=(x:unknown):x is number=>typeof x==='number'&&Number.isInteger(x)&&Math.abs(x)>=100&&Math.abs(x)<=5000;
const allowGame=(s:string)=>/^202502\d{4}$/.test(s);
const readKey=async()=> {
  const names=await secrets.listSecretNames();
  if(!names.includes('PUCKAPI_API_KEY')) return null;
  const key=(await secrets.readSecret('PUCKAPI_API_KEY')).trim();
  return key||null;
};
async function providerRequest(key:string,payload:Record<string,unknown>) {
  const response=await fetch(sourceUrl,{
    method:'POST',headers:{'Content-Type':'application/json','x-api-key':key},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(24000),
  });
  const body=await response.text();
  if(!response.ok) throw Error('PuckAPI response HTTP '+response.status+'; no fallback quotes supplied.');
  if(body.length>3500000) throw Error('PuckAPI data limit exceeded.');
  let parsed:unknown;
  try {parsed=JSON.parse(body);} catch {throw Error('Invalid PuckAPI JSON response.');}
  const envelope=parsed as {data?:unknown};
  if(!envelope||typeof envelope!=='object'||!envelope.data||typeof envelope.data!=='object'||Array.isArray(envelope.data))
    throw Error('PuckAPI REST response missing documented data envelope; no quotes trusted.');
  return envelope.data as Record<string,unknown>;
}
let connectivityCache:{at:number;response:unknown}|null=null;
let connectivityInflight:Promise<unknown>|null=null;
export async function verifyNhlOddsConnection() {
  if(connectivityCache&&Date.now()-connectivityCache.at<300000) return connectivityCache.response;
  if(connectivityInflight) return connectivityInflight;
  connectivityInflight=(async()=>{
    const key=await readKey();
    if(!key) return {status:'KEY_NOT_CONFIGURED',authenticated:false,creditsSpent:0,validatedRoi:null};
    try {
      const probe=await providerRequest(key,{game_id:'2025020002',market,snapshot_type:'closing',estimate_only:true});
      const result={status:'AUTHENTICATED_ESTIMATE_ONLY',authenticated:true,
        provider:'PuckAPI',gameId:'2025020002',costEstimate:probe,
        creditsSpent:0,actualQuotesDownloaded:false,verifiedPositiveEv:false,
        recommendation:'HOLD'};
      connectivityCache={at:Date.now(),response:result};
      return result;
    } catch(e) {
      const message=e instanceof Error?e.message:'Provider connection failed';
      const statusMatch=message.match(/PuckAPI response HTTP (\d{3})/);
      const providerHttpStatus=statusMatch?Number(statusMatch[1]):null;
      const problem=providerHttpStatus===401?'API key rejected by provider'
        :providerHttpStatus===402?'Provider credits unavailable'
        :providerHttpStatus===429?'Provider rate limit'
        :providerHttpStatus!==null?'Provider returned HTTP '+providerHttpStatus
        :message.includes('data envelope')?'Unexpected provider response format'
        :message.includes('Invalid PuckAPI JSON')?'Invalid provider JSON'
        :'Provider network or timeout failure';
      return {status:'PROVIDER_NOT_VERIFIED',authenticated:false,
        provider:'PuckAPI',providerHttpStatus,diagnostic:problem,
        creditsSpent:0,actualQuotesDownloaded:false,verifiedPositiveEv:false,
        recommendation:'HOLD'};
    }
  })();
  try{return await connectivityInflight;}finally{connectivityInflight=null;}
}
export async function nhlOddsReadiness() {
  const connected=Boolean(await readKey());
  return {
    status:connected?'KEY_SAVED_PROVIDER_NOT_TESTED':'PROVIDER_KEY_REQUIRED',
    connected,provider:'PuckAPI',source:'https://puckapi.com/data/player-props',
    sourceDocs:'https://puckapi.com/docs/get-player-props',
    freeCreditsAdvertisedPerMonth:500,costCreditsPerGame:10,
    historicalSeasonCoverageWarning:'2025-26 player-prop game coverage is reportedly only about 5%: selection bias is material.',
    modelsReadyForBookValidation:false,modelHasIndividualWagerUncertainty:false,
    autoCreditCharges:false,automaticWagers:false,
    recommendation:'HOLD',validatedHistoricalRoi:null,verifiedPositiveEv:false,
    instructions:connected?'Preview one historical game with estimate_only, then explicitly approve a single credit-consuming audit.':'Create a PuckAPI key and connect it as AppDeploy backend secret PUCKAPI_API_KEY. No key or provider credits are used until connected.'
  };
}
export function auditQuoteRow(row:ProviderLine, gameId:string, startTime:string, knownPlayers:Set<number>) {
  const reasons:string[]=[];
  if(String(row.game_id)!==gameId) reasons.push('wrong game ID');
  if(row.market!==market) reasons.push('not shots-on-goal market');
  if(!Number.isInteger(row.player_id)||!knownPlayers.has(row.player_id as number)) reasons.push('unmatched official player ID');
  if(!row.bookmaker||typeof row.bookmaker!=='string') reasons.push('bookmaker absent');
  if(row.source!=='the_odds_api') reasons.push('unexpected quote origin');
  if(row.line!==1.5&&row.line!==2.5) reasons.push('threshold not trained for this market');
  if(!allowedOdds(row.over_odds)||!allowedOdds(row.under_odds)) reasons.push('two valid American side prices required');
  const capture=typeof row.captured_at==='string'?Date.parse(row.captured_at):NaN;
  const start=Date.parse(startTime);
  if(!Number.isFinite(capture)||!Number.isFinite(start)||capture>=start||start-capture>7*86400000)
    reasons.push('timestamp absent, after puck drop or more than 7 days stale');
  return reasons;
}
export function nhlOddsSelftest() {
  const known=new Set([8475794]),start='2026-02-04T00:00:00Z',game='2025020887';
  const base:ProviderLine={game_id:game,player_id:8475794,market,bookmaker:'draftkings',
    line:2.5,over_odds:-115,under_odds:-105,captured_at:'2026-02-03T23:30:00Z',source:'the_odds_api'};
  const checks={
    validArchivedQuoteAccepted:auditQuoteRow(base,game,start,known).length===0,
    postPuckDropRejected:auditQuoteRow({...base,captured_at:'2026-02-04T00:01:00Z'},game,start,known).some(r=>r.includes('timestamp')),
    unknownPlayerRejected:auditQuoteRow({...base,player_id:9999999},game,start,known).some(r=>r.includes('player')),
    unsupportedThresholdRejected:auditQuoteRow({...base,line:3.5},game,start,known).some(r=>r.includes('threshold')),
    missingOddsRejected:auditQuoteRow({...base,under_odds:null},game,start,known).some(r=>r.includes('prices')),
    wrongGameRejected:auditQuoteRow({...base,game_id:'2025020000'},game,start,known).some(r=>r.includes('game ID')),
    unknownSourceRejected:auditQuoteRow({...base,source:'demo'},game,start,known).some(r=>r.includes('origin')),
  };
  return {kind:'SYNTHETIC_VALIDATION_FIXTURE_NOT_REAL_QUOTE',
    status:Object.values(checks).every(Boolean)?'PASS':'FAIL',
    checks,creditsSpent:0,noLiveRecommendation:true};
}
export async function previewNhlPrice(gameId:string) {
  if(!allowGame(gameId)) throw Error('Choose a 2025-26 NHL regular season game ID in the form 2025020001.');
  const key=await readKey();
  if(!key) return {status:'NOT_CONNECTED',estimatedCredits:null,creditsSpent:0,recommendation:'HOLD'};
  const result=await providerRequest(key,{game_id:gameId,market,snapshot_type:'closing',estimate_only:true});
  // Provider controls the true estimate schema. Never pretend a quote has been downloaded.
  return {status:'ESTIMATE_ONLY',gameId,estimate:result,creditsSpent:0,
    auditCostPolicy:'No audit until a separate explicit 10-credit approval is submitted.',
    recommendation:'HOLD'};
}
async function officialGame(gameId:string) {
  const r=await fetch('https://api-web.nhle.com/v1/gamecenter/'+gameId+'/landing',{signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw Error('Official game details unavailable: HTTP '+r.status);
  const g=await r.json() as OfficialGame;
  if(g.id!==Number(gameId)||g.season!==20252026||g.gameType!==2||g.gameState!=='OFF'||
    !g.startTimeUTC||!Number.isFinite(Date.parse(g.startTimeUTC)))
    throw Error('Not a verified, completed NHL 2025-26 regular-season game');
  return g;
}
async function officialPlayerShots(gameId:string) {
  const args=new URLSearchParams({isAggregate:'false',isGame:'true',start:'0',limit:'-1',
    cayenneExp:'gameId='+gameId+' and gameTypeId=2'});
  const url='https://api.nhle.com/stats/rest/en/skater/summary?'+args.toString();
  const r=await fetch(url,{signal:AbortSignal.timeout(18000)});
  if(!r.ok) throw Error('Official NHL player-shot settlement unavailable: HTTP '+r.status);
  const j=await r.json() as {data?:GameRecord[];total?:number};
  if(!Array.isArray(j.data)||j.data.length<20||j.data.length>50||j.total!==j.data.length)
    throw Error('Incomplete NHL official game skater stats');
  const found=new Map<number,{shots:number;name:string}>();
  for(const p of j.data) {
    if(p.gameId!==Number(gameId)||!Number.isInteger(p.playerId)||!Number.isInteger(p.shots)||
      (p.shots as number)<0) throw Error('Official NHL player stats malformed');
    if(found.has(p.playerId as number)) throw Error('Duplicate official player record');
    found.set(p.playerId as number,{shots:p.shots as number,name:p.skaterFullName??'Unnamed player'});
  }
  return found;
}
const inflight=new Map<string,Promise<unknown>>();
export async function auditNhlPrice(gameId:string,confirmCredits:unknown) {
  if(!allowGame(gameId)) throw Error('Only verified 2025-26 NHL regular-season IDs are supported.');
  if(confirmCredits!==10) throw Error('Explicit acknowledgment of one 10-credit provider request required.');
  const key=await readKey();
  if(!key) throw Error('PuckAPI key is not connected. No credits used.');
  if(inflight.has(gameId)) return inflight.get(gameId);
  const task=(async()=>{
    // Run source verification and retrospective model first, before credit consumption.
    const game=await officialGame(gameId);
    const official=await officialPlayerShots(gameId);
    const predictions=await getNhlHistoricalPredictions(Number(gameId));
    const response=await providerRequest(key,{game_id:gameId,market,snapshot_type:'closing'});
    const payload=response as SourceResponse;
    if(payload.snapshot_type!=='closing'||payload.games!==1||!Array.isArray(payload.props)||
      (typeof payload.count==='number'&&payload.count!==payload.props.length))
      throw Error('PuckAPI supplied incomplete or non-closing props, research withheld.');
    const accepted:Array<Record<string,unknown>>=[];
    const reasons:Record<string,number>={};
    const matched=new Set<string>();
    for(const p of payload.props.slice(0,6000)) {
      const issues=auditQuoteRow(p,gameId,game.startTimeUTC!,new Set(official.keys()));
      if(!issues.length) {
        const unique=[p.bookmaker,p.player_id,p.line].join('|');
        if(matched.has(unique)) issues.push('duplicate same-book player-line: ambiguous snapshot');
        matched.add(unique);
      }
      if(issues.length) {for(const reason of issues) reasons[reason]=(reasons[reason]??0)+1;continue;}
      const actual=official.get(p.player_id as number)!;
      const ref=predictions.get((p.player_id as number)+'|'+p.line);
      if(!ref) {reasons['held-out model prediction absent']=(reasons['held-out model prediction absent']??0)+1;continue;}
      const over=p.over_odds as number,under=p.under_odds as number;
      const rawOver=implied(over),rawUnder=implied(under),sum=rawOver+rawUnder;
      if(sum<0.98||sum>1.30) {reasons['implausible two-way market margin']=(reasons['implausible two-way market margin']??0)+1;continue;}
      accepted.push({bookmaker:p.bookmaker,player:actual.name,playerId:p.player_id,
        gameId,line:p.line,capturedAt:p.captured_at,overOdds:over,underOdds:under,
        noVigOver:rawOver/sum,modelOver:ref.probability,actualShots:actual.shots,
        observedOver:actual.shots>(p.line as number),
        illustrativeModelOverDifference:ref.probability-rawOver/sum,
        status:'RETROSPECTIVE_MATCH_ONLY',eligibleToRecommend:false});
    }
    return {
      status:'MATCHED_HISTORICAL_QUOTES_RESEARCH_ONLY',
      gameId,gameDate:game.gameDate,startTimeUTC:game.startTimeUTC,source:'PuckAPI / The Odds API archive',
      sourceCapturedCount:payload.props.length,matchedLines:accepted.length,
      rejectedReasons:reasons,distinctMatchedBooks:new Set(accepted.map(p=>p.bookmaker)).size,
      preview:accepted.slice(0,30),
      providerCreditsConsumed:10,
      modelVersion:'nhl-sog-leaguewide-retrospective-v1',
      limitations:['Only line 1.5 or 2.5 supported; exact NHL player and game IDs required.',
        'Snapshot is final pregame, not a historically executable account fill.',
        '2025-26 archived prop coverage only ~5% and is selection biased.',
        'Retrospective model has no validated per-player uncertainty or current lineup adjustments.',
        'One event cannot validate sportsbook-beating ROI or establish profit.'],
      validatedRoi:null,verifiedPositiveEv:false,liveApproved:false,recommendation:'HOLD'
    };
  })();
  inflight.set(gameId,task);
  try{return await task;}finally{inflight.delete(gameId);}
}
