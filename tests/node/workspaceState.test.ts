import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Execute the real browser script against deterministic DOM and HTTP doubles.
const source = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
class Element {
  tagName: string; children: Element[] = []; value = ''; disabled = false; className = '';
  textContent = ''; hidden = false; onclick: any; onchange: any; onsubmit: any; oninput: any;
  classList = {toggle() {}};
  constructor(tag = 'div') { this.tagName = tag; }
  append(...children: Element[]) { this.children.push(...children); }
  add(child: Element) { this.children.push(child); }
  replaceChildren(...children: Element[]) { this.children = children; }
  reset() {}
  addEventListener() {}
}
const response = (data: any) => ({ok:true,json:async () => data});
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = (n: number) => ({
  provider_status:'Imported quote snapshots; live verification not established', markets:[], movements:[],
  wagers:[{id:1,event:'Synthetic game',selection:'Home',bookmaker:'Fixture',stake:10,decimal_price:2,result:'pending'}],
  summary:{markets:n,snapshots:n,profit:n,roi:null},
});
function setup({initialFails = false, provider = 'success', configured = true, refreshFailure = 'network', mutationFails = false} = {}) {
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  // Seed relevant defaults from the actual page, rather than inventing an enabled button.
  for (const id of ['status','markets','snapshots','profit','roi','provider-status']) {
    const match = markup.match(new RegExp(`<[^>]*id="${id}"[^>]*>([^<]*)<`));
    if (match) node('#'+id).textContent = match[1];
  }
  node('#sync-provider').disabled = /<button\b[^>]*id="sync-provider"[^>]*\bdisabled\b/.test(markup);
  node('#american').value = '-110'; node('#sync-league').value = 'NBA'; node('#import-format').value = 'normalized';
  const calls: {path: string; method: string}[] = []; let stateCount = 0; let failRefresh = refreshFailure;
  const fail = () => {
    if (failRefresh === 'malformed') return Promise.resolve(response({...fixture(99), markets:[{quotes:[]}]}));
    if (failRefresh === 'http') return Promise.resolve({ok:false,json:async () => ({error:'Read unavailable'})});
    if (failRefresh === 'json') return Promise.resolve({ok:true,json:async () => {throw new SyntaxError('Invalid JSON');}});
    return Promise.reject(new Error('Offline'));
  };
  const context = createContext({
    document:{querySelector:node,querySelectorAll:() => [],createElement:(tag: string) => new Element(tag),addEventListener(){},visibilityState:'visible'},
    window:{addEventListener(){}}, Option:function(this: any, text: string, value: string) { const n = new Element('option'); n.textContent = text; n.value = value; return n; },
    FormData:function() {return Object.entries({event:'Synthetic new game',selection:'Home',bookmaker:'Fixture',stake:'10',decimal_price:'2'});},
    setInterval:() => 1,clearInterval(){},setTimeout(){},clearTimeout(){},
    fetch:(path: string, options: any = {}) => {
      calls.push({path,method:options.method || 'GET'});
      if (path === '/api/providers') {
        if (provider === 'pending') return new Promise(() => {});
        if (provider === 'failure') return Promise.reject(new Error('Config unavailable'));
        return Promise.resolve(response({providers:[{name:'SportsGameOdds',credential_configured:configured}]}));
      }
      if (path === '/api/state') {
        stateCount++;
        if ((stateCount === 1 && !initialFails) || (stateCount > 1 && failRefresh === 'success')) return Promise.resolve(response(fixture(stateCount)));
        return fail();
      }
      if (path === '/example.json') return Promise.resolve(response([]));
      if (options.method === 'POST' && ['/api/settle','/api/wagers','/api/import','/api/import-provider','/api/sync-provider'].includes(path))
        return Promise.resolve(mutationFails ? {ok:false,json:async () => ({error:'Write refused'})} : response({imported:2,skipped:0,warnings:[]}));
      throw new Error('Unexpected mock fetch path '+path);
    },
  });
  runInContext(source, context, {filename:'web/app.js'});
  const all = (root: Element): Element[] => [root,...root.children.flatMap(all)];
  return {node,context,calls,stateCount:() => stateCount, all, refreshSucceeds:() => {failRefresh='success';}};
}
const actions: Record<string, (h: ReturnType<typeof setup>) => Promise<any>> = {
  settlement:h => h.all(h.node('#wagers')).find(n => n.tagName === 'button')!.onclick(),
  wager:h => h.node('#wager-form').onsubmit({preventDefault(){},target:h.node('#wager-form')}),
  normalizedImport:h => h.node('#import').onchange({target:{files:[{size:2,text:async () => '[]'}],value:'file'}}),
  providerImport:h => {h.node('#import-format').value='sportsgameodds';return h.node('#import').onchange({target:{files:[{size:2,text:async () => '[]'}],value:'file'}});},
  sampleImport:h => h.node('#demo').onclick(),
  providerSync:h => h.node('#sync-provider').onclick(),
};
const feedback = (h: ReturnType<typeof setup>) => `${h.node('#message').textContent} ${h.node('#status').textContent} ${h.node('#workspace-health').textContent}`;

