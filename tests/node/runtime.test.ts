import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'edgefusion-runtime-'));
process.env.EDGEBOARD_DB=join(dir,'test.sqlite');
const {db,router,json,requireAuth}=await import('../../runtime/sdk.ts');
test('database isolation, pagination, CRUD and atomic snapshot upserts',async()=>{
  const [id]=await db.add('user:a',[{value:1}]);
  assert.equal((await db.get<any>('user:a',[id]))[0]?.value,1);
  assert.equal((await db.get('user:b',[id]))[0],null);
  await db.update('user:a',[{id,record:{value:2}}]);
  assert.equal((await db.get<any>('user:a',[id]))[0]?.value,2);
  await db.add('user:a',[{value:3}]);
  const first=await db.list('user:a',{limit:1});assert.ok(first.nextToken);
  assert.equal((await db.list('user:a',{limit:1,nextToken:first.nextToken!})).items.length,1);
  await db.transact([db.tx.update('snapshot',[{id:'index',record:{parts:['p1']}}]),db.tx.update('snapshot',[{id:'p1',record:{value:1}}])]);
  assert.equal((await db.get<any>('snapshot',['p1']))[0]?.value,1);
  await assert.rejects(()=>db.transact([db.tx.update('snapshot',[{id:'p1',record:{value:2}}]),db.tx.update('snapshot',[{id:null as any,record:{bad:true}}]) ]));
  assert.equal((await db.get<any>('snapshot',['p1']))[0]?.value,1);
  assert.deepEqual(await db.delete('user:a',[id]),[true]);
});
test('routing preserves auth middleware, query, body and errors',async()=>{
  const handler=router({'POST /api/test':[requireAuth(),async ctx=>json({id:ctx.user.userId,body:ctx.body,q:ctx.query.x})]});
  assert.equal((await handler({method:'POST',path:'/api/test',query:{}})).status,401);
  const result=await handler({method:'POST',path:'/api/test',query:{x:'yes'},body:{x:1},user:{userId:'owner'}});
  assert.deepEqual(result.data,{id:'owner',body:{x:1},q:'yes'});
  assert.equal((await handler({method:'GET',path:'/missing',query:{}})).status,404);
});
test('parameter routes preserve auth and decode identifiers while exact routes take precedence',async()=>{
  let dynamicCalls=0;
  const handler=router({
    'GET /api/events/:id':[requireAuth(),async ctx=>{dynamicCalls++;return json({id:ctx.params.id,owner:ctx.user.userId,query:ctx.query});}],
    'GET /api/events/latest':[requireAuth(),async()=>json({scope:'latest'})],
    'GET /api/events/:id/markets':[requireAuth(),async ctx=>json({eventId:ctx.params.id})],
  });
  const request={method:'GET',query:{limit:'2'},user:{userId:'owner'}};
  assert.equal((await handler({...request,path:'/api/events/123',user:undefined})).status,401);
  assert.equal(dynamicCalls,0);
  assert.deepEqual((await handler({...request,path:'/api/events/native%2Devent'})).data,
    {id:'native-event',owner:'owner',query:{limit:'2'}});
  assert.deepEqual((await handler({...request,path:'/api/events/latest'})).data,{scope:'latest'});
  assert.equal(dynamicCalls,1,'An exact route must not be handled as an identifier');
  assert.deepEqual((await handler({...request,path:'/api/events/123/markets'})).data,{eventId:'123'});
  assert.equal((await handler({...request,method:'POST',path:'/api/events/123'})).status,404);
});
test('malformed or separator-bearing route parameters fail before invoking a handler',async()=>{
  let calls=0;
  const handler=router({'GET /api/events/:id':[async()=>{calls++;return json({ok:true});}]});
  for(const id of ['%ZZ','%2f','%2Fsecret','%00','']){
    const result=await handler({method:'GET',path:'/api/events/'+id,query:{}});
    assert.equal(result.status,400,id);
  }
  assert.equal(calls,0);
});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
