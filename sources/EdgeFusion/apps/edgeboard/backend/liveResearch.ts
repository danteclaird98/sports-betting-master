import { liveGame, liveScoreboard } from './liveGames';
import { liveProviderStatus, publicGameProps, twoWayBenchmarks } from './liveOdds';
import { independentModelStatus, receptionEstimate } from './independentReceptions';
import { receptionFeatures } from './receptionFeatures';
import { normalizeName, effectiveQuoteAge, type LiveQuote } from './liveTypes';
import { readLiveSnapshots } from './liveQuoteStorage';

export async function liveBoard(eventId?:string,date?:string) {
  const [scoreboard,provider]=await Promise.all([liveScoreboard(date),liveProviderStatus()]);
  const selectedId=eventId || scoreboard.games.find(game=>['first_half','halftime','second_half'].includes(game.phase))?.id || scoreboard.games[0]?.id;
  const context=selectedId?await liveGame(selectedId):null;
  return {scoreboard,context,provider,model:independentModelStatus(),providerCreditsUsed:0,
    recommendation:'HOLD',recommendedStake:0,automaticWagers:false,
    note:'Scores and clock refresh independently of prices. Provider requests that consume credits require explicit sign-in and a per-request budget.'};
}
export async function enrichLiveQuotes(eventId:string,quotes:LiveQuote[]) {
  const context=await liveGame(eventId);
  const featureRequests=new Map<string,Promise<Awaited<ReturnType<typeof receptionFeatures>>>>();
  const results=await Promise.all(twoWayBenchmarks(quotes).map(async quote=>{
    let estimate:ReturnType<typeof receptionEstimate>|null=null;
    let modelReason='No independent model is evaluated for this market.';
    const receptionMarket=/^(?:player_)?receptions$|^rec$/i.test(quote.market);
    const eligiblePhase=quote.period==='2H'?context.game.phase==='halftime':quote.period==='FULL'&&context.game.phase==='pregame';
    if (receptionMarket && quote.line!==null && quote.player) {
      if (!eligiblePhase) modelReason=quote.period==='2H'?'The halftime model requires a completed first half before any second-half play.':'Pregame full-game probabilities cannot be reused on an in-progress game.';
      else {
        const matches=context.players.filter(player=>normalizeName(player.name)===normalizeName(quote.player!));
        if (matches.length!==1) modelReason='A unique stable player identity and observed boxscore record are required; missing stats are not zero.';
        else {
          try {
            const player=matches[0];
            if(!featureRequests.has(player.espnId))featureRequests.set(player.espnId,receptionFeatures(context.game,player));
            const history=await featureRequests.get(player.espnId)!;
            if (quote.playerId?.startsWith('00-') && quote.playerId!==history.gsisId) throw Error('Quote GSIS identity does not match the live player.');
            estimate=receptionEstimate(history.features,quote.line,quote.side,quote.period as 'FULL'|'2H',quote.period==='2H'?player.receptions:null);
            modelReason='Independent historical model estimate; injury, contract, current-season and offered-price validation remain incomplete.';
          } catch(error) { modelReason=error instanceof Error?error.message:'Model data unavailable.'; }
        }
      }
    }
    const age=effectiveQuoteAge(quote);
    const priced=quote.decimalOdds!==null&&estimate!==null&&quote.settlementRules!==null
      &&age!==null&&age>=0&&age<=90&&['open','active','available'].includes(quote.status.toLowerCase())
      &&!['underdog','prizepicks','pick6','sleeper','betr'].includes(quote.book);
    return {...quote,estimate,modelReason,
      researchEv:priced?estimate!.probability*quote.decimalOdds!-1:null,
      researchLowEv:priced?estimate!.probabilityLow*quote.decimalOdds!-1:null,
      breakEvenProbability:quote.decimalOdds===null?null:1/quote.decimalOdds,
      researchOnly:true,recommendation:'HOLD',recommendedStake:0};
  }));
  results.sort((a,b)=>Number(b.book==='caesars')-Number(a.book==='caesars') || (b.researchLowEv??-Infinity)-(a.researchLowEv??-Infinity) || a.market.localeCompare(b.market));
  return {context,quotes:results,model:independentModelStatus(),recommendation:'HOLD',recommendedStake:0};
}
export async function publicLiveResearch(eventId:string,userId?:string) {
  const {game}=await liveGame(eventId);
  const publicBoard=await publicGameProps(game);
  const ownSnapshots=userId?await readLiveSnapshots(userId,eventId):[];
  const quotes=[...ownSnapshots,...publicBoard.quotes];
  const unique=[...new Map(quotes.map(quote=>[quote.id,quote])).values()];
  return {...await enrichLiveQuotes(eventId,unique),publicSource:publicBoard.health,providerCreditsUsed:0};
}
