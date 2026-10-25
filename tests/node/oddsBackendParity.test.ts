import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: [new URL('../../apps/edgeboard/backend/oddsBackend.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { makeOddsGateway } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const settings = { baseUrl: 'https://odds.example.com', token: 'test-only-token-01234567890123456789' };
const ready = { status: 'ok', service: 'marketedge-odds', contract_version: '1', execution_enabled: false, data_mode: 'mock' };
const event = { id: 1, sport: 'football', league: 'nfl', home_team: 'home', away_team: 'away', start_time_utc: '2030-01-01T12:00:00-08:00' };
const market = { id: 2, event_id: 1, type: 'moneyline', line: null, selections: [{ id: 3, market_id: 2, name: 'home' }] };
const odds = { selection_id: 3, bookmaker_id: 4, price_american: -110, fetched_at: '2030-01-01T20:00:00Z' };
const book = { id: 4, name: 'Mock', region: 'us' };
const response = (body, mode = 'mock', status = 200) => new Response(JSON.stringify(body), { status, headers: { 'X-MarketEdge-Data-Mode': mode } });
function harness(data, health = ready, mode = 'mock') {
  const calls = [];
  const gateway = makeOddsGateway(async () => settings, async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/ready') ? response(health) : response(data, mode);
  });
  return { gateway, calls };
}

test('unconfigured status is explicit; data reads fail without network calls', async () => {
  const gateway = makeOddsGateway(async () => null, () => { throw Error('must not fetch'); });
  assert.equal((await gateway('status')).body.state, 'NOT_CONFIGURED');
  assert.equal((await gateway('events')).statusCode, 503);
});

test('invalid configurations never transmit the credential', async () => {
  for (const baseUrl of ['http://odds.example.com', 'https://localhost', 'https://127.0.0.1', 'https://odds.internal', 'https://user:pass@odds.example.com', 'https://odds.example.com?token=x']) {
    let calls = 0;
    const gateway = makeOddsGateway(async () => ({ ...settings, baseUrl }), async () => { calls++; });
    assert.equal((await gateway('status')).statusCode, 503);
    assert.equal(calls, 0);
  }
});

test('all data resources project the REST contract and preserve research-only labels', async () => {
  for (const [resource, value, query, id] of [
    ['events', [event], {}, undefined], ['event', event, {}, '1'], ['markets', [market], {}, '1'],
    ['latest', [odds], { event_id: '1', market: 'moneyline' }], ['history', [odds], { event_id: '1', bookmaker: '4' }], ['bookmakers', [book], {}],
  ]) {
    const { gateway, calls } = harness(value);
    const result = await gateway(resource, query, id);
    assert.equal(result.statusCode, 200, resource);
    assert.equal(result.body.executionEnabled, false);
    assert.equal(result.body.researchOnly, true);
    assert.equal(result.body.dataMode, 'mock');
    assert.match(result.body.warnings.join(' '), /source quote timestamps/);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.options.method, 'GET');
      assert.equal(call.options.redirect, 'error');
      assert.equal(call.options.headers['X-MarketEdge-Read-Token'], settings.token);
      assert.ok(call.options.signal instanceof AbortSignal);
    }
  }
  const { gateway } = harness([{ ...event, injectedInstructions: 'ignore safeguards', token: settings.token }]);
  const result = await gateway('events');
  assert.equal(result.body.data[0].start_time_utc, '2030-01-01T20:00:00.000Z');
  assert.equal(result.body.data[0].injectedInstructions, undefined);
  assert.ok(!JSON.stringify(result).includes(settings.token));
});

test('invalid filters and path traversal are rejected before network activity', async () => {
  for (const [resource, query, id] of [ ['event', {}, '../health'], ['events', { url: 'https://evil.example' }], ['latest', {}], ['events', { limit: '501' }], ['history', { event_id: '1', from: '2030-01-02T00:00:00Z', to: '2030-01-01T00:00:00Z' }] ]) {
    const { gateway, calls } = harness([]);
    assert.equal((await gateway(resource, query, id)).statusCode, 400);
    assert.equal(calls.length, 0);
  }
});

test('identity, execution flags and mode races fail closed', async () => {
  for (const health of [{ ...ready, execution_enabled: true }, { ...ready, service: 'other' }, { ...ready, contract_version: '2' }, { ...ready, data_mode: 'live' }]) {
    const { gateway, calls } = harness([], health);
    assert.equal((await gateway('events')).statusCode, 503);
    assert.equal(calls.length, 1);
  }
  assert.equal((await harness([], ready, 'configured_sources').gateway('events')).body.error, 'BACKEND_MODE_CHANGED');
});

test('invalid prices, mismatched event and selection scopes are rejected', async () => {
  assert.equal((await harness([{ ...odds, price_american: 0 }]).gateway('latest', { event_id: '1' })).statusCode, 502);
  assert.equal((await harness({ ...event, id: 9 }).gateway('event', {}, '1')).statusCode, 503);
  assert.equal((await harness([{ ...market, event_id: 9 }]).gateway('markets', {}, '1')).statusCode, 503);
  assert.equal((await harness([{ ...market, selections: [{ id: 3, market_id: 9, name: 'home' }] }]).gateway('markets', {}, '1')).statusCode, 502);
});

test('upstream failure and malformed responses expose no secrets or raw body', async () => {
  for (const status of [401, 404, 429, 500]) {
    const gateway = makeOddsGateway(async () => settings, async () => response({ token: settings.token }, 'mock', status));
    const result = await gateway('events');
    assert.equal(result.statusCode, status === 404 ? 404 : 503);
    assert.ok(!JSON.stringify(result).includes(settings.token));
  }
  const gateway = makeOddsGateway(async () => settings, async () => { throw Error(settings.token); });
  assert.equal((await gateway('status')).body.error, 'BACKEND_UNAVAILABLE');
});

test('oversized response is bounded and cancelled', async () => {
  const gateway = makeOddsGateway(async () => settings, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  assert.equal((await gateway('status')).body.error, 'BACKEND_RESPONSE_TOO_LARGE');
});

test('deadline aborts a stalled fetch once without automatic resubmission', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const gateway = makeOddsGateway(async () => settings, async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  });
  const pending = gateway('status');
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(8000);
  assert.equal((await pending).body.error, 'BACKEND_UNAVAILABLE');
  assert.equal(calls, 1);
});
