import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import artifact from '../../apps/edgeboard/backend/correctedReceivingArtifact.json' with { type: 'json' };
import { canonicalJson } from '../../apps/edgeboard/backend/correctedReceiving.ts';
import { forwardHash } from '../../apps/edgeboard/backend/receivingForwardCore.ts';
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
  const features = [50,45,0.3,0.2,8];
  const logit = artifact.intercept + features.reduce((sum,value,i)=>sum+artifact.coefficients[i]*(value-artifact.mean[i])/artifact.scale[i],0);
  const rawProbability = 1/(1+Math.exp(-logit));
  const calibratedProbability = 1/(1+Math.exp(-(artifact.calibration.intercept+artifact.calibration.slope*logit)));
  const forecast = async ({playerId,gameId}: {playerId:string;gameId:string}) => {
    calls++;
    return {calculationStatus:'CALCULATED',playerId,gameId,kickoffAt:new Date(now+3_600_000).toISOString(),decisionAt:new Date(now).toISOString(),
      probability:artifact.calibration.selected ? calibratedProbability : rawProbability,rawProbability,calibratedProbability,features,
      sourceReceipt:{retrievedAt:new Date(now).toISOString()},scope:'CONDITIONAL_RECORDED_PLAYER_RECEIVING_60_PLUS',
      artifactSha256:protocol.artifactSha256,modelVersion:protocol.modelVersion,
      bettingDecision:'HOLD',liveApproved:false,executionEnabled:false,verifiedPositiveEv:false};
  };
  try {
    const store = storage.forOwner('alice');
    const alice = createReceivingForwardService({owner:'alice',store,forecast:forecast as never,now:()=>now});
    const body = {playerId:'synthetic-player',gameId:'synthetic-game'};
    assert.equal((await alice.save(body)).saveStatus,'SAVED');
    assert.equal((await alice.save(body)).saveStatus,'EXISTING');
    assert.equal(calls,1);
    const first = (await alice.history()).items[0];
    const {receiptSha256: _oldHash,...payload} = structuredClone(first);
    payload.forecast.probability = 0.99;
    const forged = {...payload,receiptSha256:await forwardHash(canonicalJson(payload))};
    const tampered = createReceivingForwardService({owner:'alice',store:{get:async()=>forged,add:async()=>false,list:async()=>({items:[forged],nextToken:null})},forecast:forecast as never,now:()=>now});
    await assert.rejects(tampered.history(),/FORECAST_RECEIPT_INTEGRITY_FAILURE/);
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
