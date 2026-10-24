// Minimal DOM harness: tests entry logic, NOT browser layout or rendering.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.dataset={};this.hidden=false;this.textContent='';this.classList={toggle(){}};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  querySelectorAll(selector){let all=[];for(let c of this.children){if(selector==='[data-key]'&&c.dataset.key)all.push(c);all.push(...c.querySelectorAll(selector));}return all;}
}
const nodes={};const document={getElementById(id){return nodes[id]??=new Element();},createElement(tag){return new Element(tag);},querySelectorAll(){return [];}};
const context=vm.createContext({document,crypto:require('node:crypto').webcrypto,Intl,Date,JSON,console,fetch:async()=>({ok:true,json:async()=>[]})});
document.getElementById('editorMode').value='fields';document.getElementById('zone').value='UTC';
vm.runInContext(fs.readFileSync(__dirname+'/../web/ui.js','utf8'),context);
vm.runInContext("$('recordType').value='wager';setEditor(wager())",context);
let inputs=nodes.fields.querySelectorAll('[data-key]');
assert.ok(inputs.some(x=>x.dataset.key==='stake'));
inputs.find(x=>x.dataset.key==='stake').value='12.50';
inputs.find(x=>x.dataset.key==='event').value='<script>not executed</script>';
let w=JSON.parse(vm.runInContext('JSON.stringify(readEditor())',context));
assert.equal(w.stake,12.5);assert.equal(w.event,'<script>not executed</script>');assert.equal(w.mode,'paper');assert.equal(w.line,null);
nodes.editorMode.value='json';nodes.editorMode.onchange();
assert.equal(JSON.parse(nodes.json.value).stake,12.5);assert.equal(nodes.fields.hidden,true);
nodes.editorMode.value='fields';nodes.editorMode.onchange();
assert.equal(nodes.json.hidden,true);
nodes.recordType.value='settlement';nodes.recordType.onchange();
inputs=nodes.fields.querySelectorAll('[data-key]');inputs.find(x=>x.dataset.key==='provisional').checked=false;
let s=JSON.parse(vm.runInContext('JSON.stringify(readEditor())',context));assert.equal(s.provisional,false);assert.equal(s.revision,1);
nodes.recordType.value='state';nodes.recordType.onchange();
assert.equal(JSON.parse(vm.runInContext('JSON.stringify(readEditor())',context)).mode,'manual');
nodes.logout.onclick();assert.equal(nodes.fields.children.length,0);assert.equal(nodes.json.value,'');
console.log('PASS entry fields, JSON round-trip, provisional checkbox, live-state mode, and sign-out clearing. Minimal DOM logic only; not browser verified.');
