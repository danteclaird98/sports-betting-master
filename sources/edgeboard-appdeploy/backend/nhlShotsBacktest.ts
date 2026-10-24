// Research-only NHL shot counts: no live predictions or wagering approval.
type Raw = {playerId?:number;gameId?:number;gameDate?:string;positionCode?:string;teamAbbrev?:string;shots?:number;timeOnIcePerGame?:number;homeRoad?:string};
type Game = {player:number;game:number;date:string;season:number;team:string;shots:number;toi:number;home:boolean;defense:boolean};
export type NhlGame = Game;
type Obs = {game:number;player:number;season:number;x:number[];y:number;hits:number;n:number};
const teams=[{id:25,name:'DAL'},{id:21,name:'COL'}];
const seasons=[20222023,20232024,20242025,20252026];
let historyCache:Promise<{rows:Game[];urls:string[];rejected:number;fetchedAt:string}>|null=null;
let reportCache:{at:number;report:unknown}|null=null;
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const logistic=(x:number)=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
async function fetchTeam(season:number,team:{id:number;name:string}) {
  const args=new URLSearchParams({isAggregate:'false',isGame:'true',start:'0',limit:'-1',cayenneExp:'seasonId='+season+' and gameTypeId=2 and teamId='+team.id});
  const url='https://api.nhle.com/stats/rest/en/skater/summary?'+args.toString();
  const response=await fetch(url,{signal:AbortSignal.timeout(24000)});
  if(!response.ok) throw Error('NHL unavailable '+team.name+' '+season+': HTTP '+response.status);
  const data=await response.json() as {total?:number;data?:Raw[]};
  if(!Array.isArray(data.data)||data.total!==data.data.length||data.data.length<200||data.data.length>3500)
    throw Error('NHL incomplete team-season '+team.name+' '+season);
  return {season,team:team.name,url,raw:data.data};
}
async function download() {
  const rows:Game[]=[], urls:string[]=[];
  const seen=new Set<string>();
  let rejected=0;
  for(const season of seasons) {
    // Limit parallel calls and reject missing team-seasons.
    const batches=await Promise.all(teams.map(team=>fetchTeam(season,team)));
    for(const batch of batches) {
      urls.push(batch.url);
      for(const r of batch.raw) {
        const player=r.playerId,game=r.gameId,shots=r.shots,toi=r.timeOnIcePerGame,date=r.gameDate;
        if(!Number.isInteger(player)||!Number.isInteger(game)||!Number.isInteger(shots)||!Number.isFinite(toi)||
          (shots as number)<0||(shots as number)>20||(toi as number)<60||(toi as number)>2400||
          typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
          Number(date.slice(0,4))<Math.floor(season/10000)||Number(date.slice(0,4))>Math.floor(season/10000)+1||
          String(game).slice(0,4)!==String(season).slice(0,4)||r.teamAbbrev!==batch.team||
          !['C','L','R','D'].includes(r.positionCode??'')||!['H','R'].includes(r.homeRoad??'')) {
          rejected++;continue;
        }
        const key=player+'|'+game;
        if(seen.has(key)) throw Error('Duplicate NHL player-game: '+key);
        seen.add(key);
        rows.push({player:player as number,game:game as number,date,season,team:batch.team,shots:shots as number,toi:toi as number,
          home:r.homeRoad==='H',defense:r.positionCode==='D'});
      }
    }
  }
  if(rows.length<4500||rejected>rows.length/20) throw Error('Official NHL source failed completeness threshold');
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.game-b.game||a.player-b.player);
  return {rows,urls,rejected,fetchedAt:new Date().toISOString()};
}
async function load() {
  if(!historyCache) historyCache=download().catch(e=>{historyCache=null;throw e;});
  return historyCache;
}
function makeObs(games:Game[],threshold:number):Obs[] {
  const byPlayer=new Map<number,Game[]>(),out:Obs[]=[];
  for(const g of games) {
    const prior=byPlayer.get(g.player)??[];
    if(prior.length>=5) {
      const last3=prior.slice(-3),last8=prior.slice(-8);
      const hits=last8.filter(x=>x.shots>=threshold).length;
      const gap=(Date.parse(g.date+'T00:00:00Z')-Date.parse(prior[prior.length-1].date+'T00:00:00Z'))/86400000;
      out.push({game:g.game,player:g.player,season:g.season,y:g.shots>=threshold?1:0,hits,n:last8.length,
        x:[mean(last3.map(x=>x.shots))/3,mean(last8.map(x=>x.shots))/3,
          mean(last3.map(x=>x.toi))/1200,mean(last8.map(x=>x.toi))/1200,
          hits/last8.length,g.home?1:0,g.defense?1:0,Math.min(60,Math.max(0,gap))/60]});
    }
    prior.push(g);byPlayer.set(g.player,prior);
  }
  return out;
}
function metrics(rows:Obs[],ps:number[]) {
  if(!rows.length||rows.length!==ps.length) throw Error('Invalid evaluation rows');
  let brier=0,logLoss=0,ece=0;
  const bins=Array.from({length:10},(_,i)=>({bin:i,n:0,p:0,y:0}));
  for(let i=0;i<rows.length;i++) {
    const p=Math.min(1-1e-9,Math.max(1e-9,ps[i])),y=rows[i].y;
    brier+=(p-y)**2;logLoss-=y*Math.log(p)+(1-y)*Math.log(1-p);
    const b=bins[Math.min(9,Math.floor(p*10))];b.n++;b.p+=p;b.y+=y;
  }
  ece=bins.reduce((s,b)=>s+Math.abs(b.p-b.y),0)/rows.length;
  return {n:rows.length,brier:brier/rows.length,logLoss:logLoss/rows.length,ece,
    outcomeRate:mean(rows.map(r=>r.y)),meanPredicted:mean(ps),
    reliability:bins.filter(b=>b.n).map(b=>({bin:b.bin,n:b.n,predicted:b.p/b.n,observed:b.y/b.n}))};
}
export function evaluateNhlShots(games:Game[],threshold:number, options:{trainingCap?:number;iterations?:number;bootstrapRuns?:number;includeHeldoutPredictions?:boolean}={}) {
  const obs=makeObs(games,threshold);
  const fullTrain=obs.filter(r=>r.season<=20232024),val=obs.filter(r=>r.season===20242025),test=obs.filter(r=>r.season===20252026);
  const train=options.trainingCap&&fullTrain.length>options.trainingCap
    ? fullTrain.filter((_,i)=>Math.floor((i+1)*options.trainingCap!/fullTrain.length)>Math.floor(i*options.trainingCap!/fullTrain.length))
    : fullTrain;
  if(train.length<700||val.length<200||test.length<200)
    throw Error('Insufficient chronological observations '+threshold+': '+[train.length,val.length,test.length].join('/'));
  const dims=8,base=(train.reduce((s,r)=>s+r.y,0)+1)/(train.length+2);
  const means=Array.from({length:dims},(_,j)=>mean(train.map(r=>r.x[j])));
  const scales=means.map((m,j)=>Math.sqrt(mean(train.map(r=>(r.x[j]-m)**2)))||1);
  const x=(rows:Obs[])=>rows.map(r=>[1,...r.x.map((v,j)=>Math.max(-8,Math.min(8,(v-means[j])/scales[j])))]);
  const a=x(train),b=x(val),c=x(test);
  const prediction=(rows:number[][],w:number[])=>rows.map(r=>logistic(r.reduce((s,v,j)=>s+v*w[j],0)));
  const trainFit=(lambda:number)=>{
    const w=Array(dims+1).fill(0) as number[];w[0]=Math.log(base/(1-base));
    for(let step=0;step<(options.iterations??180);step++) {
      const gradients=w.map(()=>0);
      for(let i=0;i<a.length;i++) {
        const err=logistic(a[i].reduce((s,v,j)=>s+v*w[j],0))-train[i].y;
        for(let j=0;j<gradients.length;j++) gradients[j]+=err*a[i][j];
      }
      for(let j=0;j<w.length;j++) w[j]-=0.2*(gradients[j]/a.length+(j===0?0:lambda*w[j]));
    }
    return w;
  };
  const selected=[0.001,0.01,0.1].map(lambda=>{
    const w=trainFit(lambda);return {lambda,w,loss:metrics(val,prediction(b,w)).logLoss};
  }).sort((l,r)=>l.loss-r.loss)[0];
  const probs=prediction(c,selected.w);
  const baselineProbs=test.map(r=>(r.hits+2*base)/(r.n+2));
  const model=metrics(test,probs),rolling=metrics(test,baselineProbs);
  const groups=new Map<number,number[]>();
  test.forEach((r,i)=>groups.set(r.game,[...(groups.get(r.game)??[]),i]));
  const events=[...groups.values()];
  let seed=20261014;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const improvements:number[]=[];
  for(let bootstrap=0;bootstrap<(options.bootstrapRuns??300);bootstrap++) {
    let n=0,difference=0;
    for(let i=0;i<events.length;i++) {
      const group=events[Math.floor(random()*events.length)];
      for(const j of group) {difference+=(baselineProbs[j]-test[j].y)**2-(probs[j]-test[j].y)**2;n++;}
    }
    improvements.push(difference/n);
  }
  improvements.sort((l,r)=>l-r);
  const ci:[number,number]=[improvements[Math.floor(improvements.length*0.025)],improvements[Math.min(improvements.length-1,Math.floor(improvements.length*0.975))]];
  return {line:threshold===2?'Over 1.5 shots':'Over 2.5 shots',threshold,
    splits:{train:fullTrain.length,trainingRowsUsed:train.length,validation:val.length,heldOutTest:test.length},
    features:['prior_3_shots','prior_8_shots','prior_3_TOI','prior_8_TOI','prior_8_hit_rate','home','defense','days_since_last_sampled_game'],
    selectedRegularization:selected.lambda,validation:metrics(val,prediction(b,selected.w)),test:model,
    benchmarks:{rollingPriorHitRate:rolling,constantTrainingRate:metrics(test,test.map(()=>base))},
    brierImprovementVsRolling:rolling.brier-model.brier,
    improvement95Bootstrap:ci,bootstrapEvents:events.length,
    clearBaselineWith95Confidence:ci[0]>0,
    uncertaintyDescription:'Fixed-seed game-cluster resamples of aggregate Brier improvement, not player-level uncertainty',
    ...(options.includeHeldoutPredictions?{heldoutPredictions:test.map((r,i)=>({gameId:r.game,playerId:r.player,threshold,probability:probs[i],outcome:r.y}))}:{})};
}
export async function nhlShotsBacktest() {
  if(reportCache&&Date.now()-reportCache.at<1800000) return reportCache.report;
  const data=await load();
  const report={status:'HISTORICAL_RESEARCH_ONLY',recommendation:'HOLD',liveApproved:false,verifiedPositiveEv:false,
    modelVersion:'nhl-sog-dal-col-retrospective-v1',
    source:{provider:'Official NHL Stats REST API',urls:data.urls,teams,seasons,regularSeasonOnly:true,
      gameRows:data.rows.length,players:new Set(data.rows.map(r=>r.player)).size,rejectedRows:data.rejected,fetchedAt:data.fetchedAt,
      completeApiCountsChecked:true,originalPublicationVintageVerified:false},
    design:'Train 2022-23 and 2023-24; select regularization using 2024-25; untouched 2025-26 test. Features use prior observed games only.',
    markets:[evaluateNhlShots(data.rows,2),evaluateNhlShots(data.rows,3)],
    blockingIssues:['Dallas and Colorado only; not a representative league-wide sample.',
      'Trades/games outside DAL and COL create gaps in some prior player histories.',
      'Historical game logs lack current injury, confirmed lineup, projected ice time and line-combination effects.',
      'No archived point-in-time historical feature vintages.',
      'No matched contemporaneous bookmaker prices or settlement terms for a market-beating/ROI test.',
      'No validated per-player forecast uncertainty or joint parlay model.'],
  };
  reportCache={at:Date.now(),report};return report;
}