import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const built=await build({
  entryPoints:[new URL('../../apps/edgeboard/backend/wagerLedger.ts',import.meta.url).pathname],
  bundle:true,platform:'node',format:'esm',write:false
});
const code=built.outputFiles[0].text;
const ledger=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const wager=(id='fixture')=>({
  id,mode:'paper',status:'open',betType:'single',stake:10,decimalOdds:2,payout:0,
  fees:0,event:'Synthetic fixture',sportsbook:'QA',selection:'Home',currency:'USD',
  placedAt:'2026-10-25T20:00:00Z',settlementConfirmed:false,history:[]
});
const request=(requestId,expectedRevision,wagers,owner='alice',action='save')=>({
  action,owner,requestId,expectedRevision,wagers
});
async function isolated(run){
  const dir=mkdtempSync(join(tmpdir(),'master-ledger-revision-'));
  const previous=process.env.EDGEBOARD_DB;
  process.env.EDGEBOARD_DB=join(dir,'edgeboard.sqlite3');
  try{await run(dir,process.env.EDGEBOARD_DB);}
  finally{
    if(previous===undefined)delete process.env.EDGEBOARD_DB;
    else process.env.EDGEBOARD_DB=previous;
    rmSync(dir,{recursive:true,force:true});
  }
}

test('stale writes conflict and acknowledged retries never replace later ledger state',()=>isolated(async()=>{
  const first=request('first',0,[wager('a')]);
  const saved=await ledger.saveWagerLedger('alice',first);
  assert.equal(saved.status,'saved');
  assert.equal(saved.receipt.revision,1);
  assert.deepEqual(await ledger.saveWagerLedger('alice',request('stale',0,[wager('b')])),{
    status:'conflict',currentRevision:1
  });
  await ledger.saveWagerLedger('alice',request('second',1,[wager('a'),wager('c')]));
  assert.deepEqual(await ledger.saveWagerLedger('alice',first),saved);
  const current=await ledger.getWagerLedger('alice');
  assert.equal(current.revision,2);
  assert.deepEqual(current.wagers.map(row=>row.id),['a','c']);
  await assert.rejects(ledger.saveWagerLedger('alice',request('first',0,[wager('different')])),/different ledger update/);
}));

test('reconciliation returns saved receipts and never resubmits unknown requests',()=>isolated(async()=>{
  const write=request('stable-request',0,[wager('a')]);
  const saved=await ledger.saveWagerLedger('alice',write);
  assert.deepEqual(await ledger.saveWagerLedger('alice',request('stable-request',0,[wager('a')],'alice','reconcile')),saved);
  assert.deepEqual(await ledger.saveWagerLedger('alice',request('not-submitted',0,[wager('b')],'alice','reconcile')),{
    status:'unknown',requestId:'not-submitted'
  });
  assert.equal((await ledger.getWagerLedger('alice')).revision,1);
  assert.deepEqual((await ledger.getWagerLedger('bob')).wagers,[]);
}));

test('two processes saving the same revision cannot both overwrite the ledger',()=>isolated(async(_dir,dbPath)=>{
  const modulePath=join(_dir,'ledger.mjs');
  writeFileSync(modulePath,code);
  await ledger.getWagerLedger('alice');
  const moduleUrl=pathToFileURL(modulePath).href;
  function child(input){
    return new Promise((resolve,reject)=>{
      const script='const m=await import('+JSON.stringify(moduleUrl)+'); console.log(JSON.stringify(await m.saveWagerLedger("alice",JSON.parse(process.env.LEDGER_INPUT_JSON))));';
      const proc=spawn(process.execPath,['--input-type=module','-e',script],{
        env:{...process.env,EDGEBOARD_DB:dbPath,LEDGER_INPUT_JSON:JSON.stringify(input)},
        stdio:['ignore','pipe','pipe']
      });
      let out='',err='';
      proc.stdout.on('data',chunk=>out+=chunk);
      proc.stderr.on('data',chunk=>err+=chunk);
      proc.once('error',reject);
      proc.once('exit',status=>status===0?resolve(JSON.parse(out)):reject(Error(err)));
    });
  }
  const outcomes=await Promise.all([
    child(request('process-a',0,[wager('a')])),
    child(request('process-b',0,[wager('b')]))
  ]);
  assert.deepEqual(outcomes.map(row=>row.status).sort(),['conflict','saved']);
  const current=await ledger.getWagerLedger('alice');
  assert.equal(current.revision,1);
  assert.equal(current.wagers.length,1);
}));

test('legacy ledger rows remain in place and upgrade only on a revision-bound save',()=>isolated(async(_dir,dbPath)=>{
  await ledger.getWagerLedger('alice');
  const sql=new DatabaseSync(dbPath);
  const legacy={wagers:[wager('legacy')],updatedAt:'2026-10-25T20:00:00Z'};
  try{sql.prepare('INSERT INTO records(collection,id,body) VALUES(?,?,?)')
    .run('wager_ledger:alice','legacy-record-id',JSON.stringify(legacy));}
  finally{sql.close();}
  const before=await ledger.getWagerLedger('alice');
  assert.equal(before.revision,0);
  assert.equal(before.wagers[0].id,'legacy');
  await ledger.saveWagerLedger('alice',request('upgrade',0,[wager('legacy'),wager('new')]));
  const verify=new DatabaseSync(dbPath);
  try{
    const rows=verify.prepare('SELECT id,body FROM records WHERE collection=?').all('wager_ledger:alice');
    assert.equal(rows.length,1);
    assert.equal(rows[0].id,'legacy-record-id');
    assert.equal(JSON.parse(rows[0].body).revision,1);
  }finally{verify.close();}
}));

test('receipt write failure rolls back the ledger update and revision',()=>isolated(async(_dir,dbPath)=>{
  await ledger.getWagerLedger('alice');
  const sql=new DatabaseSync(dbPath);
  try{sql.exec("CREATE TRIGGER force_receipt_failure BEFORE INSERT ON wager_write_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");}
  finally{sql.close();}
  await assert.rejects(ledger.saveWagerLedger('alice',request('rollback',0,[wager('a')])));
  assert.equal((await ledger.getWagerLedger('alice')).revision,0);
  assert.deepEqual((await ledger.getWagerLedger('alice')).wagers,[]);
  const verify=new DatabaseSync(dbPath);
  try{
    assert.equal(verify.prepare('SELECT count(*) AS n FROM records WHERE collection=?').get('wager_ledger:alice').n,0);
    assert.equal(verify.prepare('SELECT count(*) AS n FROM wager_write_receipts').get().n,0);
  }finally{verify.close();}
}));
