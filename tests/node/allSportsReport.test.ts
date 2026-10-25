import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const folder = await mkdtemp(join(tmpdir(), 'daily-scan-'));
await mkdir(join(folder, 'backend'));
await mkdir(join(folder, 'shared'));
const original = await readFile(new URL('../../apps/edgeboard/backend/allSportsReport.ts', import.meta.url), 'utf8');
await writeFile(join(folder, 'backend/allSportsReport.ts'), original
  .replace("from './assistantReport'", "from './assistantReport.ts'")
  .replace("from '../shared/dailyScanStatus'", "from '../shared/dailyScanStatus.ts'"));
await writeFile(join(folder, 'shared/dailyScanStatus.ts'), await readFile(new URL('../../apps/edgeboard/shared/dailyScanStatus.ts', import.meta.url)));
await writeFile(join(folder, 'backend/assistantReport.ts'), `
export let fixture = (sport) => { throw Error(sport); };
export function setFixture(next) { fixture = next; }
export function dayWindow() { return {date:'2099-10-25',timezone:'UTC'}; }
export async function buildAssistantReport({sport}) { return fixture(sport); }
`);
const stub = await import(pathToFileURL(join(folder, 'backend/assistantReport.ts')).href);
const { scanAllSports } = await import(pathToFileURL(join(folder, 'backend/allSportsReport.ts')).href);

function report(statuses: string[], withPrice = false) {
  return {
    decision:'NO_QUALIFYING_OPPORTUNITIES',
    sourceHealth:statuses.map((status, index) => ({source:`fixture-${index}`,status,retrievedAt:null})),
    model:{status:'RESEARCH_ONLY',liveApproved:false},
    decisionReasons:['Fixture: independent model is not approved.'],
    scope:{gameEvents:withPrice ? 1 : 0,gameQuotes:withPrice ? 1 : 0,propMarketSidesScreened:0},
    qualifyingOpportunities:[],
    propPriceSamples:[],
    gamePrices:withPrice ? [{event:'Synthetic QA game',startTime:'2099-10-25T20:00:00Z',market:'moneyline',selection:'Home',line:null,sportsbook:'Fixture book',americanOdds:150,retrievedAt:null}] : [],
  };
}

test('aggregate exposes ordinary feed failures and keeps legacy approval status', async () => {
  stub.setFixture(() => report(['UNAVAILABLE','UNAVAILABLE']));
  const result = await scanAllSports();
  assert.equal(result.status,'NO_APPROVED_LIVE_MODEL');
  assert.equal(result.dataStatus,'SOURCE_UNAVAILABLE');
  assert.equal(result.sports.length,8);
  assert.ok(result.sports.every(row => row.dataStatus === 'SOURCE_UNAVAILABLE'));
  assert.equal(result.sports.flatMap(row => row.sourceHealth).length,16);
  assert.deepEqual(result.qualifyingOpportunities,[]);
  assert.equal(result.wagersPlaced,0);
});
test('partial feed failure retains real report observations and model blockers', async () => {
  stub.setFixture(sport => report(sport === 'baseball_mlb' ? ['RETRIEVED','UNAVAILABLE'] : ['RETRIEVED'], sport === 'baseball_mlb'));
  const result = await scanAllSports();
  assert.equal(result.dataStatus,'RESEARCH_ONLY');
  assert.equal(result.reviewQueue.length,1);
  assert.equal(result.reviewQueue[0].estimatedEv,null);
  assert.equal(result.reviewQueue[0].accountVerified,false);
  const mlb = result.sports.find(row => row.sport === 'baseball_mlb');
  assert.equal(mlb.model.liveApproved,false);
  assert.deepEqual(mlb.decisionReasons,['Fixture: independent model is not approved.']);
  assert.equal(result.sports.find(row => row.sport === 'basketball_nba').dataStatus,'NO_UPCOMING_PRICES');
});
test('rejected sport scan is distinct from fulfilled empty report', async () => {
  stub.setFixture(sport => {
    if (sport === 'tennis') throw Error('Synthetic source failure');
    return report(['RETRIEVED']);
  });
  const result = await scanAllSports();
  assert.equal(result.sports.find(row => row.sport === 'tennis').status,'UNAVAILABLE');
  assert.equal(result.sports.find(row => row.sport === 'tennis').model.status,'NOT_EVALUATED');
  assert.equal(result.dataStatus,'NO_UPCOMING_PRICES');
});
after(async () => { await rm(folder, {recursive:true,force:true}); });
