import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {OddsApiQuota,utcMonth,logOddsApiProjection} from '../../apps/edgeboard/backend/oddsApiQuota.ts';
const dir=mkdtempSync(join(tmpdir(),'odds-quota-'));
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const path=()=>join(dir,Math.random()+'.sqlite');
test('durable provider-wide reservations survive close, failure and configuration lowering',()=>{
  const file=path(), month=utcMonth();
  let q=new OddsApiQuota(file,'provider-account',month,499);
  q.reserve();q.close();
  q=new OddsApiQuota(file,'provider-account',month,0);
  assert.equal(q.spent(),500);assert.throws(()=>q.reserve());q.close();
});
test('separate processes race for final shared credit: exactly one admission',async()=>{
  const file=path(),month=utcMonth();new OddsApiQuota(file,'shared',month,499).close();
  const module=new URL('../../apps/edgeboard/backend/oddsApiQuota.ts',import.meta.url).href;
  const attempt=()=>new Promise<number|null>((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',`import {OddsApiQuota} from ${JSON.stringify(module)}; const q=new OddsApiQuota(${JSON.stringify(file)},'shared',${JSON.stringify(month)},0);try{q.reserve();q.close();}catch{q.close();process.exitCode=2;}`],{stdio:'ignore'});
    child.on('error',reject);child.on('exit',resolve);
  });
  assert.deepEqual((await Promise.all([attempt(),attempt()])).sort(),[0,2]);
});
test('headers never release reservations and account for external usage and pending calls',()=>{
  const q=new OddsApiQuota(path(),'shared',utcMonth(),0);
  const first=q.reserve(), second=q.reserve();
  q.reconcile(first,new Headers({'x-requests-used':'498','x-requests-remaining':'2','x-requests-last':'1'}));
  assert.equal(q.spent(),499); // one response + one still unknown
  q.reconcile(first,new Headers({'x-requests-used':'500'}));assert.equal(q.spent(),499); // receipt replay ignored
  q.reconcile(second,new Headers({'x-requests-used':'3','x-requests-remaining':'497'}));assert.equal(q.spent(),499);
  q.reserve();assert.throws(()=>q.reserve());q.close();
});
test('unexpected charged cost and malformed headers close budget conservatively',()=>{
  const q=new OddsApiQuota(path(),'shared',utcMonth(),498),r=q.reserve();
  q.reconcile(r,new Headers({'x-requests-last':'3'}));assert.equal(q.spent(),500);q.close();
  const other=new OddsApiQuota(path(),'shared',utcMonth(),0),receipt=other.reserve();
  other.reconcile(receipt,new Headers({'x-requests-used':'unknown'}));assert.equal(other.spent(),500);other.close();
});
test('UTC rollover requires configured baseline and durable file is mandatory',()=>{
  const q=new OddsApiQuota(path(),'shared','2030-01',0);
  assert.throws(()=>q.reserve(new Date('2030-02-01T00:00:00Z')));q.close();
  assert.throws(()=>new OddsApiQuota(':memory:','shared',utcMonth(),0));
  assert.throws(()=>new OddsApiQuota(path(),'',utcMonth(),0));
  const messages:string[]=[];logOddsApiProjection(m=>messages.push(m));
  assert.equal(JSON.parse(messages[0]).projectedScheduledMonthlyCredits,0);
});
