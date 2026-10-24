import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseHistoricalValue, validateHistoricalRows } from '../backend/historicalStatPolicy.ts';
import { buildHistoricalObservations } from '../backend/nflPropBacktest.ts';
import { csvRows } from '../backend/historicalNfl.ts';

test('signed yardage retained; invalid/missing yardage and invalid count outcomes rejected', () => {
  for (const m of ['receiving_yards','rushing_yards','passing_yards']) {
    assert.equal(parseHistoricalValue(m,'-2'),-2); assert.equal(parseHistoricalValue(m,'0'),0);
    for (const value of ['',' ','NaN','Infinity']) assert.equal(parseHistoricalValue(m,value),null);
  }
  assert.equal(parseHistoricalValue('receptions','-1'),null);
  assert.equal(parseHistoricalValue('receptions','1.5'),null);
  assert.equal(parseHistoricalValue('receptions','0'),0);
});
const fixture = () => [10,-2,70,-1,40].map((value,i)=>({id:'p1|WR',season:i<2?2023:2024,week:i<2?i+17:i-1,
  game:i<2?`2023_${i+17}_A_B`:`2024_0${i-1}_A_B`,value}));
test('warmup counts negatives and crosses seasons; current/future outcomes cannot alter earlier features', () => {
  const rows=fixture(), obs=buildHistoricalObservations(rows,60);
  assert.equal(obs.length,2); assert.equal(obs[0].y,0);
  assert.equal(obs[0].x[0],26/60);
  const changed=rows.map((r,i)=>i>=3?{...r,value:1000}:r);
  assert.deepEqual(buildHistoricalObservations(changed,60)[0].x,obs[0].x);
  assert.equal(buildHistoricalObservations(rows.slice(0,3),60).length,0);
});
test('shared normalization rejects duplicate player-week even if position/game differs', () => {
  const r=fixture();
  assert.throws(()=>validateHistoricalRows([...r,{...r[0],id:'p1|TE',game:'2023_17_C_D'}]),/Duplicate/);
  assert.throws(()=>buildHistoricalObservations([...r,r[0]],60),/Duplicate/);
  assert.throws(()=>validateHistoricalRows([{...r[0],game:'2022_17_A_B'}]),/identity/);
});
test('pinned real receiving cohort accounts for every warmup row', {skip:!process.env.NFL_HISTORY_DIR}, () => {
  const hashes=['41915fb49238902ad1f129ebf0405b11a1e710454ae0fe8f7b3e4f9145875f48','ad426c3fe5bf1cc30c3f137fdfe96d054e19d400879ee4413129da49fa7b54be','f19cb71a5de0dce7fd09376026237c9ee9d5a93fe13815a2ea3ec2d37204cb17','3ddc45a84f759aa348ce465ae001752c530575455717657cdfe1f8abfcdb4759','e5e0615b3d96a3eaebfaee91e55afb4a4e7fe0caf057454177bcd7d6ad4bcfc2'];
  const rows: Array<{id:string;season:number;week:number;game:string;value:number}>=[];
  for (let year=2021;year<=2025;year++) {
    const bytes=readFileSync(join(process.env.NFL_HISTORY_DIR!,`stats_player_week_${year}.csv`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hashes[year-2021]);
    const [headers,...data]=csvRows(bytes.toString()); const at=(key:string)=>headers.indexOf(key);
    for (const row of data) {
      if(row[at('season_type')]!=='REG'||!row[at('player_id')]||!['WR','RB','TE'].includes(row[at('position')]))continue;
      const value=parseHistoricalValue('receiving_yards',row[at('receiving_yards')]);
      if(value!==null)rows.push({id:row[at('player_id')]+'|'+row[at('position')],season:Number(row[at('season')]),week:Number(row[at('week')]),game:row[at('game_id')],value});
    }
  }
  const obs=buildHistoricalObservations(rows,60);
  assert.equal(rows.length,26097);assert.equal(rows.filter(r=>r.value<0).length,299);
  assert.equal(obs.length,23317);assert.equal(rows.length-obs.length,2780);
  assert.deepEqual([obs.filter(r=>r.season<=2023).length,obs.filter(r=>r.season===2024&&r.week<=9).length,
    obs.filter(r=>r.season===2024&&r.week>=10).length,obs.filter(r=>r.season===2025).length],[13344,2419,2490,5064]);
});
