import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalSgoStore} from '../../apps/edgeboard/backend/sportsGameOddsSqlite.ts';
import {createSgoService} from '../../apps/edgeboard/backend/sportsGameOddsCore.ts';
const input={requestId:'11111111-1111-4111-8111-111111111111',league:'NFL',mode:'upcoming',cursor:null,confirmRequest:true} as const;
test('durable SGO reservations fence duplicates, recover pending receipts and isolate owners',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sgo-parity-'));const path=join(dir,'research.sqlite3');
 const first=await createLocalSgoStore('alice',path),second=await createLocalSgoStore('alice',path),other=await createLocalSgoStore('bob',path);
 try{
  const attempts=await Promise.allSettled([first.reserve(input,'hash',1000),second.reserve({...input,requestId:'22222222-2222-4222-8222-222222222222'},'hash',1000)]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await first.find(input))?.status,'PENDING');
  assert.equal(await other.find(input),null);
  assert.equal((await second.history('NFL','upcoming')).items.length,1);
  await first.finish(input,{reason:'SOURCE_UNAVAILABLE'});
  assert.equal((await second.find(input))?.status,'FAILED');
  await assert.rejects(first.finish(input,{reason:'again'}),/RECONCILIATION/);
  await assert.rejects(second.reserve(input,'hash',1001),/COOLDOWN/);
  await other.reserve(input,'hash',1000);assert.equal((await other.find(input))?.status,'PENDING');
 }finally{first.close();second.close();other.close();}
 const restarted=await createLocalSgoStore('alice',path);try{assert.equal((await restarted.find(input))?.status,'FAILED');}finally{restarted.close();rmSync(dir,{recursive:true,force:true});}
});
test('SGO requires explicit confirmation and absent credentials performs no provider request',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sgo-missing-'));const store=await createLocalSgoStore('alice',join(dir,'research.sqlite3'));let requests=0;
 try{const service=createSgoService({store,key:async()=>null,fetch:async()=>{requests++;throw Error('NO_NETWORK');}});
 await assert.rejects(service.refresh({...input,confirmRequest:false}));
 const result=await service.refresh(input);assert.equal(result.status,'UNCONFIGURED');assert.equal(result.requestsUsed,0);assert.equal(result.executionEnabled,false);assert.equal(requests,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('SGO paid-request transport refuses redirects and persists the failed attempt without retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sgo-redirect-'));const store=await createLocalSgoStore('alice',join(dir,'research.sqlite3'));let requests=0;
 try{const service=createSgoService({store,key:async()=>'fixture-not-real',fetch:async(_url,options)=>{requests++;assert.equal(options.redirect,'error');throw Error('REDIRECT_BLOCKED');}});
 const result=await service.refresh(input);assert.equal(result.executionEnabled,false);assert.equal(requests,1);
 const replay=await service.refresh(input);assert.equal(replay.status,'RECONCILE_REQUIRED');assert.equal(requests,1);assert.equal((await store.find(input))?.status,'FAILED');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
