import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Bundle the real transitive modules with a secret store that fails on access.
// A universal transport fixture prevents every external request, including free sources.
test('public scans cannot consult configured credentials or call keyed vendors',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'edgeboard-provider-cost-'));
 const original=globalThis.fetch;const requested=[];
 try {
  const root=fileURLToPath(new URL('../../apps/edgeboard/',import.meta.url));
  const stub=join(directory,'sdk.ts');
  await writeFile(stub,`export const secrets={listSecretNames:async()=>{throw Error('SECRET_STORE_ACCESSED')},readSecret:async()=>{throw Error('SECRET_STORE_ACCESSED')}};export const db={list:async()=>({items:[]}),get:async()=>null};`);
  const output=join(directory,'providers.mjs');
  await build({stdin:{contents:`export {loadCaesarsFeed} from './backend/caesarsFeed';export {scanEdges} from './backend/engine';export {getNflResearchContext} from './backend/context';export {fetchAlternativeNflOdds} from './backend/altOdds';export {scanNflKymGameLines} from './backend/gameLines';export {fetchNflGameContext} from './backend/nflContext';`,resolveDir:root},outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'test-sdk',setup(builder){builder.onResolve({filter:/runtime\/sdk\.ts$/},()=>({path:stub}));}}],logLevel:'silent'});
  globalThis.fetch=async(input)=>{requested.push(String(input));return new Response(JSON.stringify({events:[],data:[],markets:[],items:[],sports:[],games:[],leagues:[]}),{status:200,headers:{'content-type':'application/json'}})};
  const module=await import(pathToFileURL(output));
  const caesars=await module.loadCaesarsFeed();
  assert.equal(caesars.status,'OPT_IN_REQUIRED');assert.equal(caesars.quotes.length,0);assert.equal(requested.length,0);
  await module.getNflResearchContext({events:[]});
  assert.equal(requested.length,0);
  await module.fetchNflGameContext([]);
  assert.equal(requested.length,0);
  await module.fetchAlternativeNflOdds();
  await module.scanNflKymGameLines({mode:'live'});
  await module.scanEdges({sport:'baseball_mlb',mode:'live',scanType:'props'});
  assert.ok(requested.every(url=>!/(?:parlayapi|the-odds-api|sharpapi|clearsports)/i.test(url)),JSON.stringify(requested));
  assert.equal((await module.loadCaesarsFeed()).status,'OPT_IN_REQUIRED');
 }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
