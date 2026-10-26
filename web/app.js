const $=s=>document.querySelector(s);
let state;
const money=x=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(x);
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function message(text,error=false){$('#message').textContent=text;$('#message').className=error?'error':'success';}
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data;}
async function load(){try{state=await api('/api/state');$('#status').textContent=state.provider_status;for(const k of ['markets','snapshots'])$('#'+k).textContent=state.summary[k];$('#profit').textContent=money(state.summary.profit);$('#roi').textContent=state.summary.roi===null?'—':(state.summary.roi*100).toFixed(1)+'%';const current=$('#league').value;$('#league').replaceChildren(new Option('All leagues',''));[...new Set(state.markets.flatMap(m=>m.quotes.map(q=>q.league)))].sort().forEach(l=>$('#league').add(new Option(l,l)));$('#league').value=current;renderBoard();renderWagers();renderMovements();}catch(e){message(e.message,true);}}
// Recheck cached evidence locally; this clock never requests provider data.
function boardQuoteEligible(row, now) {
  const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? Date.parse(value) : NaN;
  const updated = timestamp(row.updated_at);
  const retrieved = timestamp(row.retrieved_at);
  const starts = timestamp(row.starts_at);
  return row.eligible === true && !row.demo && Number.isFinite(now) &&
    Number.isFinite(updated) && Number.isFinite(retrieved) && Number.isFinite(starts) &&
    updated <= now && retrieved <= now && updated <= retrieved &&
    now - updated <= 120_000 && starts > now;
}
let boardClockHighWater = -Infinity;
function renderBoard(){
  if (!state) return;
  const observedNow = Date.now();
  const now = observedNow >= boardClockHighWater ? observedNow : NaN;
  if (Number.isFinite(observedNow)) boardClockHighWater = Math.max(boardClockHighWater, observedNow);
  const box=$('#quote-list');box.replaceChildren();
  const rows=state.markets.filter(m=>!$('#league').value||m.quotes[0].league===$('#league').value);
  if(!rows.length){const p=el('div',undefined,'panel empty');p.append(el('div','◎','empty-icon'),el('h3','Your market board starts here'),el('p','Import timestamped sportsbook quotes from Data sources, or load sample data to explore.','muted'));box.append(p);return;}
  for(const m of rows){
    const q=m.quotes[0],card=el('article',undefined,'panel');
    // Only retain the server's selected price while that evidence still qualifies.
    const isBest = row => boardQuoteEligible(row, now) && row.bookmaker===m.best_book && row.decimal_price===m.best_price;
    const hasBest = m.quotes.some(isBest);
    const head=el('div',undefined,'section-head');const title=el('div');
    title.append(el('span',q.league,'eyebrow'),el('h3',q.event),el('p',`${q.selection}${q.line==null?'':' '+q.line} · ${q.market} · ${q.period}`,'muted'));
    head.append(title,el('span',q.demo?'DEMO':hasBest?'FRESH QUOTES':'REVIEW REQUIRED','badge'));card.append(head);
    const table=el('table');const tr=el('tr');
    ['Sportsbook','Decimal price','Raw implied','Price move','Source updated'].forEach(s=>tr.append(el('th',s)));
    const thead=el('thead');thead.append(tr);table.append(thead);const tbody=el('tbody');
    for(const r of m.quotes){
      const tr=el('tr');const best=isBest(r);
      [r.bookmaker+(best?' · BEST':''),Number(r.decimal_price).toFixed(3),(100/r.decimal_price).toFixed(1)+'%',r.movement==null?'—':(100*r.movement).toFixed(1)+'%',r.updated_at?new Date(r.updated_at).toLocaleString():'Unavailable'].forEach(s=>tr.append(el('td',s)));
      if(best)tr.className='best';tbody.append(tr);
    }
    table.append(tbody);const wrap=el('div',undefined,'table-wrap');wrap.append(table);
    card.append(wrap,el('p',`Rules: ${q.rules} · ${q.demo?'Sample data; excluded from best-price selection.':hasBest?'Best available imported price; source authenticity is not verified.':'No eligible price: check freshness, status, rules and event start.'}`,'muted'));box.append(card);
  }
}
let boardTimer;
function resumeBoardClock() {
  if (boardTimer !== undefined) clearInterval(boardTimer);
  boardTimer = undefined;
  if (document.visibilityState === 'hidden') return;
  renderBoard();
  boardTimer = setInterval(renderBoard, 1_000);
}
document.addEventListener('visibilitychange', resumeBoardClock);
window.addEventListener('focus', resumeBoardClock);
resumeBoardClock();

