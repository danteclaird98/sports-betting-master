import { test } from 'node:test';
import assert from 'node:assert/strict';
import { americanToDecimal, evaluateResearch, settleResearchOutcome, type ResearchInput } from '../../apps/edgeboard/backend/researchControls.ts';

const input: ResearchInput = {
  eventId:'fixture', marketKey:'binary', book:'paper',
  decisionAt:'2026-10-25T12:00:00Z', oddsAt:'2026-10-25T11:59:30Z',
  featureAvailableAt:'2026-10-25T11:00:00Z', modelTrainedThrough:'2026-10-24T00:00:00Z',
  decimalOdds:2, probability:0.7, probabilityLow:0.6, probabilityHigh:0.8,
  marketType:'binary_no_push', uncertaintyValidated:true, independentProbabilityValidated:true,
  eventVerified:true, marketVerified:true, sourceVerified:true, rulesVerified:true, priceAvailable:true,
};

test('American odds reject sub-100 magnitudes and retain valid boundaries',()=>{
  for(const value of [-50,50,0,NaN,Infinity]) assert.throws(()=>americanToDecimal(value),/invalid american odds/);
  assert.equal(americanToDecimal(100),2);
  assert.equal(americanToDecimal(-100),2);
});

test('research policy rejects non-finite and negative thresholds',()=>{
  for(const value of [NaN,Infinity,-Infinity,-1]) {
    assert.throws(()=>evaluateResearch(input,value,0.02),/invalid research policy thresholds/);
    assert.throws(()=>evaluateResearch(input,120,value),/invalid research policy thresholds/);
  }
  assert.equal(evaluateResearch({...input,oddsAt:input.decisionAt},0,0).status,'PASSES_RESEARCH');
});

test('research verification flags require exactly true',()=>{
  assert.equal(evaluateResearch(input).status,'PASSES_RESEARCH');
  const flags = {
    eventVerified:'event_verified missing', marketVerified:'market_verified missing',
    sourceVerified:'source_verified missing', rulesVerified:'rules_verified missing',
    priceAvailable:'price_available missing', uncertaintyValidated:'uncertainty not validated',
    independentProbabilityValidated:'independent probability model not validated',
  };
  for(const [key,reason] of Object.entries(flags)) for(const value of [false,1,'true',null,undefined]) {
    const result=evaluateResearch({...input,[key]:value} as ResearchInput);
    assert.equal(result.status,'ABSTAIN');
    assert.ok(result.reasonsToAbstain.includes(reason),`${key}: ${String(value)}`);
  }
});

test('settlement rejects non-finite stake or limit',()=>{
  for(const value of [NaN,Infinity,-Infinity,-1]) {
    assert.throws(()=>settleResearchOutcome('win',value,2,10,true),/invalid stake\/limit/);
    assert.throws(()=>settleResearchOutcome('win',10,2,value,true),/invalid stake\/limit/);
  }
});

test('settlement rejects invalid outcomes and non-boolean acceptance',()=>{
  for(const accepted of [1,0,'true',null,undefined]) {
    assert.throws(()=>settleResearchOutcome('win',10,2,10,accepted as never),/invalid settlement outcome or acceptance/);
  }
  assert.throws(()=>settleResearchOutcome('pending' as never,10,2,10,true),/invalid settlement outcome or acceptance/);
  assert.deepEqual(settleResearchOutcome('win',20,2,10,true),{filled:10,profit:10});
  assert.deepEqual(settleResearchOutcome('loss',20,2,10,false),{filled:0,profit:-0});
  for(const outcome of ['push','void'] as const) assert.deepEqual(settleResearchOutcome(outcome,20,2,10,true),{filled:10,profit:0});
});
