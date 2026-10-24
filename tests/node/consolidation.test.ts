import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('all eight source snapshots match the immutable file manifest', () => {
  const result = execFileSync(process.execPath, ['scripts/verify-sources.mjs'], {encoding: 'utf8'});
  assert.match(result, /Verified 8 source repositories/);
});

test('master package and independent runtime preserve the research boundary', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, 'sports-betting-master');
  assert.equal(pkg.private, true, 'prevent accidental npm publication; GitHub visibility is independent');
  const engine = readFileSync('apps/edgeboard/backend/engine.ts', 'utf8');
  assert.match(engine, /allowProviderRequests = false/);
  assert.match(engine, /allowProviderRequests \? await readParlayKey\(\) : null/);
  assert.doesNotMatch(engine, /from ['"]@appdeploy/);
  const app = readFileSync('apps/edgeboard/src/App.tsx', 'utf8');
  assert.match(app, /Independent model/);
  assert.match(app, /hashchange/);
  assert.match(app, /Sports Betting Master/);
});
