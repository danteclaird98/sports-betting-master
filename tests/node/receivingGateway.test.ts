import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

test('built gateway exposes model research and protects private forecast history', {
  timeout:30_000,
  skip:existsSync('dist/server.mjs') ? false : 'Run npm run build before the gateway smoke test',
}, async () => {
  const folder = await mkdtemp(join(tmpdir(),'receiving-gateway-'));
  const port = await freePort();
  let internal = await freePort();
  while (internal === port) internal = await freePort();
  const password = randomBytes(24).toString('hex');
  const child = spawn(process.execPath,['dist/server.mjs'],{
    cwd:process.cwd(),
    env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:String(port),FUSION_INTERNAL_PORT:String(internal),
      WORKSPACE_USER:'owner',WORKSPACE_PASSWORD:password,WORKSPACE_SESSION_SECRET:randomBytes(32).toString('hex'),
      EDGEBOARD_DB:join(folder,'edgeboard.sqlite3'),EDGEFUSION_DB:join(folder,'edgefusion.sqlite3')},
    stdio:['ignore','ignore','pipe'],
  });
  let error=''; child.stderr.on('data',value => {error=(error+String(value)).slice(-4000);});
  const base=`http://127.0.0.1:${port}`;
  try {
    let healthy=false;
    for(let i=0;i<100;i++) {
      assert.equal(child.exitCode,null,`Gateway exited before ready: ${error}`);
      try {healthy=(await fetch(base+'/health',{signal:AbortSignal.timeout(500)})).ok;} catch {}
      if(healthy) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(healthy,true,`Gateway health check failed: ${error}`);
    assert.equal((await fetch(base+'/edgeboard-api/receiving-forward?owner=owner')).status,401);
    assert.equal((await fetch(base+'/edgeboard-api/receiving-forward-evaluation?owner=owner',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const login = await fetch(base+'/login',{method:'POST',body:new URLSearchParams({username:'owner',password}),redirect:'manual'});
    assert.equal(login.status,303);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const read = (path:string) => fetch(base+'/edgeboard-api'+path,{headers:{Cookie:cookie!}});
    const post = (path:string,body:unknown) => fetch(base+'/edgeboard-api'+path,{method:'POST',headers:{Cookie:cookie!,'Content-Type':'application/json'},body:JSON.stringify(body)});

    const protocolResponse = await read('/receiving-forward-protocol');
    assert.equal(protocolResponse.status,200);
    const protocol = await protocolResponse.json();
    assert.equal(protocol.bettingDecision,'HOLD');
    assert.equal(protocol.liveApproved,false);

    const validation = await (await read('/receiving-validation')).json();
    assert.equal(validation.evidenceStatus,'AVAILABLE');
    assert.equal(validation.liveApproved,false);
    assert.equal(validation.executionEnabled,false);

    // Invalid requests must fail before any public source/provider request.
    const blocked = await (await post('/receiving-forecast',{})).json();
    assert.equal(blocked.reason,'INVALID_REQUEST_SCHEMA');
    assert.equal(blocked.probability,null);
    const options = await (await read('/receiving-forecast-options?query='+encodeURIComponent('x'.repeat(101)))).json();
    assert.equal(options.reason,'INVALID_PLAYER_QUERY');
    assert.deepEqual(options.players,[]);

    assert.equal((await read('/receiving-forward?owner=someone-else')).status,403);
    assert.equal((await post('/receiving-forward-evaluation?owner=someone-else',{})).status,403);
    assert.equal((await post('/receiving-forward-evaluation?owner=owner',{probability:1})).status,400);
    const evaluationResponse=await post('/receiving-forward-evaluation?owner=owner',{});
    assert.equal(evaluationResponse.status,200);
    const evaluation=await evaluationResponse.json();
    assert.equal(evaluation.readOnly,true);
    assert.equal(evaluation.source.reason,'NO_SAVED_FORECASTS');
    assert.equal(evaluation.recordsIncluded,0);
    assert.equal(evaluation.scores.selected,null);
    assert.equal(evaluation.liveApproved,false);
    const historyResponse = await read('/receiving-forward?owner=owner');
    assert.equal(historyResponse.status,200);
    const history = await historyResponse.json();
    assert.equal(history.owner,'owner');
    assert.deepEqual(history.items,[]);
    assert.equal((await post('/receiving-forward?owner=owner',{playerId:'synthetic',gameId:'synthetic',probability:1})).status,400);
    assert.deepEqual((await (await read('/receiving-forward?owner=owner')).json()).items,[]);
  } finally {
    if(child.exitCode===null) {
      await new Promise<void>(resolve => {
        const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
        child.once('exit',()=>{clearTimeout(timer);resolve();});
        child.kill('SIGTERM');
      });
    }
    await rm(folder,{recursive:true,force:true});
  }
});