function renderWagers(){const box=$('#wagers');box.replaceChildren();if(!state.wagers.length)box.append(el('p','No wagers recorded yet.','panel empty'));for(const w of state.wagers){const card=el('div',undefined,'panel wager');const info=el('div');info.append(el('h3',w.event),el('p',`${w.selection} · ${w.bookmaker} · ${money(w.stake)} @ ${w.decimal_price}`));card.append(info,el('span',w.result.toUpperCase(),'badge'));if(w.result==='pending')for(const result of ['win','loss','void']){const b=el('button',result);b.onclick=async()=>{try{await api('/api/settle',{id:w.id,result});await load();message('Settlement recorded.');}catch(e){message(e.message,true);}};card.append(b);}box.append(card);}}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(t=>t.hidden=t.id!==b.dataset.tab);document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#title').textContent=b.textContent.trim().replace(/^[^a-zA-Z]+/,'');});
$('#refresh').onclick=load;$('#league').onchange=renderBoard;
$('#wager-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/wagers',Object.fromEntries(new FormData(e.target)));e.target.reset();await load();message('Wager recorded.');}catch(e){message(e.message,true);}};
async function ingest(rows){const r=await api('/api/import',rows);await load();message(`${r.imported} snapshots imported.`);}
$('#import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>4000000)throw Error('File exceeds 4 MB');const payload=JSON.parse(await file.text());const format=$('#import-format').value;if(format==='normalized')await ingest(payload);else{const result=await api('/api/import-provider',{format,payload});await load();message(`${result.imported} snapshots imported; ${result.skipped} unsupported entries skipped. ${result.warnings.join('; ')}`);}}catch(e){message(e.message,true);}finally{e.target.value='';}};
$('#demo').onclick=async()=>{try{await ingest(await (await fetch('/example.json')).json());}catch(e){message(e.message,true);}};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='sports-betting-master-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function convert(){const n=Number($('#american').value);$('#conversion').textContent=!Number.isFinite(n)||Math.abs(n)<100?'Enter American odds of +100 or greater, or −100 or less.':`Decimal ${(n>0?1+n/100:1+100/-n).toFixed(3)} · Raw implied ${(100/(n>0?1+n/100:1+100/-n)).toFixed(2)}%`;}
$('#american').oninput=convert;convert();load();

function renderMovements(){const target=$('#movements');target.replaceChildren();if(!state.movements?.length)target.append(el('p','No significant source movements recorded.','muted'));for(const m of (state.movements||[]).slice(0,10))target.append(el('p',`${m.event} · ${m.selection} · ${m.bookmaker} · line ${m.previous_line??'—'} → ${m.current_line??'—'} · American price Δ ${m.american_price_change} · ${m.observed_at}`,'muted'));}
async function providerStatus(){try{const status=await api('/api/providers');const provider=status.providers.find(p=>p.name==='SportsGameOdds');$('#provider-status').textContent=provider.credential_configured?'Server credential configured; live access has not been verified.':'Set SPORTSGAMEODDS_KEY in the hosting environment to connect. Your key stays on the server.';$('#sync-provider').disabled=!provider.credential_configured;}catch(e){$('#provider-status').textContent=e.message;}}
$('#sync-provider').onclick=async()=>{const b=$('#sync-provider');b.disabled=true;try{const result=await api('/api/sync-provider',{league:$('#sync-league').value});await load();message(`${result.imported} snapshots imported; ${result.skipped} unsupported entries skipped.`);}catch(e){message(e.message,true);}finally{b.disabled=false;}};
const localConvert=convert;
let conversionTimer;
$('#american').oninput=()=>{localConvert();clearTimeout(conversionTimer);conversionTimer=setTimeout(async()=>{const n=Number($('#american').value);if(!Number.isFinite(n)||Math.abs(n)<100)return;try{const r=await fetch('/tools/odds?american='+encodeURIComponent(n));if(!r.ok)return;const v=await r.json();if(Number($('#american').value)!==n)return;$('#conversion').textContent=`Decimal ${v.decimal.toFixed(3)} · Raw implied ${(100*v.implied).toFixed(2)}% · AlexBET`;}catch{}},200);};
providerStatus();
