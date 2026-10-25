import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerNumber } from '../../apps/edgeboard/shared/ledgerInput.ts';
import { archivePrediction } from '../../apps/edgeboard/backend/predictionLedger.ts';

test('ledger numbers reject coercion and non-finite values',()=>{
  for(const value of ['', '0.5', null, undefined, true, false, [], {}, NaN, Infinity, -Infinity]) {
    assert.throws(()=>ledgerNumber(value,'stake'),/Invalid stake: a finite number is required/);
  }
  for(const value of [0,0.5,100]) assert.equal(ledgerNumber(value,'stake'),value);
});

test('prediction archive rejects coerced probability and numeric fields before storage',async()=>{
  const fixture={probability:0.7,probabilityLow:0.6,probabilityHigh:0.8,decimalOdds:2,line:60,
    event:'QA fixture',market:'receiving',selection:'over',sourceDecisionId:'fixture',
    decisionAt:'2026-10-25T12:00:00Z',oddsAt:'2026-10-25T11:59:00Z'};
  for(const key of ['probability','probabilityLow','probabilityHigh','decimalOdds','line']) {
    for(const value of ['0.7',null,true,NaN,Infinity]) {
      if(key==='line' && value===null) continue; // Optional line retains its source semantics.
      await assert.rejects(archivePrediction('fixture',{...fixture,[key]:value}),/finite number is required/);
    }
  }
});
