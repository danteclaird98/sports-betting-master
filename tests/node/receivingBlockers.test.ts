import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receivingGuidance } from '../../apps/edgeboard/shared/receivingBlockers.ts';

test('methodological requirements have actions beyond retrying a source', () => {
  for (const code of ['FORWARD_VALIDATION_REQUIRED', 'HISTORICAL_PUBLICATION_CLOCKS_UNPROVEN']) {
    const guidance = receivingGuidance(code);
    assert.equal(guidance.code, code);
    assert.equal(guidance.category, 'methodology');
    assert.equal(guidance.retryable, false);
    assert.match(guidance.nextStep, /forward log/);
  }
});
test('participation and exact market verification remain separate blockers', () => {
  const participation = receivingGuidance('ROSTER_PARTICIPATION_UNVERIFIED');
  const price = receivingGuidance('NO_EXECUTABLE_MARKET_PRICE_OR_EV');
  assert.equal(participation.category, 'participation');
  assert.match(participation.nextStep, /roster/);
  assert.equal(price.category, 'market');
  assert.match(price.nextStep, /exact account selection/);
  assert.equal(price.retryable, false);
});
test('source failure retry cannot grant model approval', () => {
  const guidance = receivingGuidance('PUBLIC_SOURCE_HTTP_503');
  assert.equal(guidance.category, 'source');
  assert.equal(guidance.retryable, true);
  assert.match(guidance.nextStep, /Load source-backed players/);
  assert.match(guidance.nextStep, /No model approval change is needed/);
});
test('integrity failures direct audit rather than bypass or automatic retry', () => {
  for (const code of ['ARTIFACT_INTEGRITY_FAILURE', 'HISTORICAL_SEED_INTEGRITY_FAILURE']) {
    const guidance = receivingGuidance(code);
    assert.equal(guidance.category, 'integrity');
    assert.equal(guidance.retryable, false);
    assert.match(guidance.nextStep, /Do not bypass/);
  }
});
test('unknown and clock-invalid codes fail conservatively and retain original evidence', () => {
  const unknown = receivingGuidance('FUTURE_UNKNOWN_CODE');
  assert.equal(unknown.code, 'FUTURE_UNKNOWN_CODE');
  assert.equal(unknown.category, 'unknown');
  assert.equal(unknown.retryable, false);
  assert.match(unknown.nextStep, /Keep HOLD/);
  assert.equal(receivingGuidance('constructor').category, 'unknown');
  const clock = receivingGuidance('SOURCE_OBSERVED_AFTER_SERVER_CLOCK');
  assert.equal(clock.retryable, false);
  assert.match(clock.explanation, /timeline/);
});
test('no eligible fixtures and insufficient history have different next steps', () => {
  const empty = receivingGuidance('NO_ELIGIBLE_CURRENT_PLAYERS_OR_FUTURE_GAMES');
  const history = receivingGuidance('INSUFFICIENT_HISTORY');
  assert.match(empty.nextStep, /Broaden the player search/);
  assert.match(history.explanation, /at least three/);
  assert.equal(history.retryable, false);
});
