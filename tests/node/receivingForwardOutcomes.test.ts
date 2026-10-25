import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingForwardOutcomeLoader, createForwardOutcomeReader } from '../../apps/edgeboard/backend/receivingForwardOutcomes.ts';
import type { ForwardReceipt } from '../../apps/edgeboard/backend/receivingForwardCore.ts';

const now=Date.parse('2026-10-26T12:00:00Z');
const kickoff='2026-10-25T17:00:00Z';
const scheduleHeader='game_id,season,game_type,gameday,gametime,home_team,away_team,home_score,away_score,espn';
const statsHeader='player_id,game_id,season,season_type,position,team,receiving_yards';
function fixture(n=1) {
  const ids=Array.from({length:n},(_,i)=>`2026_08_SEA_LA_${i}`);
  const schedule=[scheduleHeader,...ids.map((id,i)=>`${id},2026,REG,2026-10-25,13:00,LA,SEA,24,17,${100000000+i}`)].join('\n');
  const stats=[statsHeader,...ids.map(id=>`qa-player,${id},2026,REG,WR,LA,60`)].join('\n');
  const summary=(id:string)=>({header:{id,season:{year:2026,type:2},competitions:[{id,date:kickoff,status:{type:{completed:true,state:'post'}},competitors:[{homeAway:'home',team:{abbreviation:'LAR'},score:'24'},{homeAway:'away',team:{abbreviation:'SEA'},score:'17'}]}]}});
  const receipts=ids.map(id=>({forecast:{playerId:'qa-player',gameId:id,kickoffAt:kickoff}})) as ForwardReceipt[];
  return {ids,schedule,stats,summary,receipts};
}
function loader(data:ReturnType<typeof fixture>, extra: {
  schedule?:string; stats?:string; mutate?:(value:any)=>void; fail?:'schedule'|'summary'|'stats';
}={}) {
  const calls:string[]=[];
  const load=createReceivingForwardOutcomeLoader({now:()=>now,loadText:async url=>{
    calls.push(url);
    if(url.endsWith('/games.csv')) {if(extra.fail==='schedule')throw Error('fixture');return extra.schedule??data.schedule;}
    if(url.includes('/summary?')) {
      if(extra.fail==='summary')throw Error('fixture');
      const value=data.summary(url.split('event=')[1]);extra.mutate?.(value);return JSON.stringify(value);
    }
    if(extra.fail==='stats')throw Error('fixture');
    return extra.stats??data.stats;
  }});
  return {load,calls};
}

