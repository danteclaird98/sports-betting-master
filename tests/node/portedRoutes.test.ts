import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const folder=mkdtempSync(join(tmpdir(),'ported-routes-'));
process.env.EDGEBOARD_DB=join(folder,'edgeboard.sqlite3');
for(const name of ['SPORTSGAMEODDS_KEY','ODDS_BACKEND_URL','ODDS_BACKEND_READ_TOKEN']) delete process.env[name];
async function load(tamper=false) {
  const outfile=join(folder,tamper?'tampered.mjs':'routes.mjs');
  await build({entryPoints:['apps/edgeboard/backend/index.ts'],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent',
    plugins:tamper?[{name:'tampered-fixture',setup(builder){builder.onLoad({filter:/correctedReceivingArtifact\.json$/},args=>{
      const artifact=JSON.parse(readFileSync(args.path,'utf8'));artifact.intercept+=1;
      return {contents:JSON.stringify(artifact),loader:'json'};
    });}}]:[]});
  return (await import(pathToFileURL(outfile).href)).handler;
}
const handler=await load();
const call=(method:string,path:string,body?:unknown,owner:string|null='owner',query:Record<string,string>={})=>
  handler({method,path,body,query,...(owner?{user:{userId:owner}}:{})});
test.after(()=>rmSync(folder,{recursive:true,force:true}));

test('actual SGO routes require auth and reject mismatched owners before provider or storage access',async()=>{
  assert.equal((await call('GET','/api/sgo/status',undefined,null)).data.configured,false);
  for(const [method,path] of [['POST','/api/sgo/refresh'],['GET','/api/sgo/history']]) {
    assert.equal((await call(method,path,{},null)).status,401);
    assert.equal((await call(method,path,{},'owner',{owner:'someone-else'})).status,403);
  }
  const rejected=await call('POST','/api/sgo/refresh',{},'owner',{owner:'owner'});
  assert.equal(rejected.status,400);
  assert.match(rejected.data.error,/No automatic provider retry/);
});

test('actual ledger routes return owner and reject cross-owner saves without changing either ledger',async()=>{
  assert.equal((await call('POST','/api/wager-ledger',{wagers:[]},null)).status,401);
  const before=await call('GET','/api/wager-ledger');
  assert.equal(before.data.owner,'owner');
  const response=await call('POST','/api/wager-ledger',{owner:'someone-else',wagers:[]});
  assert.equal(response.status,403);
  assert.equal(response.data.error,'Account changed. Reload the private ledger before saving.');
  assert.deepEqual((await call('GET','/api/wager-ledger')).data,before.data);
  assert.deepEqual((await call('GET','/api/wager-ledger',undefined,'someone-else')).data.wagers,[]);
  assert.equal((await call('POST','/api/wager-ledger',{owner:'owner',wagers:[]})).status,200);
});

test('actual receiving60 route maps fixture estimates to 200 and abstention to 422 while keeping HOLD',async()=>{
  const decision=new Date(Date.now()-1000).toISOString();
  const fixture={request:{playerId:'p1',gameId:'future',kickoffAt:new Date(Date.now()+86400000).toISOString(),decisionAt:decision,
    league:'NFL',position:'WR',seasonType:'REG',period:'FULL_GAME',stat:'receiving_yards',threshold:60,comparison:'>='},
    history:[1,8,15].map((day,i)=>({playerId:'p1',gameId:`past${i}`,kickoffAt:`2026-10-${String(day).padStart(2,'0')}T20:00:00Z`,
      resolvedAt:`2026-10-${String(day).padStart(2,'0')}T23:00:00Z`,observedAt:`2026-10-${String(day).padStart(2,'0')}T23:01:00Z`,receivingYards:[-5,60,80][i]}))};
  const result=await call('POST','/api/receiving60/predict',fixture);
  assert.equal(result.status,200);
  assert.equal(result.data.estimateAvailable,true);
  assert.equal(result.data.status,'HOLD');
  assert.equal(result.data.executionEnabled,false);
  assert.equal(result.data.eligibilityVerified,false);
  assert.equal(result.data.expectedValue,null);
  const abstain=await call('POST','/api/receiving60/predict',{});
  assert.equal(abstain.status,422);
  assert.equal(abstain.data.estimateAvailable,false);
});

test('actual receiving60 route maps tampered fixture artifact to 503',async()=>{
  const tampered=await load(true);
  const result=await tampered({method:'POST',path:'/api/receiving60/predict',query:{},body:{}});
  assert.equal(result.status,503);
  assert.equal(result.data.reason,'ARTIFACT_INTEGRITY_FAILURE');
  assert.equal(result.data.estimateAvailable,false);
  assert.equal(result.data.executionEnabled,false);
});

test('odds gateway is default off and all observation routes require auth, including dynamic paths',async()=>{
  const status=await call('GET','/api/odds-backend/status',undefined,null);
  assert.equal(status.status,200);
  assert.equal(status.data.state,'NOT_CONFIGURED');
  for(const path of ['events','events/1','events/1/markets','latest','history','bookmakers']) {
    assert.equal((await call('GET','/api/odds-backend/'+path,undefined,null)).status,401);
    const result=await call('GET','/api/odds-backend/'+path,undefined,'owner', ['latest','history'].includes(path)?{event_id:'1'}:{});
    assert.equal(result.status,503);
    assert.equal(result.data.state,'NOT_CONFIGURED');
  }
  process.env.ODDS_BACKEND_URL='https://example.com';
  assert.equal((await call('GET','/api/odds-backend/status')).data.state,'NOT_CONFIGURED');
  delete process.env.ODDS_BACKEND_URL;
  process.env.ODDS_BACKEND_READ_TOKEN='fixture';
  assert.equal((await call('GET','/api/odds-backend/status')).data.state,'NOT_CONFIGURED');
  delete process.env.ODDS_BACKEND_READ_TOKEN;
});
