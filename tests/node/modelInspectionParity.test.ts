import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';

test('inspection rejects conflicting, incomplete or approval-bearing backend evidence',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'edgeboard-model-inspection-'));
 try{
  const root=fileURLToPath(new URL('../../apps/edgeboard/',import.meta.url));
  const stub=join(directory,'client.ts');await writeFile(stub,'export const api = {};');
  const output=join(directory,'inspection.mjs');
  await build({stdin:{contents:"export {validInspection,validScoreReceipt} from './src/CorrectedReceivingLab';",resolveDir:root},outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'test-client',setup(builder){builder.onResolve({filter:/runtime\/client\.ts$/},()=>({path:stub}));}}],logLevel:'silent'});
  const {validInspection,validScoreReceipt}=await import(pathToFileURL(output).href);
  const state={status:'HOLD',liveApproved:false,verifiedPositiveEv:false,productionEnabled:false,executionEnabled:false,artifactSha256:'a'.repeat(64),artifactAvailableAt:'2026-10-24T19:00:00Z',reason:'FORWARD_VALIDATION_REQUIRED'};
  const ready={...state,artifactVerified:true,independentOfOdds:true,untouchedHoldout:false};
  const metric={n:12,brier:.2,log_loss:.6};
  const report={...state,report:{counts:{train:10,selection:11,calibration:12,consumed_diagnostic:12},exclusions:{insufficient_prior_rows:3},negative_yard_rows_retained:4,partition_metrics:{consumed_diagnostic:{p_raw:metric,p_calibrated:metric,train_base_rate:metric}}}};
  assert.equal(validInspection(ready,report),true);
  for(const mutation of [{artifactVerified:false},{executionEnabled:true},{liveApproved:true},{untouchedHoldout:true},{artifactSha256:'b'.repeat(64)},{artifactAvailableAt:'2026-10-24T19:00:00'}])assert.equal(validInspection({...ready,...mutation},report),false);
  for(const broken of [null,{}, {...report,report:null},{...report,report:{...report.report,counts:{...report.report.counts,train:Number.MAX_SAFE_INTEGER+1}}},{...report,report:{...report.report,partition_metrics:{consumed_diagnostic:{...report.report.partition_metrics.consumed_diagnostic,p_raw:{...metric,n:11}}}}}])assert.equal(validInspection(ready,broken),false);
  assert.equal(validScoreReceipt({...state,probability:.5},ready),true);
  assert.equal(validScoreReceipt({...state,probability:null},ready),true);
  for(const mutation of [{probability:1.01},{probability:NaN},{probability:true},{executionEnabled:true},{artifactSha256:'b'.repeat(64)}])assert.equal(validScoreReceipt({...state,probability:.5,...mutation},ready),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
