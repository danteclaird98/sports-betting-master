import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createForwardSqliteStorage } from '../../apps/edgeboard/backend/receivingForwardSqlite.ts';
import { createReceivingForwardService, receivingForwardProtocol, ForwardWriteUnconfirmed } from '../../apps/edgeboard/backend/receivingForwardCore.ts';

test('SQLite first-write receipts survive restart, paginate, isolate owners and reject mutation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'receiving-forward-'));
  const path = join(folder, 'research.sqlite3');
  let storage = createForwardSqliteStorage(path);
  try {
    const alice = storage.forOwner('alice');
    for (let i = 0; i < 12; i++) assert.equal(await alice.add({ id: `record-${i}`, owner: 'alice', marker: i } as never), true);
    assert.equal(await alice.add({ id: 'record-0', owner: 'alice', marker: 'replacement' } as never), false);
    assert.equal((await alice.get('record-0') as any).marker, 0);
    assert.equal(await storage.forOwner('bob').get('record-0'), null);
    await assert.rejects(storage.forOwner('bob').add({id:'record-0',owner:'alice'} as never), /OWNER_MISMATCH/);
    const first = await alice.list();
    assert.equal(first.items.length,10);
    assert.ok(first.nextToken);
    await assert.rejects(storage.forOwner('bob').list(first.nextToken!), /INVALID_HISTORY_TOKEN/);
    storage.close();
    storage = createForwardSqliteStorage(path);
    const second = await storage.forOwner('alice').list(first.nextToken!);
    assert.equal(second.items.length,2);
    assert.equal(second.nextToken,null);
    assert.equal((await storage.forOwner('alice').get('record-0') as any).marker,0);
    const raw = new DatabaseSync(path);
    try {
      assert.throws(() => raw.exec("UPDATE eo_receiving_forward_receipts SET body='{}'"), /append-only/);
      assert.throws(() => raw.exec('DELETE FROM eo_receiving_forward_receipts'), /append-only/);
    } finally { raw.close(); }
  } finally { storage.close(); await rm(folder,{recursive:true,force:true}); }
});

test('forward service keeps first forecast per owner and reconciles uncertain writes', async () => {
  const storage = createForwardSqliteStorage(':memory:');
  const {protocol} = await receivingForwardProtocol();
  const now = Date.parse(protocol.frozenAt) + 60_000;
  let calls = 0;
  const forecast = async ({playerId,gameId}: {playerId:string;gameId:string}) => {
    calls++;
    return {calculationStatus:'CALCULATED',playerId,gameId,kickoffAt:new Date(now+3_600_000).toISOString(),decisionAt:new Date(now).toISOString(),
      probability:0.4,rawProbability:0.41,calibratedProbability:0.4,artifactSha256:protocol.artifactSha256,modelVersion:protocol.modelVersion,
      bettingDecision:'HOLD',liveApproved:false,executionEnabled:false,verifiedPositiveEv:false};
  };
  try {
    const store = storage.forOwner('alice');
    const alice = createReceivingForwardService({owner:'alice',store,forecast:forecast as never,now:()=>now});
    const body = {playerId:'synthetic-player',gameId:'synthetic-game'};
    assert.equal((await alice.save(body)).saveStatus,'SAVED');
    assert.equal((await alice.save(body)).saveStatus,'EXISTING');
    assert.equal(calls,1);
    await assert.rejects(alice.save({...body,probability:0.99}),/INVALID_FORECAST_ARCHIVE_REQUEST/);
    const bob = createReceivingForwardService({owner:'bob',store:storage.forOwner('bob'),forecast:forecast as never,now:()=>now});
    assert.equal((await bob.history()).items.length,0);
    assert.equal((await bob.save(body)).saveStatus,'SAVED');
    const uncertainStore = storage.forOwner('uncertain');
    const uncertain = createReceivingForwardService({owner:'uncertain',store:{...uncertainStore,async add(record){await uncertainStore.add(record);throw new ForwardWriteUnconfirmed();}},forecast:forecast as never,now:()=>now});
    assert.equal((await uncertain.save(body)).saveStatus,'EXISTING');
    assert.equal((await uncertain.history()).items.length,1);
    const unconfirmed = createReceivingForwardService({owner:'missing',store:{get:async()=>null,add:async()=>{throw new ForwardWriteUnconfirmed();},list:async()=>({items:[],nextToken:null})},forecast:forecast as never,now:()=>now});
    await assert.rejects(unconfirmed.save(body),/SAVE_UNCONFIRMED_RELOAD_HISTORY/);
    const late = createReceivingForwardService({owner:'late',store:storage.forOwner('late'),forecast:forecast as never,now:()=>now+3_500_000});
    await assert.rejects(late.save(body),/FORECAST_RECEIPT_INTEGRITY_FAILURE/);
  } finally { storage.close(); }
});