test('confirmed writes with a failed refresh retain stale data and offer a read-only retry', async () => {
  for (const [action,invoke] of Object.entries(actions)) for (const failure of ['network','http','json','malformed']) {
    const h = setup({refreshFailure:failure}); await tick();
    const oldProfit = h.node('#profit').textContent, oldWagers = h.all(h.node('#wagers')).map(n => n.textContent);
    await invoke(h);
    assert.equal(h.node('#profit').textContent,oldProfit,`${action}/${failure}`);
    assert.deepEqual(h.all(h.node('#wagers')).map(n => n.textContent),oldWagers,`${action}/${failure}`);
    assert.match(h.node('#workspace-health').textContent,/stale|out.of.date|not (?:be )?current/i,`${action}/${failure}`);
    assert.match(h.node('#workspace-health').textContent,/refresh.*retry|retry.*refresh/i,`${action}/${failure}`);
    assert.match(feedback(h),/recorded|saved|imported|successful|confirmed/i,`${action}/${failure}`);
    const writesBefore = h.calls.filter(c => c.method === 'POST').length;
    assert.equal(writesBefore,1,`${action}/${failure}`);
    h.refreshSucceeds(); await h.node('#refresh').onclick();
    assert.equal(h.calls.filter(c => c.method === 'POST').length,writesBefore,`${action}/${failure} retry must not repeat write`);
    assert.equal(h.stateCount(),3,`${action}/${failure}`);
    assert.equal(h.node('#profit').textContent,'$3.00',`${action}/${failure}`);
    assert.doesNotMatch(feedback(h),/stale|out.of.date|not (?:be )?current/i,`${action}/${failure}`);
  }
});

test('successful refresh follows write; rejected write does not trigger refresh', async () => {
  const good = setup({refreshFailure:'success'}); await tick(); await actions.wager(good);
  assert.equal(good.node('#profit').textContent,'$2.00');
  assert.doesNotMatch(feedback(good),/stale|out.of.date|not (?:be )?current/i);
  const rejected = setup({mutationFails:true}); await tick(); await actions.wager(rejected);
  assert.equal(rejected.stateCount(),1); assert.match(rejected.node('#message').textContent,/Write refused/);
  assert.equal(rejected.node('#message').className,'error');
});

test('initial read failure is unavailable, not a loaded empty workspace', async () => {
  const h = setup({initialFails:true}); await tick();
  assert.match(feedback(h),/unavailable|unable to load|could not load|failed to load/i);
  assert.doesNotMatch(h.node('#status').textContent,/Loading workspace/i);
  assert.notEqual(h.node('#markets').textContent,'0');
  assert.notEqual(h.node('#profit').textContent,'$0.00');
  h.refreshSucceeds(); await h.node('#refresh').onclick();
  assert.equal(h.node('#profit').textContent,'$2.00');
});

test('provider fetch is disabled while status is pending or fails, and enabled only with configured credential', async () => {
  const pending = setup({provider:'pending'}); await tick(); assert.equal(pending.node('#sync-provider').disabled,true);
  const failed = setup({provider:'failure'}); await tick(); assert.equal(failed.node('#sync-provider').disabled,true);
  const missing = setup({configured:false}); await tick(); assert.equal(missing.node('#sync-provider').disabled,true);
  const truthy = setup({configured:'true' as any}); await tick(); assert.equal(truthy.node('#sync-provider').disabled,true);
  const good = setup({configured:true}); await tick(); assert.equal(good.node('#sync-provider').disabled,false);
});

test('older overlapping refreshes cannot overwrite the latest outcome', async () => {
  const h = setup(); await tick();
  const pending: {resolve: (value: any) => void; reject: (error: Error) => void}[] = [];
  h.context.fetch = () => new Promise((resolve,reject) => pending.push({resolve,reject}));
  const older = h.node('#refresh').onclick();
  const newer = h.node('#refresh').onclick();
  pending[1].resolve(response(fixture(8))); await newer;
  pending[0].reject(new Error('Offline')); await older;
  assert.equal(h.node('#profit').textContent,'$8.00');
  assert.equal(h.node('#workspace-health').textContent,'');

  const oldSuccess = h.node('#refresh').onclick();
  const newFailure = h.node('#refresh').onclick();
  pending[3].reject(new Error('Offline')); await newFailure;
  pending[2].resolve(response(fixture(9))); await oldSuccess;
  assert.equal(h.node('#profit').textContent,'$8.00');
  assert.match(h.node('#workspace-health').textContent,/stale/i);
});
