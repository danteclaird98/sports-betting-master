import { test } from 'node:test';
import assert from 'node:assert/strict';
import artifact from '../../apps/edgeboard/backend/correctedReceivingArtifact.json' with { type: 'json' };
import { canonicalJson } from '../../apps/edgeboard/backend/correctedReceiving.ts';
import { createReceivingForwardService, receivingForwardProtocol, forwardHash, type ForwardReceipt } from '../../apps/edgeboard/backend/receivingForwardCore.ts';
import { evaluateReceivingForward, type ForwardOutcome, type ForwardOutcomeSource } from '../../apps/edgeboard/backend/receivingForwardEvaluationCore.ts';

const frozen=await receivingForwardProtocol();
const now=Date.parse(frozen.protocol.frozenAt)+60_000;
const kickoff=now+3_600_000;
const observed=kickoff+4*3_600_000;
const source:ForwardOutcomeSource={status:'AVAILABLE',retrievedAt:new Date(observed).toISOString(),
  files:[{url:'https://example.org/synthetic-outcomes.csv',sha256:'a'.repeat(64),observedAt:new Date(observed).toISOString()}],publicationClockVerified:false};
const final=(playerId:string,gameId:string,yards:number):ForwardOutcome=>({playerId,gameId,seasonType:'REG',position:'WR',receivingYards:yards,finalStatus:'FINAL'});
async function saved(playerId='player',gameId='game',features=[50,45,.5,.375,8]):Promise<ForwardReceipt>{
  const logit=artifact.intercept+features.reduce((sum,x,i)=>sum+artifact.coefficients[i]*(x-artifact.mean[i])/artifact.scale[i],0);
  const rawProbability=1/(1+Math.exp(-logit));
  const calibratedProbability=1/(1+Math.exp(-(artifact.calibration.intercept+artifact.calibration.slope*logit)));
  const forecast={playerId,gameId,features,kickoffAt:new Date(kickoff).toISOString(),decisionAt:new Date(now).toISOString(),
    calculationStatus:'CALCULATED',artifactSha256:frozen.protocol.artifactSha256,modelVersion:frozen.protocol.modelVersion,
    probability:artifact.calibration.selected?calibratedProbability:rawProbability,rawProbability,calibratedProbability,
    bettingDecision:'HOLD',liveApproved:false,verifiedPositiveEv:false,executionEnabled:false,
    scope:'CONDITIONAL_RECORDED_PLAYER_RECEIVING_60_PLUS',sourceReceipt:{retrievedAt:new Date(now-1000).toISOString()}};
  const records=new Map<string,ForwardReceipt>();
  const service=createReceivingForwardService({owner:'alice',now:()=>now,forecast:(async()=>forecast) as never,
    store:{get:async id=>records.get(id)??null,add:async row=>{records.set(row.id,row);return true;},list:async()=>({items:[...records.values()],nextToken:null})}});
  return (await service.save({playerId,gameId})).item;
}
const run=(receipts:ForwardReceipt[],outcomes:ForwardOutcome[],options:Partial<Parameters<typeof evaluateReceivingForward>[0]>={})=>
  evaluateReceivingForward({owner:'alice',receipts,outcomes,source,cohortComplete:true,...options});

