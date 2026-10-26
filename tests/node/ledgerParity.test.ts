import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function bundled(path,options={}){
 const result=await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,...options});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const input=await bundled('../../apps/edgeboard/shared/ledgerInput.ts');
const owner=await bundled('../../apps/edgeboard/shared/ledgerOwner.ts');
const client=await bundled('../../apps/edgeboard/shared/ledgerClientState.ts');
const wager=(id='fixture')=>({id,mode:'paper',status:'open',betType:'single',stake:10,decimalOdds:2,payout:0,fees:0,event:'Synthetic fixture',sportsbook:'QA',selection:'Home',currency:'USD',placedAt:'2026-10-25T20:00:00Z',settlementConfirmed:false,history:[{at:'2026-10-25T20:00:00Z',action:'created',detail:'synthetic'}]});
function storage(){const map=new Map();return{get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)}}
test('ledger input rejects malformed confirmations, dates, financial types and audit history',()=>{
 for(const patch of [{settlementConfirmed:'yes'},{placedAt:'2026-02-30T00:00:00Z'},{stake:true},{payout:NaN},{settlementConfirmed:true},{history:[{at:'unknown',action:'created',detail:''}]}])assert.throws(()=>input.validateWagers([{...wager(),...patch}]));
 assert.equal(input.validateWagers([wager()]).length,1);
 assert.throws(()=>input.validateWagers([wager(),wager()]));
});
test('captured owner checks reject account changes while retaining legacy compatibility',()=>{
 assert.equal(owner.ledgerRequestOwnerMatches('owner',{owner:'other'}),false);
 assert.equal(owner.ledgerRequestOwnerMatches('owner',{owner:'owner'}),true);
 assert.equal(owner.ledgerRequestOwnerMatches('owner',{wagers:[]}),true);
});
test('pending protocol state is immutable owner scoped and never silently overwritten',()=>{
 const store=storage(),rows=[wager()];
 const write=client.createPendingLedgerWrite('owner','request-1',0,rows,{event:'Draft'});
 rows[0].event='Changed after capture';
 assert.equal(write.wagers[0].event,'Synthetic fixture');
 client.persistPendingLedgerWrite(write,store);
 assert.equal(client.pendingLedgerWrites('other',store).length,0);
 assert.equal(client.pendingLedgerWrites('owner',store).length,1);
 assert.throws(()=>client.persistPendingLedgerWrite({...write,expectedRevision:2},store));
 assert.equal(client.ledgerSaveResponse({status:'unknown',requestId:'request-1'},write),'unknown');
 assert.throws(()=>client.ledgerSaveResponse({status:'saved',count:1},write));
 client.forgetPendingLedgerWrite(write,store);
 assert.equal(client.pendingLedgerWrites('owner',store).length,0);
});
test('SQLite ledger returns owner-scoped revisions and rejects malformed writes without changing saved state',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'edgeboard-ledger-parity-'));
 process.env.EDGEBOARD_DB=join(dir,'research.sqlite3');
 try{
  const ledger=await bundled('../../apps/edgeboard/backend/wagerLedger.ts');
  const saved=await ledger.saveWagerLedger('owner',{action:'save',owner:'owner',requestId:'parity-1',expectedRevision:0,wagers:[wager()]});
  assert.equal(saved.status,'saved');
  const result=await ledger.getWagerLedger('owner');
  assert.equal(result.wagers[0].event,'Synthetic fixture');
  assert.equal(result.protocol,'revision-receipt-v1');
  assert.equal(result.revision,1);
  assert.deepEqual((await ledger.getWagerLedger('other')).wagers,[]);
  await assert.rejects(ledger.saveWagerLedger('owner',{action:'save',owner:'owner',requestId:'bad-input',expectedRevision:1,wagers:[{...wager(),settlementConfirmed:'yes'}]}));
  assert.equal((await ledger.getWagerLedger('owner')).revision,1);
  assert.equal((await ledger.getWagerLedger('owner')).wagers.length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
