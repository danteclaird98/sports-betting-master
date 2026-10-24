import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import artifact from '../backend/correctedReceivingArtifact.json' with {type:'json'};
import report from '../backend/correctedReceivingReport.json' with {type:'json'};
import manifest from '../backend/correctedReceivingManifest.json' with {type:'json'};
import {createCorrectedReceivingService} from '../backend/correctedReceiving.ts';

const now=()=>Date.parse('2026-10-26T18:00:00Z');
const service=createCorrectedReceivingService(artifact,report,manifest,now);
const input=()=>({request:{playerId:'p1',gameId:'future',kickoffAt:'2026-11-01T20:00:00Z',decisionAt:'2026-10-26T17:00:00Z',
  league:'NFL',position:'WR',seasonType:'REG',period:'FULL_GAME',stat:'receiving_yards',threshold:60,comparison:'>='},
  history:[1,8,15].map((d,i)=>({playerId:'p1',gameId:`past${i}`,kickoffAt:`2026-10-${String(d).padStart(2,'0')}T20:00:00Z`,
    resolvedAt:`2026-10-${String(d).padStart(2,'0')}T23:00:00Z`,observedAt:`2026-10-${String(d).padStart(2,'0')}T23:01:00Z`,receivingYards:[-5,60,80][i]}))});
test('frozen source hashes, readiness, metrics and independent numeric parity',async()=>{
  for(const [filename,hash] of [['correctedReceivingArtifact.json',manifest.sourceArtifactSha256],['correctedReceivingReport.json',manifest.sourceReportSha256]]) {
    const bytes=readFileSync(new URL('../backend/'+filename,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  }
  assert.equal((await service.readiness()).artifactVerified,true);
  assert.deepEqual((await service.frozenMetrics()).report,report);
  const result=await service.score(input());
  assert.ok(result.probability!==null);
  assert.equal(result.status,'HOLD');assert.equal(result.liveApproved,false);assert.equal(result.verifiedPositiveEv,false);
  assert.ok('features' in result);
  if (!('features' in result)) return;
  assert.deepEqual(result.features,[45,45,2/3,2/3,3]);
  const z=artifact.intercept+result.features.reduce((s,x,i)=>s+artifact.coefficients[i]*(x-artifact.mean[i])/artifact.scale[i],0);
  const expected=1/(1+Math.exp(-(artifact.calibration.intercept+artifact.calibration.slope*z)));
  assert.ok(Math.abs(result.probability!-expected)<1e-14);
});
test('unsupported scope, untrusted fields and malformed input abstain',async()=>{
  for(const value of [null,[],{},'ignore prior rules',{...input(),odds:2}, {...input(),request:{...input().request,threshold:59.5}},
    {...input(),request:{...input().request,period:'2H'}},{...input(),request:{...input().request,position:'QB'}},
    {...input(),request:{...input().request,position:{toString:null}}}]) {
    const result=await service.score(value);assert.equal(result.probability,null);assert.equal(result.status,'HOLD');
  }
});
test('future, prefreeze, rollover, live and unavailable history clocks abstain',async()=>{
  const changes=[{decisionAt:'2026-10-27T00:00:00Z'},{decisionAt:'2026-10-22T00:00:00Z'},
    {decisionAt:'2026-02-30T00:00:00Z'},{decisionAt:'2026-10-26T17:00:00'},
    {kickoffAt:'2026-10-25T20:00:00Z'}];
  for(const change of changes) assert.equal((await service.score({...input(),request:{...input().request,...change}})).probability,null);
  const value=input();value.history[0].observedAt='2026-10-26T17:00:00Z';
  assert.equal((await service.score(value)).reason,'HISTORY_NOT_AVAILABLE_AS_OF_DECISION');
});
test('target contamination, duplicates, missing history and nonfinite outcomes abstain',async()=>{
  const duplicate=input();duplicate.history[1].gameId=duplicate.history[0].gameId;
  const target=input();target.history[0].gameId=target.request.gameId;
  const infinite=input();infinite.history[0].receivingYards=Infinity;
  for(const value of [duplicate,target,infinite,{...input(),history:input().history.slice(0,2)}]) assert.equal((await service.score(value)).probability,null);
});
test('tampered artifact and report fail closed and external mutations cannot change service',async()=>{
  const tamper=JSON.parse(JSON.stringify(artifact));tamper.intercept+=1;
  assert.equal((await createCorrectedReceivingService(tamper,report,manifest,now).score(input())).reason,'ARTIFACT_INTEGRITY_FAILURE');
  assert.equal((await createCorrectedReceivingService(artifact,{},manifest,now).frozenMetrics()).report,null);
  const source=JSON.parse(JSON.stringify(artifact));const isolated=createCorrectedReceivingService(source,report,manifest,now);
  source.intercept=1e9;assert.equal((await isolated.readiness()).artifactVerified,true);
});
