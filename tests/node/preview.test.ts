import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewServer, visitorKey } from '../../runtime/preview-server.mjs';

test('visitor identities are required, hashed and stable', () => {
  assert.equal(visitorKey({}), null);
  assert.equal(visitorKey({'x-visitor-id': ''}), null);
  assert.equal(visitorKey({'x-visitor-id': ['forged', 'duplicate']}), null);
  assert.equal(visitorKey({'x-visitor-id': 'a\nb'}), null);
  assert.equal(visitorKey({'x-visitor-id': 'visitor-a'}), visitorKey({'x-visitor-id': 'visitor-a'}));
  assert.notEqual(visitorKey({'x-visitor-id': 'visitor-a'}), visitorKey({'x-visitor-id': 'visitor-b'}));
});

test('private preview enforces authorization, isolates routing and coalesces startup', async () => {
  const calls: string[] = [];
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({cookie: req.headers.cookie, path: req.url}));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as {port: number}).port;
  const preview = createPreviewServer({workspaceFactory: async (key: string) => {
    calls.push(key);
    await new Promise(resolve => setTimeout(resolve, 25));
    return {base: `http://127.0.0.1:${upstreamPort}`, cookie: `internal=${key}`, created: Date.now(), stop() {}};
  }});
  await new Promise<void>(resolve => preview.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(preview.address() as {port: number}).port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 401);
    const headers = {'x-visitor-id': 'visitor-a', 'cookie': 'spoofed=true'};
    assert.equal((await fetch(base + '/arbitrary', {headers})).status, 404);
    const [a, b] = await Promise.all([
      fetch(base + '/api/state', {headers}).then(r => r.json()),
      fetch(base + '/api/state', {headers}).then(r => r.json()),
    ]);
    assert.equal(a.cookie, b.cookie);
    assert.doesNotMatch(a.cookie, /spoofed/);
    assert.equal(calls.length, 1);
    const other = await fetch(base + '/api/state', {headers: {'x-visitor-id': 'visitor-b'}}).then(r => r.json());
    assert.notEqual(a.cookie, other.cookie);
    assert.equal(calls.length, 2);
    assert.equal((await fetch(base + '/api/state', {method: 'DELETE', headers})).status, 405);
  } finally {
    await new Promise<void>(resolve => preview.close(() => resolve()));
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
