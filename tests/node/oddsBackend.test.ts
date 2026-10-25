import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOddsGateway } from '../../apps/edgeboard/backend/oddsBackend.ts';
const settings={baseUrl:'https://odds.example.com',token:'x'.repeat(32)};
test('odds gateway verifies service identity and mode before displaying filtered stored observations',async()=>{
  const paths:string[]=[];
  const gateway=makeOddsGateway(async()=>settings,async(url,init)=>{
    paths.push(String(url));assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>)['X-MarketEdge-Read-Token'],settings.token);
    return Response.json(String(url).endsWith('/ready')?{status:'ok',service:'marketedge-odds',contract_version:'1',execution_enabled:false,data_mode:'mock'}:
      {id:1,sport:'football',league:'NFL',home_team:'home',away_team:'away',start_time_utc:'2026-11-01T20:00:00Z',private:'discard'},
      {headers:{'X-MarketEdge-Data-Mode':'mock'}});
  });
  const result=await gateway('event',{},'1');
  assert.equal(result.statusCode,200);
  assert.deepEqual(paths,['https://odds.example.com/ready','https://odds.example.com/events/1']);
  assert.equal(result.body.executionEnabled,false);
  assert.doesNotMatch(JSON.stringify(result),/discard|xxxxxxxx/);
});
test('odds gateway sanitizes transport failures and refuses invalid filters before transport',async()=>{
  let calls=0;
  const gateway=makeOddsGateway(async()=>settings,async()=>{calls++;throw Error('sensitive provider response');});
  const invalid=await gateway('events',{arbitrary:'filter'});
  assert.equal(invalid.statusCode,400);assert.equal(calls,0);
  const failed=await gateway('status');
  assert.equal(failed.statusCode,503);
  assert.equal(failed.body.state,'UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(failed),/sensitive provider response|xxxxxxxx/);
  assert.equal(calls,1);
});
