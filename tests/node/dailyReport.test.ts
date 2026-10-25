import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDailyReport, dailyReportView } from '../../apps/edgeboard/shared/dailyReport.ts';

const time = Date.parse('2026-10-25T12:00:00Z');
const fixture = () => ({
  generatedAt:new Date(time).toISOString(),
  requested:{date:'2026-10-25',timezone:'UTC'},
  status:'NO_APPROVED_LIVE_MODEL', caution:'Synthetic research fixture', paidProviderRequests:0,
  sports:[{sport:'baseball_mlb',name:'MLB',status:'NO_QUALIFYING_OPPORTUNITIES',eventCount:1,gamePrices:1,propSides:0,qualifyingCount:0,
    sourceHealth:[{source:'Fixture feed',status:'RETRIEVED',retrievedAt:new Date(time-10_000).toISOString()}],
    model:{status:'RESEARCH_ONLY',liveApproved:false},decisionReasons:['Not approved.']}],
  reviewQueue:[{sport:'baseball_mlb',sportName:'MLB',event:'Synthetic game',startTime:new Date(time+30_000).toISOString(),type:'game',player:null,market:'moneyline',selection:'Home',line:null,
    source:'Fixture feed',americanOdds:150,publicDecimalPrice:null,retrievedAt:new Date(time-10_000).toISOString(),offeredOddsTimestampVerified:false,accountVerified:false,estimatedEv:null,researchStatus:'WATCH_ONLY',reason:'Research only.'}],
  qualifyingOpportunities:[],
});

test('complete report retains source timestamps and does not imply quote freshness', () => {
  const report = parseDailyReport(fixture());
  assert.equal(report.reviewQueue[0].offeredOddsTimestampVerified,false);
  assert.equal(report.sports[0].model?.liveApproved,false);
  assert.notEqual(report.reviewQueue[0].retrievedAt,report.generatedAt);
});
test('malformed HTTP-success bodies are rejected before rendering', () => {
  for (const value of [null,{},[],{...fixture(),sports:{}},{...fixture(),sports:[null]},
    {...fixture(),reviewQueue:[null]},{...fixture(),qualifyingOpportunities:undefined},
    {...fixture(),sports:[{...fixture().sports[0],sourceHealth:[{source:'Fixture',status:42}]}]},
    {...fixture(),sports:[{...fixture().sports[0],decisionReasons:[null]}]},
    {...fixture(),reviewQueue:[{...fixture().reviewQueue[0],publicDecimalPrice:NaN}]},
    {...fixture(),reviewQueue:[{...fixture().reviewQueue[0],market:null}]}]) {
    assert.throws(() => parseDailyReport(value),/invalid report/);
  }
});
test('invalid clocks, odds and observed counts never reach formatting operations', () => {
  for (const value of [
    {...fixture(),generatedAt:'yesterday'},
    {...fixture(),refreshAfter:'invalid'},
    {...fixture(),refreshAfter:new Date(time).toISOString()},
    {...fixture(),sports:[{...fixture().sports[0],gamePrices:-1}]},
    {...fixture(),reviewQueue:[{...fixture().reviewQueue[0],americanOdds:0}]},
  ]) assert.throws(() => parseDailyReport(value),/invalid report/);
});
test('upcoming observation disappears at kickoff without a network refresh', () => {
  const report = parseDailyReport(fixture());
  assert.equal(dailyReportView(report,'all',time+29_999).prices.length,1);
  const started = dailyReportView(report,'all',time+30_000);
  assert.equal(started.expired,false);
  assert.equal(started.prices.length,0);
});
test('display expires at 60 seconds and clears candidate claims', () => {
  const report = parseDailyReport({...fixture(),qualifyingOpportunities:[{sport:'baseball_mlb'}]});
  assert.equal(dailyReportView(report,'all',time+59_999).candidateCount,1);
  const expired = dailyReportView(report,'all',time+60_000);
  assert.equal(expired.expired,true);
  assert.equal(expired.prices.length,0);
  assert.equal(expired.candidateCount,0);
});
test('server can shorten but cannot silently extend the display lifetime', () => {
  const shorter = parseDailyReport({...fixture(),refreshAfter:new Date(time+15_000).toISOString()});
  assert.equal(dailyReportView(shorter,'all',time+15_000).expired,true);
  const longer = parseDailyReport({...fixture(),refreshAfter:new Date(time+600_000).toISOString()});
  assert.equal(dailyReportView(longer,'all',time+60_000).expired,true);
});
test('filter and invalid client clocks cannot revive observations', () => {
  const report = parseDailyReport(fixture());
  assert.equal(dailyReportView(report,'basketball_nba',time).prices.length,0);
  assert.equal(dailyReportView(report,'all',NaN).expired,true);
  assert.equal(dailyReportView(report,'all',time-60_000).expired,true);
});
