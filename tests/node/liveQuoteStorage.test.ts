import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LiveQuote } from '../../apps/edgeboard/backend/liveTypes.ts';

const dir=mkdtempSync(join(tmpdir(),'edgeboard-snapshot-integrity-'));
const path=join(dir,'archive.sqlite');
process.env.EDGEBOARD_DB=path;
const {db}=await import('../../runtime/sdk.ts');
const {saveLiveSnapshot,readLiveSnapshots,readLiveSnapshotCapture}=await import('../../apps/edgeboard/backend/liveQuoteStorage.ts');
const {saveQuoteBatch,listQuoteBatches}=await import('../../apps/edgeboard/backend/quoteArchive.ts');
const eventId='123456789';
const tableFor=(owner:string)=>'live_quotes_'+Array.from(owner).map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
const archiveFor=(owner:string)=>'live_quote_snapshots_'+Buffer.from(owner).toString('hex');
function quote(decimalOdds=2,extra:Partial<LiveQuote>={}):LiveQuote {
  return {id:'book:home',provider:'fixture',book:'Fixture Book',eventId,providerEventId:'provider-event',event:'Away at Home',
    player:null,playerId:null,market:'moneyline',side:'home',line:null,period:'FULL',decimalOdds,americanOdds:100,
    entryMultiplier:null,retrievedAt:'2026-10-25T20:00:00.000Z',oddsAt:null,ageSeconds:null,timestampBasis:'retrieved',
    status:'ACTIVE',settlementRules:null,accountAvailabilityVerified:false,modelProbability:null,...extra};
}

test('two captures preserve prior bodies and latest pointer selects the second',async()=>{
  const owner='capture-owner',first=await saveLiveSnapshot(owner,eventId,'periods',[quote(2)]);
  const second=await saveLiveSnapshot(owner,eventId,'periods',[quote(3)]);
  assert.notEqual(first.captureId,second.captureId);
  assert.equal(new Date(first.version).toISOString(),first.version);
  assert.deepEqual((await readLiveSnapshotCapture(owner,eventId,'periods',first.captureId)).quotes,[quote(2)]);
  assert.deepEqual((await readLiveSnapshotCapture(owner,eventId,'periods',second.captureId)).quotes,[quote(3)]);
  assert.deepEqual(await readLiveSnapshots(owner,eventId),[quote(3)]);
  assert.equal((await db.list(archiveFor(owner))).items.length,4);
  const [pointer]=await db.get<any>(tableFor(owner),[eventId+'_periods_index']);
  assert.equal(pointer.captureId,second.captureId);
  assert.equal(pointer.chunks,undefined);
});

test('re-poll with identical observations appends a distinct capture; empty capture retains history',async()=>{
  const owner='replay-owner',first=await saveLiveSnapshot(owner,eventId,'props',[quote()]);
  const replay=await saveLiveSnapshot(owner,eventId,'props',[quote()]);
  assert.notEqual(first.captureId,replay.captureId);
  await saveLiveSnapshot(owner,eventId,'props',[]);
  assert.deepEqual(await readLiveSnapshots(owner,eventId),[]);
  assert.deepEqual((await readLiveSnapshotCapture(owner,eventId,'props',first.captureId)).quotes,[quote()]);
  assert.equal((await db.list(archiveFor(owner))).items.length,5);
});

