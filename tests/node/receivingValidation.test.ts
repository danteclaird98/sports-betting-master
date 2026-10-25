import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receivingValidationReport } from '../../apps/edgeboard/backend/receivingValidation.ts';

test('frozen 2026 evaluation remains retrospective and betting HOLD', async () => {
  const result = await receivingValidationReport();
  assert.equal(result.evidenceStatus,'AVAILABLE');
  assert.equal(result.modelIntegrityVerified,true);
  assert.equal(result.bettingDecision,'HOLD');
  assert.equal(result.liveApproved,false);
  assert.equal(result.evaluation?.prospectiveValidationAvailable,false);
  assert.equal(result.evaluation?.modelParametersChanged,false);
  assert.equal(result.evaluation?.counts.scoredRows,1707);
});
