import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
const initial = Date.parse('2026-10-25T12:00:00Z');
const iso = (offset: number) => new Date(initial + offset).toISOString();
const quote = (changes = {}) => ({
  eligible:true, demo:false, bookmaker:'Fixture book', decimal_price:2.1,
  league:'Fixture league', event:'Synthetic event', selection:'Home', market:'moneyline',
  line:null, period:'full_game', rules:'fixture-v1', movement:null,
  updated_at:iso(0), retrieved_at:iso(0), starts_at:iso(600_000), ...changes,
});
class Element {
  textContent = '';
  className = '';
  value = '';
  children: Element[] = [];
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
}
function setup(rows = [quote()]) {
  let now = initial;
  let fetches = 0;
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const listeners: Record<string, () => void> = {};
  const intervals = new Map<number, () => void>();
  let nextInterval = 0;
  class Clock extends Date { static now() { return now; } }
  const document = {
    visibilityState:'visible', querySelector:node, querySelectorAll:() => [],
    createElement:() => new Element(),
    addEventListener:(name: string, fn: () => void) => { listeners[name] = fn; },
  };
  const context = createContext({
    document, window:{addEventListener:(name: string, fn: () => void) => { listeners[name] = fn; }},
    Date:Clock, Intl, console,
    fetch:() => { fetches++; return new Promise(() => {}); },
    setInterval:(fn: () => void) => { const id = ++nextInterval; intervals.set(id, fn); return id; },
    clearInterval:(id: number) => intervals.delete(id),
  });
  runInContext(source, context);
  runInContext(`state = ${JSON.stringify({markets: rows.length ? [{quotes:rows,best_book:'Fixture book',best_price:2.1}] : []})}; renderBoard();`, context);
  function all(root = node('#quote-list')): Element[] { return [root, ...root.children.flatMap(child => all(child))]; }
  return {
    setNow:(value: number) => { now = value; },
    tick:() => { for (const fn of intervals.values()) fn(); },
    focus:() => listeners.focus(),
    visibility:(value: string) => { document.visibilityState = value; listeners.visibilitychange(); },
    intervalCount:() => intervals.size, fetchCount:() => fetches,
    best:() => all().filter(n => n.className === 'best').length,
    text:() => all().map(n => n.textContent).join('\n'),
  };
}

test('cached BEST and FRESH claims expire after 120 seconds without fetching', () => {
  const board = setup();
  const fetches = board.fetchCount();
  assert.equal(board.best(), 1);
  board.setNow(initial + 120_000); board.tick();
  assert.equal(board.best(), 1);
  board.setNow(initial + 120_001); board.tick();
  assert.equal(board.best(), 0);
  assert.doesNotMatch(board.text(), /FRESH QUOTES| · BEST/);
  assert.match(board.text(), /REVIEW REQUIRED/);
  assert.match(board.text(), /Fixture book/);
  assert.equal(board.fetchCount(), fetches);
});

test('kickoff removes cached claims at the exact start boundary', () => {
  const board = setup([quote({starts_at:iso(10_000)})]);
  board.setNow(initial + 9_999); board.tick(); assert.equal(board.best(), 1);
  board.setNow(initial + 10_000); board.tick(); assert.equal(board.best(), 0);
});

test('hidden tabs stop the timer and visibility or focus catches elapsed time without requests', () => {
  const board = setup(); const fetches = board.fetchCount();
  assert.equal(board.intervalCount(), 1);
  board.visibility('hidden'); assert.equal(board.intervalCount(), 0);
  board.setNow(initial + 120_001); board.tick(); assert.equal(board.best(), 1);
  board.visibility('visible'); assert.equal(board.best(), 0);
  assert.equal(board.intervalCount(), 1);
  board.focus(); board.focus(); assert.equal(board.intervalCount(), 1);
  assert.equal(board.fetchCount(), fetches);
  const focused = setup([quote({starts_at:iso(10_000)})]);
  focused.setNow(initial + 10_000); focused.focus(); assert.equal(focused.best(), 0);
});

test('invalid, future and timezone-free timestamps and server-rejected evidence never qualify', () => {
  for (const changes of [
    {eligible:false}, {eligible:'true'}, {demo:true}, {updated_at:null},
    {updated_at:'invalid'}, {updated_at:'2026-10-25T12:00:00'},
    {updated_at:iso(1)}, {retrieved_at:iso(1)}, {retrieved_at:null},
    {starts_at:'invalid'}, {starts_at:null}, {starts_at:iso(0)},
    {retrieved_at:iso(-1)},
  ]) {
    const board = setup([quote(changes)]);
    assert.equal(board.best(), 0, JSON.stringify(changes));
    assert.doesNotMatch(board.text(), /FRESH QUOTES| · BEST/);
  }
});

test('invalid or backward client clocks fail closed rather than revive a cached claim', () => {
  const board = setup(); board.setNow(NaN); board.tick(); assert.equal(board.best(), 0);
  board.setNow(initial - 1); board.tick(); assert.equal(board.best(), 0);
  board.setNow(initial + 120_001); board.tick(); assert.equal(board.best(), 0);
  board.setNow(initial); board.tick(); assert.equal(board.best(), 0);
});

test('empty board retains its import guidance through clock and visibility updates', () => {
  const board = setup([]);
  board.setNow(initial + 300_000); board.tick(); board.visibility('hidden'); board.visibility('visible');
  assert.match(board.text(), /Your market board starts here/);
  assert.match(board.text(), /Import timestamped sportsbook quotes/);
  assert.equal(board.best(), 0);
});

test('expiry does not promote another row or revive a server-rejected quote', () => {
  const board = setup([
    quote({updated_at:iso(-110_000),retrieved_at:iso(-110_000)}),
    quote({bookmaker:'Other fixture book',decimal_price:2.0}),
    quote({eligible:false,decimal_price:2.1}),
  ]);
  assert.equal(board.best(), 1);
  board.setNow(initial + 10_001); board.tick();
  assert.equal(board.best(), 0);
  assert.doesNotMatch(board.text(), /FRESH QUOTES| · BEST/);
  assert.match(board.text(), /Other fixture book/);
});
