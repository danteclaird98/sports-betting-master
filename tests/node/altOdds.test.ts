import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fetchAlternativeNflOdds} from '../../apps/edgeboard/backend/altOdds.ts';
import {OddsApiQuota,utcMonth} from '../../apps/edgeboard/backend/oddsApiQuota.ts';
import {secrets} from '../../runtime/sdk.ts';
const dir=mkdtempSync(join(tmpdir(),'alt-odds-'));
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const envNames=['ODDS_API_ENABLED','ODDS_API_BUDGET_MONTH','ODDS_API_MONTH_START_USED','ODDS_API_BUDGET_ACCOUNT','EDGEBOARD_DB','THE_ODDS_API_KEY','SHARPAPI_KEY'];
function setup(t:any, used=0) {
 const original=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;const list=secrets.listSecretNames,read=secrets.readSecret;
 Object.assign(process.env,{ODDS_API_ENABLED:'true',ODDS_API_BUDGET_MONTH:utcMonth(),ODDS_API_MONTH_START_USED:String(used),ODDS_API_BUDGET_ACCOUNT:'same-provider-account',EDGEBOARD_DB:join(dir,Math.random()+'.sqlite'),THE_ODDS_API_KEY:'synthetic-never-real'});
 delete process.env.SHARPAPI_KEY;
 t.after(()=>{globalThis.fetch=originalFetch;secrets.listSecretNames=list;secrets.readSecret=read;for(const k of envNames){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}});
 const calls:URL[]=[];
 globalThis.fetch=async(input:any)=>{const url=new URL(String(input));calls.push(url);
  if(url.hostname==='api.the-odds-api.com')return new Response(JSON.stringify([{id:'fixture',commence_time:'2099-01-01T00:00:00Z',bookmakers:[{key:'fixture-book',markets:[]}]}]),{headers:{'x-requests-last':'1'}});
  if(url.hostname==='cdn.espn.com')return Response.json({events:[]});
  if(url.hostname==='external-api.kalshi.com')return Response.json({milestones:[]});
  throw Error('unexpected fake URL');};
 return calls;
}
test('public default and separately disabled provider use zero keyed calls',async t=>{
 const calls=setup(t);await fetchAlternativeNflOdds();assert.equal(calls.filter(u=>u.hostname==='api.the-odds-api.com').length,0);
 process.env.ODDS_API_ENABLED='false';await fetchAlternativeNflOdds(undefined,undefined,true);
 assert.equal(calls.filter(u=>u.hostname==='api.the-odds-api.com').length,0);
});
test('explicit enabled call is one region h2h only and reservation persists',async t=>{
 const calls=setup(t);const result=await fetchAlternativeNflOdds(undefined,undefined,true);
 const url=calls.find(u=>u.hostname==='api.the-odds-api.com')!;
 assert.equal(url.searchParams.get('regions'),'us');assert.equal(url.searchParams.get('markets'),'h2h');assert.ok(!url.pathname.includes('historical'));
 assert.equal(result.events[0].id,'fixture');
 const q=new OddsApiQuota(process.env.EDGEBOARD_DB!,'same-provider-account',utcMonth(),0);assert.equal(q.spent(),1);q.close();
});
test('exhausted or unconfigured ledger makes no paid request',async t=>{
 const calls=setup(t,500);await fetchAlternativeNflOdds(undefined,undefined,true);
 delete process.env.EDGEBOARD_DB;await fetchAlternativeNflOdds(undefined,undefined,true);
 assert.equal(calls.filter(u=>u.hostname==='api.the-odds-api.com').length,0);
});
test('transport and body failures retain reservation without retry and do not abort public providers',async t=>{
 const calls=setup(t);const fake=globalThis.fetch;
 for(const bodyFailure of [false,true]) {
  globalThis.fetch=async(input:any,options:any)=>{
   if(String(input).startsWith('https://api.the-odds-api.com')) {calls.push(new URL(String(input)));if(bodyFailure)return {ok:true,headers:new Headers(),text:async()=>{throw Error('secret payload');}} as any;throw Error('secret transport');}
   return fake(input,options);
  };
  const result=await fetchAlternativeNflOdds(undefined,undefined,true);
  assert.equal(result.providerHealth.find(h=>h.id==='theoddsapi')?.status,'error');
  assert.ok(!JSON.stringify(result).includes('secret'));assert.equal(result.providerHealth.find(h=>h.id==='kalshi')?.status,'partial');
 }
 assert.equal(calls.filter(u=>u.hostname==='api.the-odds-api.com').length,2);
 const q=new OddsApiQuota(process.env.EDGEBOARD_DB!,'same-provider-account',utcMonth(),0);assert.equal(q.spent(),2);q.close();
});
test('secret reading or discovery failures are contained',async t=>{
 setup(t);secrets.readSecret=async()=>{throw Error('secret content');};
 const result=await fetchAlternativeNflOdds(undefined,undefined,true);assert.equal(result.providerHealth.find(h=>h.id==='theoddsapi')?.status,'error');
 secrets.listSecretNames=async()=>{throw Error('secret content');};
 const fallback=await fetchAlternativeNflOdds(undefined,undefined,true);assert.ok(!JSON.stringify(fallback).includes('secret content'));
});
test('healthy context survives a paid provider transport rejection',async t=>{
 setup(t);
 globalThis.fetch=async(input:any)=>{
  const url=new URL(String(input));
  if(url.hostname==='api.the-odds-api.com')throw Error('private failure');
  if(url.hostname==='cdn.espn.com')return Response.json({events:[]});
  if(url.pathname.endsWith('/milestones'))return Response.json({milestones:[{related_event_tickers:['fixture']} ]});
  if(url.pathname.endsWith('/events/fixture'))return Response.json({event:{title:'fixture',markets:[{status:'open',title:'fixture',yes_bid_dollars:'0.4',yes_ask_dollars:'0.6'}]}});
  throw Error('Unexpected URL');
 };
 const result=await fetchAlternativeNflOdds(undefined,undefined,true);
 assert.equal(result.predictionContext.length,1);assert.equal(result.predictionContext[0].probability,.5);
 assert.equal(result.providerHealth.find(h=>h.id==='theoddsapi')?.status,'error');
});
