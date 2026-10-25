import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyScanStatus } from '../../apps/edgeboard/shared/dailyScanStatus.ts';

const sport = (...statuses: string[]) => ({
  status: 'NO_QUALIFYING_OPPORTUNITIES',
  sourceHealth: statuses.map((status, index) => ({ source: `feed-${index}`, status })),
});

test('both ordinary feed failures remain visible despite fulfilled report', () => {
  const result = dailyScanStatus([sport('UNAVAILABLE', 'UNAVAILABLE')], 0);
  assert.equal(result.status, 'SOURCE_UNAVAILABLE');
  assert.equal(result.unavailableSources, 2);
  assert.doesNotMatch(result.description, /Public prices were returned/);
});
test('partial failure retains research prices and reports incomplete coverage', () => {
  const result = dailyScanStatus([sport('UNAVAILABLE', 'RETRIEVED')], 3);
  assert.equal(result.status, 'RESEARCH_ONLY');
  assert.equal(result.unavailableSources, 1);
  assert.match(result.description, /Betting value is not established/);
});
test('successful empty feed is distinct from source failure or model rejection', () => {
  const result = dailyScanStatus([sport('RETRIEVED', 'RETRIEVED')], 0);
  assert.equal(result.status, 'NO_UPCOMING_PRICES');
  assert.equal(result.unavailableSources, 0);
});
test('partial failure without prices stays an incomplete empty result', () => {
  const result = dailyScanStatus([sport('RETRIEVED', 'UNAVAILABLE')], 0);
  assert.equal(result.status, 'NO_UPCOMING_PRICES');
  assert.equal(result.unavailableSources, 1);
});
test('unsupported coverage is not counted as a failed source', () => {
  const result = dailyScanStatus([sport('SPORT_UNSUPPORTED')], 0);
  assert.equal(result.status, 'UNSUPPORTED');
  assert.equal(result.unavailableSources, 0);
  assert.equal(result.unsupportedSources, 1);
});
test('empty selected sport never inherits another sports prices', () => {
  const rows = [sport('RETRIEVED'), sport('UNAVAILABLE')];
  assert.equal(dailyScanStatus(rows, 1).status, 'RESEARCH_ONLY');
  assert.equal(dailyScanStatus([rows[1]], 0).status, 'SOURCE_UNAVAILABLE');
});
test('candidates do not bypass the verification requirement', () => {
  const result = dailyScanStatus([sport('RETRIEVED')], 1, 1);
  assert.equal(result.status, 'CANDIDATES_REQUIRE_VERIFICATION');
  assert.match(result.title, /^HOLD/);
});
test('legacy reports fail conservatively without inventing prices', () => {
  assert.equal(dailyScanStatus([{status:'UNAVAILABLE'}], 0).status, 'SOURCE_UNAVAILABLE');
  assert.equal(dailyScanStatus([{status:'NO_QUALIFYING_OPPORTUNITIES'}], 0).status, 'DATA_UNAVAILABLE');
});

test('absent and unknown diagnostics never masquerade as a successful empty scan', () => {
  assert.equal(dailyScanStatus([],0).status,'DATA_UNAVAILABLE');
  assert.equal(dailyScanStatus([sport('BROKEN')],0).status,'DATA_UNAVAILABLE');
  assert.equal(dailyScanStatus([sport('SPORT_UNSUPPORTED','BROKEN')],0).status,'DATA_UNAVAILABLE');
});
test('unknown diagnostics remain visible alongside a retrieved feed', () => {
  const result = dailyScanStatus([sport('RETRIEVED','UNKNOWN')],0);
  assert.equal(result.status,'NO_UPCOMING_PRICES');
  assert.equal(result.unknownSources,1);
});
