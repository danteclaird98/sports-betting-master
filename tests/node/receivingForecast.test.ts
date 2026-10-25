import { test } from 'node:test';
import installedSeed from '../../apps/edgeboard/backend/receivingHistorySeed.json' with { type: 'json' };
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import artifact from '../../apps/edgeboard/backend/correctedReceivingArtifact.json' with { type: 'json' };
import { canonicalJson } from '../../apps/edgeboard/backend/correctedReceiving.ts';
import { createReceivingForecastService, easternKickoff, RECEIVING_SCHEDULE_URL } from '../../apps/edgeboard/backend/receivingForecast.ts';

const clock = Date.parse('2026-10-25T21:00:00Z');
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const rows = [
  ['past1',2025,1,'2025-09-01',10], ['past2',2025,2,'2025-09-08',20], ['past3',2025,3,'2025-09-15',30],
  ['current1',2026,1,'2026-09-01',40], ['current2',2026,2,'2026-09-08',70], ['current3',2026,3,'2026-09-15',80],
] as const;
const schedule = [
  'game_id,season,game_type,week,gameday,gametime,home_team,away_team,home_score,away_score',
  ...rows.map(([id,season,week,day]) => `${id},${season},REG,${week},${day},16:00,LAR,SEA,10,7`),
  'next1,2026,REG,8,2026-10-26,16:00,LAR,SEA,,',
  'later1,2026,REG,9,2026-11-02,16:00,LAR,SEA,,',
].join('\n');
const current = [
  'player_id,player_display_name,position,season,week,season_type,game_id,team,receiving_yards',
  ...rows.filter(row => row[1] === 2026).map(([id,season,week,,yards]) => `qa-player,Synthetic QA Player,WR,${season},${week},REG,${id},LAR,${yards}`),
].join('\n');
const seed = {
  version:1, throughSeason:2025, sourceHashes:artifact.source_hashes,
  players:{'qa-player':[3,rows.filter(row => row[1] === 2025).map(([id,,,,yards]) => [id,yards,'LAR'])]},
};
function service(extra: Record<string, unknown> = {}) {
  return createReceivingForecastService({
    now:() => clock,
    readiness:async () => ({artifactVerified:true}),
    seed:seed as never, seedSha256:digest(seed),
    loadText:async url => url === RECEIVING_SCHEDULE_URL ? schedule : current,
    ...extra,
  });
}

test('future fixture is source-backed and frozen probability equals direct artifact math', async () => {
  const model = service();
  const options = await model.options();
  assert.equal(options.calculationStatus,'AVAILABLE');
  assert.equal(options.players[0].playerId,'qa-player');
  assert.equal(options.games.length,1);
  assert.equal(options.games[0].gameId,'next1');
  const result = await model.forecast({playerId:'qa-player',gameId:'next1'});
  assert.equal(result.calculationStatus,'CALCULATED');
  if (result.calculationStatus !== 'CALCULATED') return;
  assert.deepEqual(result.features,[190/3,250/6,2/3,2/6,6]);
  const logit = artifact.intercept + result.features.reduce((sum,x,i) =>
    sum + artifact.coefficients[i] * (x-artifact.mean[i])/artifact.scale[i],0);
  const raw = 1/(1+Math.exp(-logit));
  const calibrated = 1/(1+Math.exp(-(artifact.calibration.intercept+artifact.calibration.slope*logit)));
  assert.ok(Math.abs(result.rawProbability-raw) < 1e-12);
  assert.ok(Math.abs(result.probability-(artifact.calibration.selected ? calibrated : raw)) < 1e-12);
  assert.equal(result.sourceReceipt.publicationClockVerified,false);
  assert.equal(result.sourceReceipt.participationVerified,false);
  assert.equal(result.bettingDecision,'HOLD');
  assert.equal(result.liveApproved,false);
  assert.equal(result.verifiedPositiveEv,false);
  assert.equal(result.executionEnabled,false);
});
test('later fixture, unknown player and client probability inputs are rejected', async () => {
  const model = service();
  const later = await model.forecast({playerId:'qa-player',gameId:'later1'});
  assert.equal(later.reason,'TARGET_NOT_NEXT_TEAM_GAME');
  assert.equal(later.probability,null);
  assert.equal((await model.forecast({playerId:'unknown',gameId:'next1'})).reason,'CURRENT_SEASON_PLAYER_UNAVAILABLE');
  assert.equal((await model.forecast({playerId:'qa-player',gameId:'next1',probability:1})).reason,'INVALID_REQUEST_SCHEMA');
});
test('integrity failure prevents source loading and any forecast', async () => {
  let calls=0;
  const model = service({readiness:async()=>({artifactVerified:false}),loadText:async()=>{calls++;return '';}});
  assert.equal((await model.options()).reason,'ARTIFACT_INTEGRITY_FAILURE');
  assert.equal((await model.forecast({playerId:'qa-player',gameId:'next1'})).probability,null);
  assert.equal(calls,0);
});
test('source outage and seed tampering stay explicit unavailable states', async () => {
  const missing = service({loadText:async()=>{throw Error('PUBLIC_SOURCE_HTTP_503');}});
  const options = await missing.options();
  assert.equal(options.calculationStatus,'DATA_UNAVAILABLE');
  assert.equal(options.players.length,0);
  assert.equal(options.reason,'PUBLIC_SOURCE_HTTP_503');
  const tampered = service({seedSha256:'0'.repeat(64)});
  assert.equal((await tampered.options()).reason,'HISTORICAL_SEED_INTEGRITY_FAILURE');
});
test('kickoff parsing handles Eastern daylight time without guessing ambiguous clocks', () => {
  assert.equal(easternKickoff('2026-10-26','16:00'),Date.parse('2026-10-26T20:00:00Z'));
  assert.equal(easternKickoff('2026-12-01','16:00'),Date.parse('2026-12-01T21:00:00Z'));
  assert.equal(Number.isNaN(easternKickoff('2026-11-01','01:30')),true);
});

test('installed compact historical seed matches its pinned canonical digest and artifact lineage', () => {
  assert.equal(digest(installedSeed),'995a1f266c0bfba209b12f4d3bfb80641f42af99e8de5cc3aca82add66bcfe3c');
  assert.equal(installedSeed.throughSeason,2025);
  assert.deepEqual(installedSeed.sourceHashes,artifact.source_hashes);
});