test('exact final event is checked before published stats and all snapshots have hashes',async()=>{
  const data=fixture(),{load,calls}=loader(data);
  const result=await load(data.receipts);
  assert.equal(result.source.status,'AVAILABLE');
  assert.equal(result.source.publicationClockVerified,false);
  assert.equal(result.outcomes[0].finalStatus,'FINAL');
  assert.equal(result.outcomes[0].receivingYards,60);
  assert.equal(result.source.files.length,3);
  assert.ok(result.source.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)));
  assert.match(calls[1],/summary\?event=/);
  assert.match(calls.at(-1)!,/stats_player_week_2026.csv/);
});
test('empty or exclusively future records cause no source requests',async()=>{
  const data=fixture(),{load,calls}=loader(data);
  assert.equal((await load([])).source.reason,'NO_SAVED_FORECASTS');
  const future=[{forecast:{...data.receipts[0].forecast,kickoffAt:'2026-12-01T12:00:00Z'}}] as ForwardReceipt[];
  assert.equal((await load(future)).source.reason,'NO_COMPLETED_GAMES_TO_EVALUATE');
  assert.equal(calls.length,0);
});
test('nonfinal or contradictory ESPN status never establishes finality',async()=>{
  for(const mutate of [(v:any)=>{v.header.competitions[0].status.type.completed=false;},(v:any)=>{v.header.competitions[0].status.type.state='in';}]) {
    const data=fixture(),result=await loader(data,{mutate}).load(data.receipts);
    assert.equal(result.outcomes[0].finalStatus,'NOT_FINAL');
  }
});
test('event, season, teams, kickoff and score conflicts stay unresolved',async()=>{
  const mutations=[
    (v:any)=>{v.header.id='999999999';},
    (v:any)=>{v.header.season.type=3;},
    (v:any)=>{v.header.season.year=2025;},
    (v:any)=>{v.header.competitions[0].competitors[0].team.abbreviation='SF';},
    (v:any)=>{v.header.competitions[0].date='2026-10-25T18:00:00Z';},
    (v:any)=>{v.header.competitions[0].competitors[0].score='23';},
  ];
  for(const mutate of mutations) {
    const data=fixture(),result=await loader(data,{mutate}).load(data.receipts);
    assert.equal(result.outcomes[0].finalStatus,'UNKNOWN');
  }
});
test('duplicate schedule/native identities and changed saved kickoff are rejected',async()=>{
  const data=fixture();
  const duplicate=await loader(data,{schedule:data.schedule+'\n'+data.schedule.split('\n')[1]}).load(data.receipts);
  assert.equal(duplicate.outcomes[0].unresolvedReason,'SCHEDULE_IDENTITY_UNVERIFIED');
  const ids=fixture(2);
  const sameNative=ids.schedule.replace('100000001','100000000');
  assert.ok((await loader(ids,{schedule:sameNative}).load(ids.receipts)).outcomes.every(row=>row.finalStatus==='UNKNOWN'));
  const shifted=[{forecast:{...data.receipts[0].forecast,kickoffAt:'2026-10-25T18:00:00Z'}}] as ForwardReceipt[];
  assert.equal((await loader(data).load(shifted)).outcomes[0].unresolvedReason,'SCHEDULE_IDENTITY_UNVERIFIED');
});
test('missing rows are not created; duplicate and invalid observations are preserved for core resolution',async()=>{
  const data=fixture();
  assert.deepEqual((await loader(data,{stats:statsHeader}).load(data.receipts)).outcomes,[]);
  const duplicated=data.stats+'\n'+data.stats.split('\n')[1];
  assert.equal((await loader(data,{stats:duplicated}).load(data.receipts)).outcomes.length,2);
  assert.equal((await loader(data,{stats:data.stats.replace(',60',',')}).load(data.receipts)).outcomes[0].receivingYards,null);
  assert.equal((await loader(data,{stats:data.stats.replace(',60',',-5')}).load(data.receipts)).outcomes[0].receivingYards,-5);
  assert.equal((await loader(data,{stats:data.stats.replace(',WR,',',QB,')}).load(data.receipts)).outcomes[0].position,'QB');
  assert.equal((await loader(data,{stats:data.stats.replace(',LA,60',',SF,60')}).load(data.receipts)).outcomes[0].unresolvedReason,'PLAYER_TEAM_SCHEDULE_MISMATCH');
});
test('source failures preserve evidence and never fabricate usable outcomes',async()=>{
  for(const fail of ['schedule','stats'] as const) {
    const data=fixture(),result=await loader(data,{fail}).load(data.receipts);
    assert.equal(result.source.status,'UNAVAILABLE');
    assert.deepEqual(result.outcomes,[]);
    assert.equal(result.source.files.length,fail==='schedule'?0:2);
  }
  const data=fixture(),partial=await loader(data,{fail:'summary'}).load(data.receipts);
  assert.equal(partial.outcomes[0].finalStatus,'UNKNOWN');
  assert.equal(partial.outcomes[0].unresolvedReason,'FINAL_SOURCE_UNAVAILABLE');
});
test('summary checks are capped at eight with four-way concurrency and excess games remain unresolved',async()=>{
  const data=fixture(9);let active=0,maximum=0,summaries=0;
  const load=createReceivingForwardOutcomeLoader({now:()=>now,loadText:async url=>{
    if(url.endsWith('/games.csv'))return data.schedule;
    if(url.includes('/summary?')) {
      summaries++;active++;maximum=Math.max(maximum,active);
      await new Promise(resolve=>setTimeout(resolve,1));active--;
      return JSON.stringify(data.summary(url.split('event=')[1]));
    }
    assert.equal(active,0);return data.stats;
  }});
  const result=await load(data.receipts);
  assert.equal(summaries,8);assert.equal(maximum,4);
  assert.equal(result.outcomes.filter(row=>row.finalStatus==='FINAL').length,8);
  assert.equal(result.outcomes.at(-1)?.unresolvedReason,'FINAL_STATUS_CHECK_LIMIT');
  assert.deepEqual(result.source.finalGameWindow,{offset:0,maximum:8,totalDueGames:9,checked:8,nextOffset:8});
});
test('explicit final-game windows reach later games without changing archive membership',async()=>{
  const data=fixture(12),{load,calls}=loader(data);
  const result=await load(data.receipts,8);
  assert.equal(calls.filter(url=>url.includes('/summary?')).length,4);
  const selected=[...data.ids].sort().slice(8);
  assert.deepEqual(calls.filter(url=>url.includes('/summary?')).map(url=>url.split('event=')[1]).sort(),selected.map(id=>String(100000000+data.ids.indexOf(id))).sort());
  assert.deepEqual(result.outcomes.filter(row=>row.finalStatus==='FINAL').map(row=>row.gameId).sort(),selected);
  assert.equal(result.outcomes.filter(row=>row.unresolvedReason==='FINAL_STATUS_CHECK_LIMIT').length,8);
  assert.deepEqual(result.source.finalGameWindow,{offset:8,maximum:8,totalDueGames:12,checked:4,nextOffset:null});
});
test('invalid window offsets fail closed and exhausted windows remain explicit',async()=>{
  const data=fixture(),{load,calls}=loader(data);
  for(const offset of [-1,0.5,200,NaN,Infinity]) await assert.rejects(load(data.receipts,offset),/INVALID_FINAL_GAME_OFFSET/);
  assert.equal(calls.length,0);
  const exhausted=await load(data.receipts,8);
  assert.equal(calls.filter(url=>url.includes('/summary?')).length,0);
  assert.deepEqual(exhausted.source.finalGameWindow,{offset:8,maximum:8,totalDueGames:1,checked:0,nextOffset:null});
  assert.equal(exhausted.outcomes[0].unresolvedReason,'FINAL_STATUS_CHECK_LIMIT');
});
test('schema mismatches and oversized injected text return explicit unavailable state',async()=>{
  const data=fixture();
  assert.equal((await loader(data,{schedule:'unexpected,headers'}).load(data.receipts)).source.status,'UNAVAILABLE');
  assert.equal((await loader(data,{stats:'x'.repeat(16_000_001)}).load(data.receipts)).source.status,'UNAVAILABLE');
});
test('GitHub release asset redirects are bounded, allowlisted and use one timeout signal',async()=>{
  const calls:{url:string;signal:AbortSignal|null|undefined}[]=[];
  const asset='https://release-assets.githubusercontent.com/github-production-release-asset/123/file?signature=fixture';
  const reader=createForwardOutcomeReader(async(url,init)=>{
    calls.push({url,signal:init.signal});
    return url.startsWith('https://github.com/') ? new Response(null,{status:302,headers:{location:asset}}) : new Response('published csv');
  });
  const canonical='https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv';
  assert.equal(await reader(canonical),'published csv');
  assert.equal(calls.length,2);
  assert.equal(calls[0].signal,calls[1].signal);
  assert.equal(calls[1].url,asset);
});
test('redirects to arbitrary hosts, credentials, paths and ports are rejected',async()=>{
  const canonical='https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv';
  for(const location of ['https://attacker.invalid/file','https://release-assets.githubusercontent.com/other-path',
    'https://user:password@release-assets.githubusercontent.com/github-production-release-asset/file',
    'https://release-assets.githubusercontent.com:8443/github-production-release-asset/file',
    'http://release-assets.githubusercontent.com/github-production-release-asset/file']) {
    let calls=0;
    const reader=createForwardOutcomeReader(async()=>{calls++;return new Response(null,{status:302,headers:{location}});});
    await assert.rejects(reader(canonical),/REDIRECT_UNSUPPORTED/);
    assert.equal(calls,1);
  }
  let calls=0;
  const loop=createForwardOutcomeReader(async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/github-production-release-asset/file'}});});
  await assert.rejects(loop(canonical),/REDIRECT_UNSUPPORTED/);
  assert.equal(calls,4);
  const schedule=createForwardOutcomeReader(async()=>new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/github-production-release-asset/file'}}));
  await assert.rejects(schedule('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'),/REDIRECT_UNSUPPORTED/);
});
test('one overall source deadline is shared across reads and stops before stats after expiry',async()=>{
  const data=fixture(),signals:AbortSignal[]=[];let statsRequested=false;
  const load=createReceivingForwardOutcomeLoader({now:()=>now,deadlineMs:15,loadText:async(url,signal)=>{
    assert.ok(signal);signals.push(signal);
    if(url.endsWith('/games.csv')) return data.schedule;
    if(url.includes('/summary?')) {
      await new Promise(resolve=>setTimeout(resolve,40));
      return JSON.stringify(data.summary(url.split('event=')[1]));
    }
    statsRequested=true;return data.stats;
  }});
  const result=await load(data.receipts);
  assert.equal(result.source.status,'UNAVAILABLE');
  assert.equal(result.source.reason,'OUTCOME_SOURCE_TIMEOUT');
  assert.equal(statsRequested,false);
  assert.equal(signals.length,2);
  assert.equal(signals[0],signals[1]);
  assert.equal(signals[0].aborted,true);
});
test('public fetch receives cancellation from the overall source deadline',async()=>{
  const outer=new AbortController();let observed:AbortSignal|undefined;
  const reader=createForwardOutcomeReader(async(_url,init)=>{
    observed=init.signal!;
    assert.ok(observed);
    outer.abort();
    assert.equal(observed.aborted,true);
    throw observed.reason;
  });
  await assert.rejects(reader('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',outer.signal));
  assert.equal(observed?.aborted,true);
});
test('overall deadlines cannot be configured above the gateway-safe bound',()=>{
  for(const deadlineMs of [0,-1,24_001,NaN,Infinity]) assert.throws(()=>createReceivingForwardOutcomeLoader({deadlineMs}),/OUTCOME_DEADLINE_INVALID/);
});

test('evaluation cancellation is combined with the source deadline and stops before player stats',async()=>{
  const data=fixture(),evaluation=new AbortController();
  let observed:AbortSignal|undefined,statsRequested=false;
  const load=createReceivingForwardOutcomeLoader({now:()=>now,loadText:async(url,signal)=>{
    observed=signal;
    if(url.endsWith('/games.csv'))return data.schedule;
    if(url.includes('/summary?')){
      evaluation.abort(Error('EVALUATION_TIMEOUT'));
      return new Promise<string>(()=>{});
    }
    statsRequested=true;return data.stats;
  }});
  const result=await load(data.receipts,0,evaluation.signal);
  assert.equal(result.source.status,'UNAVAILABLE');
  assert.equal(result.source.reason,'OUTCOME_SOURCE_TIMEOUT');
  assert.equal(observed?.aborted,true);
  assert.equal(statsRequested,false);
});


test('malformed or truncated CSV quoting never becomes a scored numeric outcome',async()=>{
  const data=fixture();
  for (const malformed of ['"60','6"0"','"60"x','"60" "']) {
    const result=await loader(data,{stats:data.stats.replace(/,60$/,','+malformed)}).load(data.receipts);
    assert.equal(result.source.status,'UNAVAILABLE',malformed);
    assert.equal(result.source.reason,'OUTCOME_SOURCE_SCHEMA_INVALID',malformed);
    assert.deepEqual(result.outcomes,[],malformed);
    assert.equal(result.source.files.length,3);
  }
  const brokenSchedule=data.schedule.replace('24,17','2"4",17');
  const result=await loader(data,{schedule:brokenSchedule}).load(data.receipts);
  assert.equal(result.source.reason,'OUTCOME_SOURCE_SCHEMA_INVALID');
  assert.deepEqual(result.outcomes,[]);
});
test('strict outcome CSV supports valid quoted cells, escaped quotes and CRLF',async()=>{
  const data=fixture();
  const stats=data.stats.replace('receiving_yards','receiving_yards,unused').replace(/,60$/,',"60","quoted ""label"", with comma\nand newline"').replace(/\n/g,'\r\n')+'\r\n';
  const result=await loader(data,{stats}).load(data.receipts);
  assert.equal(result.source.status,'AVAILABLE');
  assert.equal(result.outcomes[0].finalStatus,'FINAL');
  assert.equal(result.outcomes[0].receivingYards,60);
});
