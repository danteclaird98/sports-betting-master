import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingForwardEvaluation } from '../../apps/edgeboard/backend/receivingForwardEvaluation.ts';
import { receivingForwardProtocol } from '../../apps/edgeboard/backend/receivingForwardCore.ts';
import { parseReceivingEvaluation } from '../../apps/edgeboard/shared/receivingEvaluationReport.ts';
import { createSgoOwnerSession } from '../../apps/edgeboard/shared/sgoOwner.ts';

const noOutcomes = async () => ({outcomes:[],source:{status:'NOT_REQUESTED' as const,
  retrievedAt:'2026-10-25T22:00:00Z',files:[],publicationClockVerified:false as const,reason:'NO_SAVED_FORECASTS'}});
const page = async (owner='alice',nextToken:string|null=null) => ({...(await receivingForwardProtocol()),owner,items:[],nextToken});

test('empty verified archive produces null scores without any source request', async () => {
  const evaluate = createReceivingForwardEvaluation({readPage:async owner => page(owner),loadOutcomes:noOutcomes});
  const report = await evaluate('alice');
  assert.equal(report.recordsIncluded,0);
  assert.equal(report.cohortComplete,true);
  assert.equal(report.source.reason,'NO_SAVED_FORECASTS');
  assert.equal(report.scores.selected,null);
  assert.equal(report.readOnly,true);
  assert.doesNotThrow(()=>parseReceivingEvaluation(report,'alice'));
});
test('pagination is bounded and a continuation batch cannot claim whole-cohort coverage', async () => {
  let calls=0;
  const evaluate=createReceivingForwardEvaluation({readPage:async owner => page(owner,String(++calls)),loadOutcomes:noOutcomes});
  const report=await evaluate('alice');
  assert.equal(calls,20);
  assert.equal(report.historyRange.nextToken,'20');
  assert.equal(report.cohortComplete,false);
  assert.equal(report.evaluationStatus,'PARTIAL_COHORT');
  const next=createReceivingForwardEvaluation({readPage:async owner=>page(owner),loadOutcomes:noOutcomes});
  const result=await next('alice',{nextToken:'after-200'});
  assert.equal(result.historyRange.startToken,'after-200');
  assert.equal(result.cohortComplete,false);
});
test('owner mismatch, failed receipt verification and cursor cycles abort before outcome loading', async () => {
  let loads=0;
  const loadOutcomes=async()=>{loads++;return noOutcomes();};
  await assert.rejects(createReceivingForwardEvaluation({readPage:async()=>page('bob'),loadOutcomes})('alice'),/HISTORY_RESPONSE_UNVERIFIED/);
  await assert.rejects(createReceivingForwardEvaluation({readPage:async()=>{throw Error('FORECAST_RECEIPT_INTEGRITY_FAILURE');},loadOutcomes})('alice'),/INTEGRITY/);
  await assert.rejects(createReceivingForwardEvaluation({readPage:async owner=>page(owner,'cycle'),loadOutcomes})('alice'),/PAGINATION_CYCLE/);
  assert.equal(loads,0);
});
test('client outcomes, probabilities and invalid evaluation windows are rejected', async () => {
  let reads=0;
  const evaluate=createReceivingForwardEvaluation({readPage:async owner=>{reads++;return page(owner);},loadOutcomes:noOutcomes});
  for(const body of [{probability:1},{outcomes:[]},{nextToken:''},{finalGameOffset:-1},{finalGameOffset:200},{finalGameOffset:1.5}])
    await assert.rejects(evaluate('alice',body),/INVALID_/);
  await assert.rejects(evaluate('',{}),/AUTHENTICATION_REQUIRED/);
  assert.equal(reads,0);
});
test('final-game continuation keeps the archive batch and explicit check offset', async () => {
  let captured:number|undefined;
  const evaluate=createReceivingForwardEvaluation({readPage:async owner=>page(owner),loadOutcomes:async (_rows,offset)=>{captured=offset;return noOutcomes();}});
  const result=await evaluate('alice',{nextToken:'private-cursor',finalGameOffset:8});
  assert.equal(captured,8);
  assert.equal(result.historyRange.startToken,'private-cursor');
});
test('private response validation rejects wrong owners, impossible metrics and approvals', async () => {
  const evaluate=createReceivingForwardEvaluation({readPage:async owner=>page(owner),loadOutcomes:noOutcomes});
  const good=await evaluate('alice');
  for(const bad of [{...good,owner:'bob'},{...good,liveApproved:true},{...good,readOnly:false},
    {...good,scores:{...good.scores,selected:{n:1,brier:0,logLoss:0}}},
    {...good,rows:[null]},{...good,scoredCount:1},
    {...good,source:{...good.source,retrievedAt:'not-a-date'}}])
    assert.throws(()=>parseReceivingEvaluation(bad,'alice'),/could not be verified/);
});
test('rendered outcomes, source status and cohort labels must agree with the metrics', async () => {
  const evaluate=createReceivingForwardEvaluation({readPage:async owner=>page(owner),loadOutcomes:noOutcomes});
  const empty=await evaluate('alice');
  const scored={...empty,recordsIncluded:1,scoredCount:1,unresolvedCount:0,uniqueScoredGames:1,evaluationStatus:'DESCRIPTIVE_SCORES_AVAILABLE',
    scores:{selected:{n:1,brier:0.1,logLoss:0.2},raw:{n:1,brier:0.1,logLoss:0.2},trainBaseRate:{n:1,brier:0.1,logLoss:0.2}},
    rows:[{receiptId:'synthetic',playerId:'player',gameId:'game',status:'SCORED',reason:'EXACT_PUBLISHED_FINAL_PLAYER_ROW',receivingYards:60,outcome:1}],
    source:{...empty.source,status:'AVAILABLE',files:[{url:'https://example.com/synthetic',sha256:'a'.repeat(64),observedAt:empty.source.retrievedAt}]}};
  assert.doesNotThrow(()=>parseReceivingEvaluation(scored,'alice'));
  for(const bad of [
    {...scored,rows:[{...scored.rows[0],outcome:0}]},
    {...scored,source:{...scored.source,status:'UNAVAILABLE'}},
    {...scored,historyRange:{...scored.historyRange,nextToken:'more'}},
    {...scored,historyRange:{...scored.historyRange,startToken:'past',startsAtBeginning:false}},
    {...scored,evaluationStatus:'NO_SCORABLE_OUTCOMES'},
  ]) assert.throws(()=>parseReceivingEvaluation(bad,'alice'),/could not be verified/);
});
test('an account switch during delayed evaluation invalidates the old receipt ticket', async () => {
  let owner:string|null='alice';
  const guard=createSgoOwnerSession(async()=>owner,()=>{});
  const ticket=await guard.capture();
  owner='bob';await guard.sync();
  owner='alice';await guard.sync();
  assert.equal(await guard.accepts(ticket,'alice'),false);
  assert.equal(await guard.accepts(await guard.capture(),'alice'),true);
});

