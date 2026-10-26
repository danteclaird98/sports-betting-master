import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function deferred<T>() {
  let resolve!:(value:T)=>void;
  let reject!:(error:Error)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const reply=(data:unknown)=>({ok:true,json:async()=>data});

test('older reloads cannot replace an import receipt summary or error state', async()=>{
  const elements=new Map<string,any>();
  for(const id of ['provider-import-form','observation-format','observation-payload','observation-feedback','observation-receipt','observation-summary','reload-provider-imports']) {
    elements.set('#'+id,{value:'',textContent:'',disabled:false,listeners:new Map(),
      addEventListener(event:string,listener:Function){this.listeners.set(event,listener);}});
  }
  const form=elements.get('#provider-import-form');
  const format=elements.get('#observation-format');format.value='normalized';
  const draft=elements.get('#observation-payload');draft.value='[{"provider":"synthetic"}]';
  form.elements=[format,draft];
  const requests:Array<{options:any;pending:ReturnType<typeof deferred<any>>}>=[];
  const context=vm.createContext({
    document:{querySelector:(id:string)=>elements.get(id)},
    crypto:{randomUUID:()=> 'ui-import-request'},
    fetch:(_path:string,options:any)=>{const pending=deferred<any>();requests.push({options,pending});return pending.promise;},
  });
  vm.runInContext(await readFile('web/provider-imports.js','utf8'),context);
  const reload=elements.get('#reload-provider-imports').listeners.get('click');
  reload();
  const save=form.listeners.get('submit')({preventDefault(){}});
  assert.equal(requests.length,2);
  requests[1].pending.resolve(reply({imported:1,verification:'UNVERIFIED'}));
  await tick();
  assert.equal(requests.length,3);
  requests[2].pending.resolve(reply({observation_count:1}));
  await save;
  requests[0].pending.resolve(reply({observation_count:0}));
  await tick();
  assert.equal(JSON.parse(elements.get('#observation-summary').textContent).observation_count,1);
  assert.match(elements.get('#observation-feedback').textContent,/Saved as unverified/);
  reload();reload();
  requests[4].pending.resolve(reply({observation_count:2}));
  await tick();
  requests[3].pending.reject(new Error('Obsolete reload failure'));
  await tick();
  assert.equal(JSON.parse(elements.get('#observation-summary').textContent).observation_count,2);
  assert.doesNotMatch(elements.get('#observation-feedback').textContent,/Obsolete/);
});