test('immutable records reject SDK mutations, duplicate inserts, SQL replacements and reclassification',async()=>{
  const owner='guard-owner',receipt=await saveLiveSnapshot(owner,eventId,'props',[quote()]);
  const table=archiveFor(owner),id=eventId+'_props_'+receipt.captureId+'_part_0';
  const [before]=await db.get<any>(table,[id]);
  await assert.rejects(()=>db.update(table,[{id,record:{corrupted:true}}]),/append-only/);
  await assert.rejects(()=>db.delete(table,[id]),/append-only/);
  await assert.rejects(()=>db.transact([db.tx.insert(table,[{id,record:before}])]),/append-only/);
  const raw=new DatabaseSync(path);
  try {
    assert.throws(()=>raw.prepare('UPDATE records SET body=? WHERE collection=? AND id=?').run('{}',table,id),/append-only/);
    assert.throws(()=>raw.prepare('DELETE FROM records WHERE collection=? AND id=?').run(table,id),/append-only/);
    assert.throws(()=>raw.prepare('INSERT OR REPLACE INTO records(collection,id,body) VALUES(?,?,?)').run(table,id,'{}'),/append-only/);
    const row=raw.prepare('SELECT seq FROM records WHERE collection=? AND id=?').get(table,id) as {seq:number};
    assert.throws(()=>raw.prepare('INSERT OR REPLACE INTO records(seq,collection,id,body) VALUES(?,?,?,?)').run(row.seq,'mutable','replacement','{}'),/append-only/);
    raw.prepare('INSERT INTO records(collection,id,body) VALUES(?,?,?)').run('mutable','seq-replacement','{}');
    assert.throws(()=>raw.prepare('UPDATE OR REPLACE records SET seq=? WHERE collection=? AND id=?').run(row.seq,'mutable','seq-replacement'),/append-only/);
    assert.throws(()=>raw.prepare('UPDATE records SET collection=? WHERE collection=? AND id=?').run('mutable',table,id),/append-only/);
  } finally {raw.close();}
  assert.deepEqual((await db.get<any>(table,[id]))[0],before);
  // Literal underscore matching must not prohibit unrelated mutable collections.
  await db.update('liveXquoteXsnapshotsXowner',[{id:'mutable',record:{value:1}}]);
  await db.update('liveXquoteXsnapshotsXowner',[{id:'mutable',record:{value:2}}]);
  assert.deepEqual(await db.delete('liveXquoteXsnapshotsXowner',['mutable']),[true]);
});

test('failed transaction rolls back inserted evidence and leaves latest pointer unchanged',async()=>{
  const owner='rollback-owner',prior=await saveLiveSnapshot(owner,eventId,'periods',[quote(2)]);
  await assert.rejects(()=>db.transact([
    db.tx.insert(archiveFor(owner),[{id:'must-rollback',record:{value:1}}]),
    db.tx.update(tableFor(owner),[{id:eventId+'_periods_index',record:{broken:true}}]),
    db.tx.insert(archiveFor(owner),[{id:'must-rollback',record:{value:2}}])
  ]),/append-only/);
  assert.equal((await db.get(archiveFor(owner),['must-rollback']))[0],null);
  assert.deepEqual(await readLiveSnapshots(owner,eventId),[quote(2)]);
  assert.equal((await readLiveSnapshotCapture(owner,eventId,'periods',prior.captureId)).quotes.length,1);
});

test('existing odds snapshot batch archive is insert-only through SDK and raw SQL',async()=>{
  const owner='batch-owner',payload={sport:'NFL',quotes:[{
    eventId,market:'moneyline',selection:'home',line:null,americanOdds:100,oddsAt:null,
    sportsbook:'Caesars',period:'FULL',startTime:null,event:'Away at Home',player:null
  }]};
  const first=await saveQuoteBatch(owner,payload),second=await saveQuoteBatch(owner,payload);
  assert.notEqual(first.archiveId,second.archiveId);
  assert.equal((await listQuoteBatches(owner)).batches.length,2);
  const table='odds_snapshots:'+owner,[before]=await db.get(table,[first.archiveId]);
  await assert.rejects(()=>db.update(table,[{id:first.archiveId,record:{corrupted:true}}]),/append-only/);
  await assert.rejects(()=>db.delete(table,[first.archiveId]),/append-only/);
  const raw=new DatabaseSync(path);
  try {
    assert.throws(()=>raw.prepare('UPDATE records SET body=? WHERE collection=? AND id=?').run('{}',table,first.archiveId),/append-only/);
    assert.throws(()=>raw.prepare('DELETE FROM records WHERE collection=? AND id=?').run(table,first.archiveId),/append-only/);
    assert.throws(()=>raw.prepare('INSERT OR REPLACE INTO records(collection,id,body) VALUES(?,?,?)').run(table,first.archiveId,'{}'),/append-only/);
  } finally {raw.close();}
  assert.deepEqual((await db.get(table,[first.archiveId]))[0],before);
});

