import { secrets } from '@appdeploy/sdk';
import { getFreeUnderdogLines } from './freeUnderdog';
import { liveGame } from './liveGames';
import { object, rows, text, numeric, iso, normalizeName, normalizePeriod, matchTeams, effectiveQuoteAge, type LiveGame, type LiveQuote } from './liveTypes';

const BASE = 'https://parlay-api.com';
const saved = new Map<string, { at: number; value: LiveQuote[]; health: Record<string,unknown> }>();
const pending = new Map<string, Promise<unknown>>();
const cooldown = new Map<string,number>();
const validAmerican = (value: unknown) => { const n=numeric(value); return n!==null && Math.abs(n)>=100 && Math.abs(n)<=100000 ? n : null; };
const decimal = (value:number) => value>0 ? 1+value/100 : 1+100/Math.abs(value);
function stamp(row: Record<string,unknown>, observed:number) {
  const oddsAt=iso(row.last_observed ?? row.last_update ?? row.updated_at ?? row.timestamp ?? row.captured_at);
  const declaredAge=numeric(row.age_seconds);
  const age=oddsAt ? (observed-Date.parse(oddsAt))/1000 : declaredAge;
  return { oddsAt,ageSeconds:age,timestampBasis:oddsAt ? 'source timestamp' : declaredAge!==null ? 'provider-reported age; original quote timestamp absent' : 'unavailable' };
}
export function normalizePeriodQuotes(payload:unknown, game:LiveGame, observed=Date.now()):LiveQuote[] {
  const out:LiveQuote[]=[];
  for (const row of rows(object(payload).results)) {
    if (!matchTeams(text(row.home_team),text(row.away_team),game)) continue;
    const period=normalizePeriod(row.period_key ?? row.period);
    const price=validAmerican(row.price);
    const market=text(row.market);
    if (period!=='2H' || price===null || !['spread','total','h2h'].includes(market)) continue;
    const rawSide=text(row.side).toLowerCase();
    const side=rawSide==='home'?game.home.name:rawSide==='away'?game.away.name:rawSide;
    const line=numeric(row.line);
    if (market!=='h2h' && line===null) continue;
    const book=text(row.source ?? row.bookmaker).toLowerCase();
    if (!book || !side) continue;
    const observation=stamp(row,observed);
    out.push({ id:['period',game.id,book,market,side,line,price,observation.oddsAt??observed].join('|'),provider:'ParlayAPI period markets',book,
      eventId:game.id,providerEventId:text(row.match_id),event:game.event,player:null,playerId:null,market,side,line,period,
      decimalOdds:decimal(price),americanOdds:price,entryMultiplier:null,retrievedAt:new Date(observed).toISOString(),...observation,
      status:text(row.market_status ?? row.status)||'unknown',settlementRules:text(row.settlement_rules)||null,
      accountAvailabilityVerified:false,modelProbability:null });
  }
  return out;
}
export function normalizePropQuotes(payload:unknown, game:LiveGame, providerEventId:string, observed=Date.now()):LiveQuote[] {
  const data=Array.isArray(payload)?payload:object(payload).data;
  const out:LiveQuote[]=[];
  for (const row of rows(data)) {
    const identity=text(row.canonical_event_id ?? row.event_id);
    if (identity!==providerEventId && text(row.event_id)!==providerEventId) continue;
    const period=normalizePeriod(row.period);
    if (!['FULL','2H'].includes(period)) continue;
    const book=text(row.bookmaker).toLowerCase(), player=text(row.player), market=text(row.market_key ?? row.market), line=numeric(row.line);
    if (!book || !player || !market || line===null) continue;
    // DFS entry payout multipliers are deliberately not converted into side prices.
    const dfs=['underdog','prizepicks','pick6','sleeper','betr'].includes(book);
    for (const side of ['over','under']) {
      const price=dfs?null:validAmerican(row[side+'_price']);
      const entry=object(object(row.selection_by_side)[side]);
      const multiplier=numeric(entry.payout_multiplier);
      if (price===null && multiplier===null) continue;
      const observation=stamp(row,observed);
      out.push({ id:['prop',game.id,book,player,market,side,line,period,price??multiplier,observation.oddsAt??observed].join('|'),provider:'ParlayAPI player props',book,
        eventId:game.id,providerEventId:identity,event:game.event,player,playerId:text(row.canonical_player_id ?? row.player_id)||null,
        market,side,line,period,decimalOdds:price===null?null:decimal(price),americanOdds:price,entryMultiplier:multiplier,
        retrievedAt:new Date(observed).toISOString(),...observation,status:text(row.market_status ?? row.status)||'unknown',
        settlementRules:text(row.settlement_rules)||null,accountAvailabilityVerified:false,modelProbability:null });
    }
  }
  return out;
}
function decorate(quotes:LiveQuote[]) {
  return quotes.map(quote=>({...quote}));
}
export function cachedLiveQuotes(eventId:string) {
  return [...saved.values()].flatMap(entry=>entry.value).filter(quote=>quote.eventId===eventId).map(quote=>decorate([quote])[0]);
}
export async function publicGameProps(game:LiveGame) {
  const board=await getFreeUnderdogLines({sport:'americanfootball_nfl',limit:1000,includeSeasonMarkets:false,
    eventTeams:[game.away.name,game.home.name]});
  const quotes:LiveQuote[]=[];
  for (const line of board.lines) {
    const period=normalizePeriod(line.period);
    const eventLabel=line.event.replace(/\s*(?:[-–:]\s*)?(?:\(|\[)?(?:2H|2nd[ _-]?half|second[ _-]?half)(?:\)|\])?\s*$/i,'').trim();
    const parts=eventLabel.split(/\s+(?:@|at)\s+/i);
    const start=line.commenceTime?Date.parse(line.commenceTime):NaN;
    const delta=start-Date.parse(game.startTime);
    const joinedTime=period==='2H'?delta>=-60_000&&delta<=5*3_600_000:Math.abs(delta)<=60_000;
    if (parts.length!==2 || !matchTeams(parts[1],parts[0],game) || !Number.isFinite(start) || !joinedTime) continue;
    for (const [side,offer] of [['over',line.higher],['under',line.lower]] as const) {
      if (!offer) continue;
      quotes.push({id:['public',line.lineId,side,line.line,offer.decimalPrice,offer.payoutMultiplier,line.lineUpdatedAt??board.retrievedAt].join('|'),provider:'Underdog public observation',book:'underdog',eventId:game.id,
        providerEventId:line.eventId,event:game.event,player:line.player,playerId:null,market:line.market,side,line:line.line,period,
        decimalOdds:offer.decimalPrice,americanOdds:offer.americanPrice,entryMultiplier:offer.payoutMultiplier,
        retrievedAt:board.retrievedAt,oddsAt:iso(line.lineUpdatedAt),ageSeconds:line.lineUpdatedAt?(Date.now()-Date.parse(line.lineUpdatedAt))/1000:null,
        timestampBasis:line.periodEvidence+'; source update timestamp',status:line.status,settlementRules:null,
        accountAvailabilityVerified:false,modelProbability:null });
    }
  }
  const health={source:'Underdog public feed',status:'RETRIEVED',matchedQuotes:quotes.length,
    periodSpecific2h:quotes.filter(quote=>quote.period==='2H').length,truncated:board.truncated,retrievedAt:board.retrievedAt,
    note:'A public feed is not account-specific availability; missing segment evidence remains UNKNOWN.',providerCreditsUsed:0};
  saved.set(game.id+'|public',{at:Date.parse(board.retrievedAt),value:quotes,health});
  return {quotes,health};
}
export async function liveProviderStatus(checkAuthentication=false) {
  const configured=(await secrets.listSecretNames()).includes('PARLAY_API_KEY');
  const result={configured,authentication:'NOT_CHECKED',providerCreditsUsed:0,
    periodEndpointImplemented:true,periodRequestCredits:2,propsRequestCredits:3,
    action:configured?'Sign in and explicitly load provider prices; price refreshes are not automatic.':'Connect PARLAY_API_KEY through the existing secure integration settings.'};
  if (!configured || !checkAuthentication) return result;
  const key=(await secrets.readSecret('PARLAY_API_KEY')).trim();
  const response=await fetch(BASE+'/v1/sports/americanfootball_nfl/events',
    {headers:{'X-API-Key':key},signal:AbortSignal.timeout(10_000)});
  return {...result,authentication:response.ok?'AUTHENTICATED_ZERO_CREDIT_EVENTS':response.status===401?'UNAUTHORIZED_RECONNECT_KEY':response.status===403?'ACCESS_DENIED':'HTTP_'+response.status,
    httpStatus:response.status};
}
async function creditCost(path:string) {
  const response=await fetch(BASE+'/v1/meta/credit-costs',{signal:AbortSignal.timeout(10_000)});
  if (!response.ok) throw Error('Provider price catalogue unavailable; no credit-consuming request sent.');
  const data=object(await response.json());
  const entry=rows(data.fixed).find(row=>text(row.path)===path);
  const cost=numeric(entry?.cost);
  if (cost===null || cost<0) throw Error('Could not verify provider request cost; no request sent.');
  return cost;
}
export async function loadLiveProvider(input:unknown,userId:string) {
  const body=object(input), eventId=text(body.eventId), kind=text(body.kind);
  if (!['periods','props'].includes(kind)) throw Error('Choose period markets or player props.');
  const budget=numeric(body.confirmCredits);
  if (budget===null || budget<0 || budget>3) throw Error('Explicit credit budget is required.');
  const {game}=await liveGame(eventId,body.requireHalftime === true);
  if (game.phase==='final') throw Error('This game has ended.');
  if (body.requireHalftime === true && game.phase !== 'halftime') {
    throw Error('The source does not confirm halftime now. No price credits were spent; refresh the game context.');
  }
  const cacheKey=eventId+'|'+kind;
  const existing=saved.get(cacheKey);
  if (existing && Date.now()-existing.at<20_000) return {quotes:decorate(existing.value),health:existing.health,creditsUsed:0,cacheHit:true};
  const pendingKey=userId+'|'+cacheKey;
  if (pending.has(pendingKey)) return pending.get(pendingKey);
  if (Date.now()<(cooldown.get(pendingKey)??0)) throw Error('Provider retry cooldown is active; avoid repeatedly spending credits.');
  const request=(async()=>{
    const configured=(await secrets.listSecretNames()).includes('PARLAY_API_KEY');
    if (!configured) return {quotes:[],health:{status:'UNCONFIGURED',action:'Connect PARLAY_API_KEY in secure integration settings.'},creditsUsed:0};
    const path=kind==='periods'?'/v1/sports/{sport_key}/live/period_markets':'/v1/sports/{sport_key}/props';
    const cost=await creditCost(path);
    if (cost>budget) throw Error('Current provider cost exceeds the approved credit budget.');
    const key=(await secrets.readSecret('PARLAY_API_KEY')).trim();
    let providerEventId='';
    if (kind==='props') {
      const eventResponse=await fetch(BASE+'/v1/sports/americanfootball_nfl/events',
        {headers:{'X-API-Key':key},signal:AbortSignal.timeout(10_000)});
      if (!eventResponse.ok) return {quotes:[],health:{status:eventResponse.status===401?'UNAUTHORIZED_RECONNECT_KEY':'EVENT_IDENTITY_UNAVAILABLE',httpStatus:eventResponse.status},creditsUsed:0};
      const payload:unknown=await eventResponse.json();
      const list=Array.isArray(payload)?payload:object(payload).data;
      const matches=rows(list).filter(row=>matchTeams(text(row.home_team),text(row.away_team),game)
        && iso(row.commence_time)!==null && Math.abs(Date.parse(String(row.commence_time))-Date.parse(game.startTime))<60_000);
      if (matches.length!==1) return {quotes:[],health:{status:'EVENT_IDENTITY_UNVERIFIED'},creditsUsed:0};
      providerEventId=text(matches[0].canonical_event_id ?? matches[0].id);
    }
    const query=kind==='periods'?'period=2H':new URLSearchParams({eventId:providerEventId,limit:'1000',maxAgeSec:'90',bookmakers:'caesars,pinnacle,draftkings,fanduel,betmgm,bovada,underdog,prizepicks'}).toString();
    const endpoint=kind==='periods'?'live/period_markets':'props';
    if (body.requireHalftime === true && (await liveGame(eventId,true)).game.phase !== 'halftime') {
      throw Error('The halftime window closed during provider preparation. No price credits were spent.');
    }
    const response=await fetch(BASE+'/v1/sports/americanfootball_nfl/'+endpoint+'?'+query,
      {headers:{'X-API-Key':key},signal:AbortSignal.timeout(15_000)});
    cooldown.set(pendingKey,Date.now()+20_000);
    const reportedCost=numeric(response.headers.get('x-requests-last'));
    if (!response.ok) return {quotes:[],creditsUsed:reportedCost,health:{status:({401:'UNAUTHORIZED_RECONNECT_KEY',402:'CREDITS_EXHAUSTED',403:'NOT_ENTITLED',429:'RATE_LIMITED'} as Record<number,string>)[response.status]??'PROVIDER_UNAVAILABLE',httpStatus:response.status,
      action:'Provider access must be repaired; no substitute prices were generated.'}};
    const payload:unknown=await response.json();
    const observed=Date.now();
    const quotes=kind==='periods'?normalizePeriodQuotes(payload,game,observed):normalizePropQuotes(payload,game,providerEventId,observed);
    const health={status:quotes.length?'RETRIEVED':'NO_MATCHING_QUOTES',kind,matchedQuotes:quotes.length,retrievedAt:new Date(observed).toISOString(),
      originalEventIdVerified:kind==='props',eventMatchBasis:kind==='props'?'provider event plus exact matchup/kickoff':'exact current matchup; source-native IDs retained separately',
      partialBoard:response.headers.get('x-result-has-more')==='true'||response.headers.get('x-result-truncated')==='true',
      creditsUsed:reportedCost,approvedMaximumCredits:budget,catalogueCost:cost,
      creditsRemaining:numeric(response.headers.get('x-requests-remaining')),accountAvailabilityVerified:false};
    saved.set(cacheKey,{at:observed,value:quotes,health});
    return {quotes,health,creditsUsed:reportedCost,cacheHit:false};
  })();
  pending.set(pendingKey,request);
  try { return await request; } finally { pending.delete(pendingKey); }
}

