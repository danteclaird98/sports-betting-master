import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLocalSgoStore } from '../../apps/edgeboard/backend/sportsGameOddsSqlite.ts';
import { createSgoService, SGO_INTERVAL } from '../../apps/edgeboard/backend/sportsGameOddsCore.ts';
const folder=mkdtempSync(join(tmpdir(),'sgo-port-'));
test.after(()=>rmSync(folder,{recursive:true,force:true}));
const input=()=>({requestId:randomUUID(),league:'NFL' as const,mode:'upcoming' as const,cursor:null,confirmRequest:true as const});

test('SGO persists receipts, enforces cooldown across connections and isolates owners',async()=>{
  const path=join(folder,'durable.sqlite3');
  let clock=Date.parse('2026-10-25T22:00:00Z'),calls=0;
  const fetcher:typeof fetch=async()=>{calls++;return Response.json({success:true,data:[]});};
  const request=input();
  const store=await createLocalSgoStore('owner-a',path);
  const service=createSgoService({store,key:async()=> 'fixture-only',fetch:fetcher,now:()=>clock});
  assert.equal((await service.refresh(request)).status,'NO_QUOTES');
  await assert.rejects(service.refresh(input()),/REFRESH_COOLDOWN_OR_PENDING_REQUEST/);
  assert.equal(calls,1);
  store.close();
  const reopened=await createLocalSgoStore('owner-a',path);
  const replay=createSgoService({store:reopened,key:async()=> 'fixture-only',fetch:fetcher,now:()=>clock});
  assert.equal((await replay.refresh(request)).status,'REPLAYED');
  assert.equal(calls,1);
  const history=await reopened.history('NFL','upcoming');
  assert.equal(history.items[0].owner,'owner-a');
  assert.equal(history.items[0].status,'COMPLETE');
  const other=await createLocalSgoStore('owner-b',path);
  assert.deepEqual((await other.history('NFL','upcoming')).items,[]);
  assert.equal(await other.find(request),null);
  clock+=SGO_INTERVAL;
  assert.equal((await replay.refresh(input())).status,'NO_QUOTES');
  assert.equal(calls,2);
  other.close(); reopened.close();
});

test('SGO provider failures are explicit, sanitized and never retried',async()=>{
  for(const status of [401,403,429,500]) {
    const store=await createLocalSgoStore('owner',join(folder,`failure-${status}.sqlite3`));
    let calls=0;
    const request=input();
    const service=createSgoService({store,key:async()=> 'fixture-only',fetch:async()=>{calls++;return new Response('private provider details',{status});}});
    const result=await service.refresh(request);
    assert.equal(result.status,'ERROR');
    assert.equal(result.snapshot,null);
    assert.equal(result.requestsUsed,1);
    assert.equal(result.bettingDecision,'HOLD');
    assert.doesNotMatch(JSON.stringify(result),/private provider details|fixture-only/);
    assert.equal((await service.refresh(request)).status,'RECONCILE_REQUIRED');
    await assert.rejects(service.refresh(input()),/REFRESH_COOLDOWN_OR_PENDING_REQUEST/);
    assert.equal(calls,1);
    store.close();
  }
});

test('SGO unconfirmed save leaves a pending receipt and blocks provider replay',async()=>{
  const store=await createLocalSgoStore('owner',join(folder,'uncertain.sqlite3'));
  let calls=0;
  const request=input();
  const service=createSgoService({store:{...store,finish:async()=>{throw Error('storage unavailable');}},key:async()=> 'fixture-only',
    fetch:async()=>{calls++;return Response.json({success:true,data:[]});}});
  const result=await service.refresh(request);
  assert.equal(result.status,'RECONCILE_REQUIRED');
  assert.equal(result.reason,'REQUEST_OR_SAVE_UNCONFIRMED');
  assert.equal((await service.refresh(request)).requestsUsed,0);
  assert.equal(calls,1);
  assert.equal((await store.find(request))?.status,'PENDING');
  store.close();
});

test('SGO no key or missing consent makes no provider request',async()=>{
  const store=await createLocalSgoStore('owner',join(folder,'off.sqlite3'));
  let calls=0;
  const service=createSgoService({store,key:async()=>null,fetch:async()=>{calls++;throw Error('unexpected');}});
  assert.equal((await service.refresh(input())).status,'UNCONFIGURED');
  await assert.rejects(service.refresh({...input(),confirmRequest:false}),/Confirm one provider request/);
  assert.equal(calls,0);
  assert.deepEqual((await store.history('NFL','upcoming')).items,[]);
  store.close();
});

test('SGO concurrent refresh reservations allow one provider call and reject cross-owner cursors',async()=>{
  const path=join(folder,'concurrent.sqlite3');
  const first=await createLocalSgoStore('owner-a',path), second=await createLocalSgoStore('owner-a',path);
  let calls=0, clock=Date.now();
  const deps={key:async()=> 'fixture-only',fetch:async()=>{calls++;return Response.json({success:true,data:[]});},now:()=>clock};
  const results=await Promise.allSettled([
    createSgoService({...deps,store:first}).refresh(input()),
    createSgoService({...deps,store:second}).refresh(input()),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(calls,1);
  for(let i=0;i<3;i++) {clock+=SGO_INTERVAL;await createSgoService({...deps,store:first}).refresh(input());}
  const page=await first.history('NFL','upcoming');
  assert.ok(page.nextToken);
  const other=await createLocalSgoStore('owner-b',path);
  await assert.rejects(other.history('NFL','upcoming',page.nextToken!),/INVALID_HISTORY_TOKEN/);
  other.close();first.close();second.close();
});
