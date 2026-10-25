import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReceivingForwardEvaluation} from '../../apps/edgeboard/backend/receivingForwardEvaluation.ts';
import {createReceivingForwardOutcomeLoader} from '../../apps/edgeboard/backend/receivingForwardOutcomes.ts';
import {quoteSnapshotItems} from '../../apps/edgeboard/backend/quoteSnapshotPayload.ts';

test('a stalled archive read has a bounded evaluation deadline and never starts outcome reads',async()=>{
 let outcomes=0;const evaluate=createReceivingForwardEvaluation({deadlineMs:15,readPage:async()=>new Promise(()=>{}),loadOutcomes:async()=>{outcomes++;throw Error('NOT_EXPECTED');}});
 await assert.rejects(evaluate('alice'),/EVALUATION_TIMEOUT/);assert.equal(outcomes,0);
 assert.throws(()=>createReceivingForwardEvaluation({deadlineMs:26001}),/DEADLINE_INVALID/);
});
test('future saved games do not request outcome sources or become losses',async()=>{
 let reads=0;const load=createReceivingForwardOutcomeLoader({now:()=>Date.parse('2026-10-25T00:00:00Z'),loadText:async()=>{reads++;throw Error('NO_NETWORK');}});
 const result=await load([{forecast:{kickoffAt:'2026-10-26T00:00:00Z'}}] as never);
 assert.equal(reads,0);assert.equal(result.source.status,'NOT_REQUESTED');assert.deepEqual(result.outcomes,[]);
});
test('malformed quoted source fields fail closed before summaries or outcome scoring',async()=>{
 let reads=0;const load=createReceivingForwardOutcomeLoader({now:()=>Date.parse('2026-10-27T00:00:00Z'),loadText:async()=>{reads++;return 'game_id,season,game_type,gameday,gametime,home_team,away_team,home_score,away_score,espn\n"unterminated';}});
 const result=await load([{forecast:{playerId:'p',gameId:'2026_08_SEA_LA',kickoffAt:'2026-10-25T17:00:00Z'}}] as never);
 assert.equal(reads,1);assert.notEqual(result.source.status,'AVAILABLE');assert.deepEqual(result.outcomes,[]);
});
test('aggregate quote archive budget is enforced even when every individual item fits',()=>{
 const quotes=Array.from({length:6},()=>({eventId:'123456',evidence:'a'.repeat(160000)}));
 assert.throws(()=>quoteSnapshotItems('alice','123456','props','version',quotes as never),/request byte limit/);
 const result=quoteSnapshotItems('alice','123456','props','version',quotes.slice(0,1) as never);assert.equal(result.length,2);
});
