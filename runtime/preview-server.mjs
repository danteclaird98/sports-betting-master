/**
 * Adapter for the authenticated Computer preview proxy, not a public host.
 * Requires the proxy-injected visitor header; never accepts browser cookies as identity.
 * Each visitor receives a separate original, password-protected Node/Python runtime.
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedPath = path => path === '/session' || path === '/example.json'
  || path.startsWith('/api/') || path.startsWith('/edgeboard-api/') || path === '/tools/odds';

export function visitorKey(headers) {
  const id = headers['x-visitor-id'];
  if (typeof id !== 'string' || !id.trim() || id.length > 256 || /[\r\n\0]/.test(id)) return null;
  return createHash('sha256').update(id).digest('hex');
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
export async function startWorkspace(key, root, dataRoot) {
  const port = await freePort();
  let internal = await freePort();
  while (internal === port) internal = await freePort();
  const folder = join(dataRoot, key);
  await mkdir(folder, {recursive: true});
  const password = randomBytes(36).toString('base64url');
  const child = spawn(process.execPath, ['dist/server.mjs'], {
    cwd: root,
    // Deliberately do not inherit provider keys, connector credentials, or .env.
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
      HOST: '127.0.0.1', PORT: String(port), FUSION_INTERNAL_PORT: String(internal),
      WORKSPACE_USER: 'owner', WORKSPACE_PASSWORD: password,
      WORKSPACE_SESSION_SECRET: randomBytes(32).toString('hex'),
      EDGEBOARD_DB: join(folder, 'edgeboard.sqlite3'),
      EDGEFUSION_DB: join(folder, 'markets.sqlite3'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', () => {}); // Do not leak request data into shared logs.
  let failed = false;
  child.on('error', () => { failed = true; });
  const base = `http://127.0.0.1:${port}`;
  try {
    let healthy = false;
    for (let i = 0; i < 120; i++) {
      if (failed || child.exitCode !== null) throw Error('Workspace startup failed');
      try {
        const response = await fetch(base + '/health', {signal: AbortSignal.timeout(500)});
        if (response.ok) { healthy = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!healthy) throw Error('Workspace startup timed out');
    const login = await fetch(base + '/login', {
      method: 'POST', body: new URLSearchParams({username: 'owner', password}),
      redirect: 'manual', signal: AbortSignal.timeout(5000),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (login.status !== 303 || !cookie) throw Error('Internal authentication failed');
    return {base, cookie, child, created: Date.now(), stop: () => child.kill('SIGTERM')};
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
}

export function createPreviewServer({
  root = process.cwd(),
  dataRoot = resolve(root, 'data/private-preview'),
  workspaceFactory = key => startWorkspace(key, root, dataRoot),
  maxVisitors = 12,
} = {}) {
  const workspaces = new Map();
  const pending = new Map();
  const idleMs = 30 * 60 * 1000;
  function prune() {
    for (const [key, workspace] of workspaces) {
      if (Date.now() - workspace.lastUsed > idleMs || workspace.child?.exitCode !== null && workspace.child?.exitCode !== undefined
        || Date.now() - workspace.created > 11 * 60 * 60 * 1000) {
        workspace.stop();
        workspaces.delete(key);
      }
    }
  }
  async function workspaceFor(key) {
    prune();
    if (workspaces.has(key)) {
      const workspace = workspaces.get(key);
      workspace.lastUsed = Date.now();
      return workspace;
    }
    if (pending.has(key)) return pending.get(key);
    if (workspaces.size + pending.size >= maxVisitors) throw Error('Preview is at capacity; try again later');
    const promise = Promise.resolve().then(() => workspaceFactory(key)).then(workspace => {
      workspace.lastUsed = Date.now();
      workspaces.set(key, workspace);
      return workspace;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'});
      res.end(JSON.stringify(data));
    };
    try {
      const key = visitorKey(req.headers);
      if (!key) return reply(401, {error: 'Open this app through its private Computer preview.'});
      const url = new URL(req.url, 'http://preview.local');
      if (url.pathname === '/health') return reply(200, {status: 'ok', mode: 'private-preview'});
      if (!allowedPath(url.pathname)) return reply(404, {error: 'Unknown preview API route'});
      if (!['GET', 'POST'].includes(req.method)) return reply(405, {error: 'Method not allowed'});
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4000000) return reply(413, {error: 'Request exceeds 4 MB'});
        chunks.push(chunk);
      }
      const workspace = await workspaceFor(key);
      const response = await fetch(workspace.base + url.pathname + url.search, {
        method: req.method,
        headers: {'Cookie': workspace.cookie, 'Content-Type': req.headers['content-type'] || 'application/json'},
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        signal: AbortSignal.timeout(60000), redirect: 'manual',
      });
      const headers = {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      };
      if (url.pathname === '/example.json') headers['Content-Disposition'] = 'attachment; filename="example-quotes.json"';
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) reply(503, {error: 'Preview workspace is temporarily unavailable. Retry shortly.'});
      else res.end();
    }
  });
  const timer = setInterval(prune, 60000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); for (const workspace of workspaces.values()) workspace.stop(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createPreviewServer();
  const port = Number(process.env.PREVIEW_PORT || 8080);
  server.listen(port, '127.0.0.1', () => console.log(`Private preview adapter ready on ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
