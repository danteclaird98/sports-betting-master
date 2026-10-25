import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

test('built gateway accepts Fly HTTPS requests and rejects host/origin/session violations', {
  timeout:30_000,
  skip:existsSync('dist/server.mjs') ? false : 'Run npm run build before the hosted gateway smoke test',
}, async () => {
  const configText = await readFile('fly.toml','utf8');
  const config = JSON.parse(execFileSync('python3',[
    '-c','import json,sys,tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))',
  ],{input:configText,encoding:'utf8'}));
  const hostname = config.http_service.checks[0].headers.Host;
  const configuredEnv = config.env as Record<string,string>;
  assert.equal(configuredEnv.HOST,'0.0.0.0');
  assert.equal(configuredEnv.COOKIE_SECURE,'true');
  assert.equal(config.http_service.internal_port,Number(configuredEnv.PORT));
  assert.equal(config.http_service.force_https,true);
  assert.equal(config.http_service.checks[0].path,'/health');
  assert.ok(configuredEnv.ALLOWED_HOSTS.split(',').includes(hostname));
  assert.ok(hostname.endsWith('.fly.dev'));

  const folder = await mkdtemp(join(tmpdir(),'fly-hosted-gateway-'));
  const port = await freePort();
  let internal = await freePort();
  while(internal === port) internal = await freePort();
  const password = randomBytes(24).toString('hex');
  const grouped = process.platform !== 'win32';
  const child = spawn(process.execPath,['dist/server.mjs'],{
    cwd:process.cwd(), detached:grouped,
    env:{PATH:process.env.PATH,...configuredEnv,PORT:String(port),FUSION_INTERNAL_PORT:String(internal),
      WORKSPACE_USER:'owner',
      WORKSPACE_PASSWORD:password,WORKSPACE_SESSION_SECRET:randomBytes(32).toString('hex'),
      EDGEBOARD_DB:join(folder,'edgeboard.sqlite3'),EDGEFUSION_DB:join(folder,'edgefusion.sqlite3')},
    stdio:['ignore','ignore','pipe'],
  });
  let startupError = '';
  child.stderr.on('data',value => {startupError=(startupError+String(value)).slice(-4000);});
  child.on('error',error => {startupError=error.message;});
  const exited = new Promise<void>(resolve => child.once('close',()=>resolve()));
  const send = (path:string, options:{method?:string;headers?:Record<string,string>;body?:string}={}) =>
    new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;body:string}>((resolve,reject) => {
      const req=request({hostname:'127.0.0.1',port,path,method:options.method ?? 'GET',
        headers:{Host:hostname,Connection:'close',...options.headers}},res => {
        const chunks:Buffer[]=[];
        res.on('data',chunk=>chunks.push(Buffer.from(chunk)));
        res.on('error',reject);
        res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks).toString()}));
      });
      req.on('error',reject);
      req.setTimeout(1_000,()=>req.destroy(Error('Hosted test request timed out')));
      req.end(options.body);
    });
  const login = (origin:string,passwordValue=password) => send('/login',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({username:'owner',password:passwordValue}).toString(),
  });
  try {
    let healthy=false;
    const startupDeadline = performance.now()+12_000;
    while(performance.now()<startupDeadline) {
      assert.equal(child.exitCode,null,`Hosted gateway exited before ready: ${startupError}`);
      try {const response=await send('/health');healthy=response.status===200 && JSON.parse(response.body).runtime==='self-hosted';} catch {}
      if(healthy) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(healthy,true,`Hosted gateway health failed: ${startupError}`);
    assert.equal((await send('/health',{headers:{Host:'untrusted.example'}})).status,403);
    assert.equal((await send('/session')).status,401);
    assert.equal((await send('/api/provider-imports')).status,401);
    assert.equal((await send('/edgeboard-api/sgo/history')).status,401);
    const anonymous=await send('/');
    assert.equal(anonymous.status,303);
    assert.equal(anonymous.headers.location,'/login');
    assert.equal((await login('http://'+hostname)).status,403);
    assert.equal((await login('https://untrusted.example')).status,403);
    assert.equal((await login('https://'+hostname,'incorrect-test-password')).status,401);

    const signedIn=await login('https://'+hostname);
    assert.equal(signedIn.status,303);
    const setCookie=signedIn.headers['set-cookie']?.[0];
    assert.ok(setCookie);
    assert.match(setCookie,/; Secure(?:;|$)/);
    assert.match(setCookie,/; HttpOnly(?:;|$)/);
    assert.match(setCookie,/; SameSite=Strict(?:;|$)/);
    const cookie=setCookie.split(';')[0];
    // HTTP here represents the private proxy-to-machine hop, not public TLS.
    // Send the Secure cookie explicitly to verify server-side session handling.
    const session=await send('/session',{headers:{Cookie:cookie}});
    assert.equal(session.status,200);
    assert.equal(JSON.parse(session.body).user.userId,'owner');
    assert.equal((await send('/session',{headers:{Cookie:cookie+'tampered'}})).status,401);
    const workspace=await send('/edgeboard/',{headers:{Cookie:cookie}});
    assert.equal(workspace.status,200);
    assert.match(workspace.headers['content-type'] ?? '',/text\/html/);
    const protocol=await send('/edgeboard-api/receiving-forward-protocol',{headers:{Cookie:cookie}});
    assert.equal(protocol.status,200);
    assert.equal(JSON.parse(protocol.body).bettingDecision,'HOLD');
    const privateHeaders={Cookie:cookie,Origin:'https://'+hostname,'Content-Type':'application/json'};
    const importBody={request_id:'hosted-import-001',format:'normalized',payload:[{
      provider:'synthetic',event_id:'synthetic:123',event:'Away @ Home',league:'NFL',bookmaker:'fixture',
      selection:'Home',period:'full_game',rules:'unknown',market:'moneyline',decimal_price:2,
      starts_at:'2030-11-01T20:00:00Z',source_market_id:'native-id',status:'open',
    }]};
    assert.equal((await send('/api/provider-imports',{
      method:'POST',headers:{...privateHeaders,Origin:'https://untrusted.example'},body:JSON.stringify(importBody),
    })).status,403);
    const savedImport=await send('/api/provider-imports',{method:'POST',headers:privateHeaders,body:JSON.stringify(importBody)});
    assert.equal(savedImport.status,200);
    assert.equal(JSON.parse(savedImport.body).verification,'UNVERIFIED');
    assert.equal(JSON.parse(savedImport.body).execution_enabled,false);
    const replay=await send('/api/provider-imports',{method:'POST',headers:privateHeaders,body:JSON.stringify(importBody)});
    assert.deepEqual(JSON.parse(replay.body),JSON.parse(savedImport.body));
    const imports=JSON.parse((await send('/api/provider-imports',{headers:{Cookie:cookie}})).body);
    assert.equal(imports.observation_count,1);
    assert.equal(imports.observations[0].updated_at,null);
    const rootState=JSON.parse((await send('/api/state',{headers:{Cookie:cookie}})).body);
    assert.equal(rootState.summary.snapshots,0);
    assert.deepEqual(rootState.wagers,[]);
    importBody.payload[0].decimal_price=3;
    assert.equal((await send('/api/provider-imports',{method:'POST',headers:privateHeaders,body:JSON.stringify(importBody)})).status,400);
    assert.equal((await send('/api/provider-imports',{method:'POST',headers:privateHeaders,body:'['.repeat(1500)+'0'+']'.repeat(1500)})).status,400);
    const sgoStatus=await send('/edgeboard-api/sgo/status',{headers:{Cookie:cookie}});
    assert.equal(sgoStatus.status,200);
    assert.equal(JSON.parse(sgoStatus.body).configured,false);
    assert.equal((await send('/edgeboard-api/sgo/history?owner=someone-else',{headers:{Cookie:cookie}})).status,403);
    assert.equal((await send('/edgeboard-api/sgo/history?owner=owner',{headers:{Cookie:cookie}})).status,400);
    const localHistory=await send('/edgeboard-api/sgo/history?owner=owner&league=NFL&mode=upcoming',{headers:{Cookie:cookie}});
    assert.equal(localHistory.status,200);
    assert.deepEqual(JSON.parse(localHistory.body).items,[]);
    assert.equal((await send('/edgeboard-api/odds-backend/events/1/markets',{headers:{Cookie:cookie}})).status,503);
    assert.equal((await send('/edgeboard-api/odds-backend/events?limit=1&limit=2',{headers:{Cookie:cookie}})).status,400);
    const logout=await send('/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://'+hostname}});
    assert.equal(logout.status,200);
    assert.match(logout.headers['set-cookie']?.[0] ?? '',/Max-Age=0/);
    assert.match(logout.headers['set-cookie']?.[0] ?? '',/; Secure(?:;|$)/);
  } finally {
    const signal = (value:NodeJS.Signals) => {
      try {
        if(grouped && child.pid) process.kill(-child.pid,value);
        else child.kill(value);
      } catch(error) { if((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    };
    signal('SIGTERM');
    const force=setTimeout(()=>signal('SIGKILL'),3_000);
    try {await exited;} finally {clearTimeout(force);await rm(folder,{recursive:true,force:true});}
  }
});