export function twoWayBenchmarks(quotes:LiveQuote[],now=Date.now()) {
  const results=new Map<string,{probability:number;books:number}>();
  for (const quote of quotes) {
    const age=effectiveQuoteAge(quote,now);
    if (quote.decimalOdds===null || age===null || age<0 || age>90) continue;
    const opposites=quotes.filter(other=>other.book===quote.book && other.eventId===quote.eventId && other.period===quote.period
      && other.market===quote.market && other.player===quote.player && other.decimalOdds!==null
      && other.side!==quote.side && effectiveQuoteAge(other,now)!==null && effectiveQuoteAge(other,now)!>=0 && effectiveQuoteAge(other,now)!<=90
      && (quote.market==='spread'?other.line===-(quote.line??NaN):other.line===quote.line));
    if (opposites.length!==1) continue;
    const opposite=opposites[0];
    const probability=(1/quote.decimalOdds)/(1/quote.decimalOdds+1/opposite.decimalOdds!);
    results.set(quote.id,{probability,books:1});
  }
  return quotes.map(quote=>{
    const comparisons=quotes.filter(other=>other.id!==quote.id && other.book!==quote.book && other.eventId===quote.eventId
      && other.market===quote.market && normalizeName(other.player??'')===normalizeName(quote.player??'')
      && other.line===quote.line && other.period===quote.period && other.side===quote.side && results.has(other.id));
    const byBook=new Map(comparisons.map(other=>[other.book,results.get(other.id)!.probability]));
    const probabilities=[...byBook.values()].sort((a,b)=>a-b);
    return {...quote,referenceBookCount:byBook.size,marketBenchmarkProbability:probabilities.length>=2
      ? probabilities.length%2?probabilities[Math.floor(probabilities.length/2)]:(probabilities[probabilities.length/2-1]+probabilities[probabilities.length/2])/2:null,
      benchmarkMeaning:'Other-book proportional no-vig benchmark, not an independent statistical model; settlement equivalence is unverified.'};
  });
}