test('legacy snapshots remain readable and their chunks survive a new capture',async()=>{
  const owner='legacy-owner',table=tableFor(owner),version='2026-10-24T00:00:00.000Z',chunk=eventId+'_periods_part_0';
  await db.transact([db.tx.update(table,[
    {id:chunk,record:{owner,eventId,version,quotes:[quote(1.9)]}},
    {id:eventId+'_periods_index',record:{owner,eventId,version,chunks:[chunk]}}
  ])]);
  assert.deepEqual(await readLiveSnapshots(owner,eventId),[quote(1.9)]);
  const [before]=await db.get(table,[chunk]);
  await saveLiveSnapshot(owner,eventId,'periods',[quote(2.1)]);
  assert.deepEqual((await db.get(table,[chunk]))[0],before);
  assert.deepEqual(await readLiveSnapshots(owner,eventId),[quote(2.1)]);
  await assert.rejects(()=>db.update(table,[{id:chunk,record:{corrupted:true}}]),/append-only/);
  await assert.rejects(()=>db.delete(table,[chunk]),/append-only/);
  const raw=new DatabaseSync(path);
  try {
    assert.throws(()=>raw.prepare('UPDATE records SET body=? WHERE collection=? AND id=?').run('{}',table,chunk),/append-only/);
    assert.throws(()=>raw.prepare('DELETE FROM records WHERE collection=? AND id=?').run(table,chunk),/append-only/);
    assert.throws(()=>raw.prepare('INSERT OR REPLACE INTO records(collection,id,body) VALUES(?,?,?)').run(table,chunk,'{}'),/append-only/);
  } finally {raw.close();}
});

test('archive scope, malformed legacy chunks and oversized captures fail closed',async()=>{
  const owner='scope-owner',capture=await saveLiveSnapshot(owner,eventId,'props',[quote()]);
  await assert.rejects(()=>readLiveSnapshotCapture('another-owner',eventId,'props',capture.captureId),/not found/);
  await assert.rejects(()=>readLiveSnapshotCapture(owner,'987654321','props',capture.captureId),/not found/);
  await assert.rejects(()=>readLiveSnapshotCapture(owner,eventId,'periods',capture.captureId),/not found/);
  await assert.rejects(()=>readLiveSnapshotCapture(owner,eventId,'props','../capture'),/Invalid/);
  await assert.rejects(()=>saveLiveSnapshot(owner,eventId,'props',[quote(2,{eventId:'987654321'})]),/another event/);
  await assert.rejects(()=>saveLiveSnapshot(owner,eventId,'props',[quote(2,{event:'x'.repeat(180001)})]),/Individual quote/);
  const large=Array.from({length:13},(_,i)=>quote(2,{id:String(i),event:'x'.repeat(100000)}));
  await assert.rejects(()=>saveLiveSnapshot(owner,eventId,'props',large),/bounded archive/);
  assert.deepEqual(await readLiveSnapshots(owner,eventId),[quote()]);
  await db.update(tableFor('bad-legacy'),[{id:eventId+'_periods_index',record:{owner:'bad-legacy',eventId,version:'old',chunks:['wrong-event-part']}}]);
  await assert.rejects(()=>readLiveSnapshots('bad-legacy',eventId),/chunk identity mismatch/);
});

test('unknown committed write outcome is not retried and can be reconciled from latest',async()=>{
  const owner='unknown-owner',original=db.transact;
  let calls=0;
  db.transact=async operations=>{calls++;await original(operations);throw Error('Unknown committed outcome');};
  try {await assert.rejects(()=>saveLiveSnapshot(owner,eventId,'props',[quote(2.5)]),/Unknown committed outcome/);}
  finally {db.transact=original;}
  assert.equal(calls,1);
  assert.deepEqual(await readLiveSnapshots(owner,eventId),[quote(2.5)]);
  assert.equal((await db.list(archiveFor(owner))).items.length,2);
});

test.after(()=>rmSync(dir,{recursive:true,force:true}));
