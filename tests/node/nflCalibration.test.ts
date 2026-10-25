import test from 'node:test';
import assert from 'node:assert/strict';
import { researchNflCalibration } from '../../apps/edgeboard/backend/nflCalibration.ts';

const headers = ['season','gameday','home_team','away_team','home_score','away_score','home_moneyline','away_moneyline','status'];
type Row = string[];
function fixture(): Row[] {
  const rows: Row[] = [];
  for (let season=2010; season<2017; season++) for (let i=0; i<100; i++) {
    rows.push([String(season),new Date(Date.UTC(season,0,i+1)).toISOString().slice(0,10),
      'HOME','AWAY',i%2 ? '0' : '21',i%2 ? '7' : '0',i%3 ? '-110' : '',i%3 ? '-110' : '', 'final']);
  }
  return rows;
}
async function evaluate(rows: Row[], columns=headers) {
  const original = globalThis.fetch;
  let requests=0;
  globalThis.fetch = async () => {
    requests++;
    return new Response([columns.join(','),...rows.map(r=>r.join(','))].join('\n'));
  };
  try { return await researchNflCalibration(); }
  finally { globalThis.fetch=original; assert.equal(requests,1); }
}

test('missing scores cannot create fictional outcomes or calibration metrics', async () => {
  for (const invalid of ['', ' ', '1.5', 'NaN', 'Infinity', '-1', '1e2', '9007199254740992']) {
    const rows=fixture();
    for (const row of rows) row[4]=invalid;
    await assert.rejects(evaluate(rows), /Insufficient chronological history/);
  }
  const missingAway=fixture().map(row=>row.slice(0,5));
  await assert.rejects(evaluate(missingAway), /Insufficient chronological history/);
});

test('valid zero scores remain eligible and comparison uses one matched cohort', async () => {
  const result=await evaluate(fixture());
  assert.equal(result.games,700);
  assert.equal(result.excludedGames,0);
  assert.equal(result.heldOut.testGames,200);
  assert.equal(result.heldOut.model?.count,200);
  assert.equal(result.heldOut.uncalibrated?.count,200);
  assert.equal(result.heldOut.matchedGames,132);
  assert.equal(result.heldOut.modelMatched?.count,result.heldOut.marketMatched?.count);
  assert.equal(result.heldOut.uncalibratedMatched?.count,result.heldOut.marketMatched?.count);
  assert.equal(result.heldOut.marketCoverage,result.heldOut.matchedGames);
  // Both forecasts score the same outcome population, even with selective missing prices.
  for (const metric of [result.heldOut.modelMatched,result.heldOut.uncalibratedMatched,result.heldOut.marketMatched]) {
    const positives=metric!.bins.reduce((n,bin)=>n+bin.count*(bin.observed??0),0);
    assert.equal(positives,66);
  }
  assert.equal(result.liveApproved,false);
  assert.equal(result.status,'RESEARCH_ONLY');
  assert.equal(result.recommendation,'PASS');
});

test('unfinished, invalid-date and tied rows cannot enter chronological history', async () => {
  for (const mutate of [
    (r: Row)=>{r[8]='scheduled';},
    (r: Row)=>{r[8]='in_progress';},
    (r: Row)=>{r[1]='2010-02-30';},
    (r: Row)=>{r[1]='2999-01-01';},
    (r: Row)=>{r[5]=r[4];},
    (r: Row)=>{r[0]='';},
  ]) {
    const rows=fixture(); rows.forEach(mutate);
    await assert.rejects(evaluate(rows), /Insufficient chronological history/);
  }
});

test('duplicate and conflicting fixtures fail closed in either input order', async () => {
  const rows=fixture();
  const conflict=[...rows[0]]; conflict[4]='3'; conflict[5]='7';
  for (const duplicate of [[...rows[0]],conflict]) {
    await assert.rejects(evaluate([...rows,duplicate]), /Duplicate historical game fixture/);
    await assert.rejects(evaluate([duplicate,...rows]), /Duplicate historical game fixture/);
  }
  const reversed=[...rows[0]];
  [reversed[2],reversed[3]]=[reversed[3],reversed[2]];
  await assert.rejects(evaluate([...rows,reversed]), /Duplicate historical game fixture/);
});

test('a source without any moneylines reports no matched comparison', async () => {
  const rows=fixture(); rows.forEach(row=>{row[6]='';row[7]='';});
  const result=await evaluate(rows);
  assert.equal(result.heldOut.model?.count,200);
  assert.equal(result.heldOut.matchedGames,0);
  assert.equal(result.heldOut.modelMatched,null);
  assert.equal(result.heldOut.uncalibratedMatched,null);
  assert.equal(result.heldOut.marketMatched,null);
});

test('score-only source keeps missing publication/final-state provenance blocked', async () => {
  const result=await evaluate(fixture().map(row=>row.slice(0,8)),headers.slice(0,8));
  assert.equal(result.games,700);
  assert.equal(result.liveApproved,false);
  assert.ok(result.blockers.includes('Source rows and rights require independent validation'));
});