test('evaluation-wide deadline terminates a hung private history read without source requests', async () => {
  let loads=0;
  const evaluate=createReceivingForwardEvaluation({
    deadlineMs:50,
    readPage:async()=>new Promise<never>(()=>{}),
    loadOutcomes:async()=>{loads++;return noOutcomes();},
  });
  await assert.rejects(evaluate('alice'),/EVALUATION_TIMEOUT/);
  assert.equal(loads,0);
});
test('a history page completing after the deadline cannot start another read or public source load', async () => {
  let reads=0,loads=0;
  let release:((value:Awaited<ReturnType<typeof page>>)=>void)|undefined;
  const evaluate=createReceivingForwardEvaluation({
    deadlineMs:50,
    readPage:async()=>{reads++;return new Promise(resolve=>{release=resolve;});},
    loadOutcomes:async()=>{loads++;return noOutcomes();},
  });
  await assert.rejects(evaluate('alice'),/EVALUATION_TIMEOUT/);
  assert.ok(release);
  release(await page('alice','later-page'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);
  assert.equal(loads,0);
});
test('evaluation timeout propagates cancellation to an outstanding outcomes load', async () => {
  let observed:AbortSignal|undefined;
  const evaluate=createReceivingForwardEvaluation({
    deadlineMs:50,
    readPage:async owner=>page(owner),
    loadOutcomes:async(_receipts,_offset,signal)=>{
      observed=signal;
      return new Promise<never>(()=>{});
    },
  });
  await assert.rejects(evaluate('alice'),/EVALUATION_TIMEOUT/);
  assert.ok(observed);
  assert.equal(observed.aborted,true);
});
test('fast success clears the overall timer and does not later abort its source signal', async () => {
  let observed:AbortSignal|undefined;
  const evaluate=createReceivingForwardEvaluation({
    deadlineMs:50,
    readPage:async owner=>page(owner),
    loadOutcomes:async(_receipts,_offset,signal)=>{observed=signal;return noOutcomes();},
  });
  const result=await evaluate('alice');
  assert.equal(result.bettingDecision,'HOLD');
  assert.ok(observed);
  await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(observed.aborted,false);
});
test('overall evaluation deadlines reject invalid configurations',()=>{
  for(const deadlineMs of [0,-1,26_001,NaN,Infinity,1.5])
    assert.throws(()=>createReceivingForwardEvaluation({deadlineMs}),/EVALUATION_DEADLINE_INVALID/);
});