test('exact final rows use frozen 60-yard target and all three proper-score variants',async()=>{
  const a=await saved('p1','g1'),b=await saved('p2','g2');
  const result=await run([a,b],[final('p1','g1',60),final('p2','g2',59)]);
  assert.equal(result.scoredCount,2);assert.equal(result.unresolvedCount,0);assert.equal(result.uniqueScoredGames,2);
  assert.deepEqual(result.rows.map(row=>row.status==='SCORED'?row.outcome:null),[1,0]);
  assert.ok(result.scores.selected);assert.ok(result.scores.raw);assert.ok(result.scores.trainBaseRate);
  const p=a.forecast.probability;
  assert.ok(Math.abs(result.scores.selected!.brier-((p-1)**2+p**2)/2)<1e-12);
  assert.ok(Math.abs(result.scores.selected!.logLoss-(-Math.log(p)-Math.log(1-p))/2)<1e-12);
  assert.equal(result.bettingDecision,'HOLD');assert.equal(result.liveApproved,false);assert.equal(result.verifiedPositiveEv,false);assert.equal(result.executionEnabled,false);
  assert.equal(result.source.publicationClockVerified,false);
});
test('missing, duplicate, invalid and non-final rows remain unresolved instead of losses',async()=>{
  const records=await Promise.all(['missing','duplicate','invalid','notfinal','scope'].map(id=>saved(id,id)));
  const rows=[final('duplicate','duplicate',80),final('duplicate','duplicate',80),
    {...final('invalid','invalid',80),receivingYards:NaN},
    {...final('notfinal','notfinal',80),finalStatus:'UNKNOWN' as const,unresolvedReason:'GAME_COMPLETION_UNVERIFIED'},
    {...final('scope','scope',80),seasonType:'POST'}];
  const result=await run(records,rows);
  assert.equal(result.scoredCount,0);assert.equal(result.unresolvedCount,5);
  assert.deepEqual(result.rows.map(row=>row.reason),['PUBLISHED_PLAYER_ROW_MISSING','PUBLISHED_PLAYER_ROW_AMBIGUOUS','RECEIVING_YARDS_INVALID','GAME_COMPLETION_UNVERIFIED','OUTCOME_OUTSIDE_FROZEN_SCOPE']);
  assert.deepEqual(result.scores,{selected:null,raw:null,trainBaseRate:null});
});
test('negative receiving yards are valid losses, absent yards are unresolved',async()=>{
  const a=await saved('negative','g1'),b=await saved('absent','g2');
  const result=await run([a,b],[final('negative','g1',-2),{...final('absent','g2',0),receivingYards:null}]);
  assert.equal(result.scoredCount,1);assert.equal(result.unresolvedCount,1);
  assert.equal(result.rows[0].status==='SCORED'?result.rows[0].outcome:null,0);
});
test('receipt tampering, unknown protocols and duplicate archives do not get pooled',async()=>{
  const a=await saved();
  const changed={...a,forecast:{...a.forecast,probability:.99}};
  const unknown={...a,protocolSha256:'b'.repeat(64)};
  assert.equal((await run([changed],[final('player','game',80)])).scoredCount,0);
  assert.equal((await run([unknown],[final('player','game',80)])).rows[0].reason,'PROTOCOL_NOT_SUPPORTED');
  const duplicate=await run([a,a],[final('player','game',80)]);
  assert.equal(duplicate.scoredCount,0);assert.equal(duplicate.unresolvedCount,2);
});
test('a rehashed forged probability still fails the archive frozen-model verification',async()=>{
  const a=await saved();
  const {receiptSha256:ignored,...forged}={...a,forecast:{...a.forecast,probability:.99}};
  const result=await run([{...forged,receiptSha256:await forwardHash(canonicalJson(forged))}],[final('player','game',80)]);
  assert.equal(result.scoredCount,0);assert.equal(result.rows[0].reason,'FORECAST_RECEIPT_INTEGRITY_FAILURE');
});
test('owner mismatch aborts and unavailable source stays explicitly unresolved',async()=>{
  const a=await saved();
  await assert.rejects(run([{...a,owner:'bob'}],[]),/OWNER_MISMATCH/);
  const result=await run([a],[final('player','game',80)],{source:{...source,status:'NOT_REQUESTED',files:[],reason:'NO_COMPLETED_GAMES_TO_EVALUATE'}});
  assert.equal(result.rows[0].reason,'NO_COMPLETED_GAMES_TO_EVALUATE');
  assert.equal(result.scoredCount,0);
});
test('adapter identity/finality reasons survive even when player scope is not known',async()=>{
  const a=await saved();
  const result=await run([a],[{playerId:'player',gameId:'game',seasonType:'UNKNOWN',position:'UNKNOWN',receivingYards:null,finalStatus:'UNKNOWN',unresolvedReason:'SCHEDULE_IDENTITY_UNVERIFIED'}]);
  assert.equal(result.rows[0].reason,'SCHEDULE_IDENTITY_UNVERIFIED');assert.equal(result.scoredCount,0);
});
test('outcome snapshots captured before kickoff cannot score a forecast',async()=>{
  const a=await saved();
  const early={...source,files:[{...source.files[0],observedAt:new Date(kickoff-1000).toISOString()}]};
  const result=await run([a],[final('player','game',80)],{source:early});
  assert.equal(result.rows[0].reason,'OUTCOME_OBSERVED_BEFORE_KICKOFF');assert.equal(result.scoredCount,0);
});
test('partial cohort exposes limited scope and no future source request is implied',async()=>{
  const a=await saved();
  const result=await run([a],[final('player','game',80)],{cohortComplete:false});
  assert.equal(result.evaluationStatus,'PARTIAL_COHORT');assert.equal(result.cohortComplete,false);
  assert.equal(result.recordsIncluded,1);assert.equal(result.scores.selected!.n,1);
  assert.match(result.limitations.join(' '),/incomplete/);
  const empty=await run([],[],{source:{...source,status:'NOT_REQUESTED',files:[],reason:'NO_SAVED_FORECASTS'}});
  assert.equal(empty.scoredCount,0);assert.equal(empty.recordsIncluded,0);
  assert.equal(empty.evaluationStatus,'NO_SCORABLE_OUTCOMES');
});
test('clipped log loss remains finite for legitimate arithmetic endpoints',async()=>{
  const zero=await saved('zero','zero',[-1e6,-1e6,.5,.375,8]);
  const one=await saved('one','one',[1e6,1e6,.5,.375,8]);
  assert.equal(zero.forecast.probability,0);assert.equal(one.forecast.probability,1);
  const result=await run([zero,one],[final('zero','zero',60),final('one','one',59)]);
  assert.equal(result.scoredCount,2);assert.equal(result.scores.selected!.brier,1);
  assert.equal(Number.isFinite(result.scores.selected!.logLoss),true);
  assert.ok(result.scores.selected!.logLoss>30);
});
test('explicit final-game windows are preserved without pooling and invalid metadata cannot score',async()=>{
  const a=await saved();
  const window={offset:0,maximum:8 as const,totalDueGames:12,checked:8,nextOffset:8};
  const result=await run([a],[final('player','game',80)],{source:{...source,finalGameWindow:window}});
  assert.equal(result.scoredCount,1);assert.deepEqual(result.source.finalGameWindow,window);
  for(const invalid of [
    {...window,offset:-1}, {...window,maximum:16}, {...window,checked:9},
    {...window,nextOffset:7}, {...window,nextOffset:null}, {...window,checked:0}, {...window,totalDueGames:201},
  ]) {
    const blocked=await run([a],[final('player','game',80)],{source:{...source,finalGameWindow:invalid as never}});
    assert.equal(blocked.scoredCount,0);assert.equal(blocked.rows[0].reason,'FINAL_GAME_WINDOW_INVALID');
  }
  const exhausted={offset:16,maximum:8 as const,totalDueGames:12,checked:0,nextOffset:null};
  const emptyWindow=await run([],[],{source:{...source,status:'NOT_REQUESTED',files:[],finalGameWindow:exhausted}});
  assert.deepEqual(emptyWindow.source.finalGameWindow,exhausted);
});

test('conflicting scope rows for the same player and game remain ambiguous',async()=>{
  const receipt=await saved();
  for(const conflicting of [
    {...final('player','game',59),seasonType:'POST'},
    {...final('player','game',59),position:'QB'},
  ]) {
    const report=await run([receipt],[final('player','game',60),conflicting]);
    assert.equal(report.scoredCount,0);
    assert.equal(report.unresolvedCount,1);
    assert.equal(report.rows[0].reason,'PUBLISHED_PLAYER_ROW_AMBIGUOUS');
    assert.equal(report.scores.selected,null);
  }
});
