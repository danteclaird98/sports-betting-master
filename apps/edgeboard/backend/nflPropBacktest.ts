import { csvRows } from './historicalNfl.ts';
import { parseHistoricalValue, validateHistoricalRows } from './historicalStatPolicy.ts';
import { fitPlattCalibration, applyPlattCalibration, reliabilitySummary } from './nflPropCalibration.ts';

type StatRow = { id: string; season: number; week: number; value: number; game: string };
type Obs = { season: number; week: number; x: number[]; y: number; game: string };
const markets: Record<string, { threshold: number; positions: string[] }> = {
  receiving_yards: { threshold: 60, positions: ['WR', 'TE', 'RB'] },
  rushing_yards: { threshold: 50, positions: ['RB', 'QB', 'WR'] },
  passing_yards: { threshold: 200, positions: ['QB'] },
  receptions: { threshold: 4, positions: ['WR', 'TE', 'RB'] },
};
const seasons = [2021, 2022, 2023, 2024, 2025];
const asset = (year: number) => 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_' + year + '.csv';
let dataCache: Promise<{rows: Record<string, StatRow[]>; count: number; unmatchedPlayerRows: number; fetchedAt: string}> | null = null;
const resultCache = new Map<string, {at: number; report: unknown}>();
const logistic = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const score = (rows: Obs[], p: number[]) => ({
  n: rows.length,
  brier: rows.reduce((s, r, i) => s + (p[i] - r.y) ** 2, 0) / rows.length,
  logLoss: rows.reduce((s, r, i) => s - (r.y * Math.log(Math.max(1e-9, p[i])) + (1-r.y) * Math.log(Math.max(1e-9, 1-p[i]))), 0) / rows.length,
  reliability: Array.from({length: 10}, (_, b) => {
    const indices = p.map((x, i) => Math.min(9, Math.floor(x * 10)) === b ? i : -1).filter(i => i >= 0);
    return {bin: b, n: indices.length, predicted: indices.length ? indices.reduce((s, i) => s+p[i],0)/indices.length : null,
      observed: indices.length ? indices.reduce((s,i) => s+rows[i].y,0)/indices.length : null};
  }),
});
async function fetchOfficial() {
  const all: Record<string, StatRow[]> = {};
  let count = 0;
  let unmatchedPlayerRows = 0;
  await Promise.all(seasons.map(async year => {
    const url = asset(year);
    let text: string | null = null;
    let lastFailure = 'unknown';
    for (let attempt = 0; attempt < 3 && text === null; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw Error('HTTP ' + res.status);
        text = await res.text();
      } catch (err) {
        lastFailure = err instanceof Error ? err.message : 'network error';
      }
    }
    if (text === null) throw Error('Public nflverse player stats year ' + year + ' unavailable after retries: ' + lastFailure);
    if (text.length > 12000000) throw Error('Player-stats source size exceeds 12MB yearly cap.');
    const [headers, ...raw] = csvRows(text);
    const ix = (key: string) => headers.indexOf(key);
    const required = ['player_id','season','week','season_type','position','game_id','receiving_yards','rushing_yards','passing_yards','receptions'];
    const missing = required.filter(k=>ix(k)<0);
    if (missing.length) throw Error('nflverse year '+year+' missing fields: '+missing.join(', ')+'. Available identity columns: '+headers.filter(h=>/team|club|player|season|week|position|game/i.test(h)).join(', '));
    for (const row of raw) {
      if (row[ix('season_type')] !== 'REG') continue;
      const id = row[ix('player_id')], position = row[ix('position')];
      const season = Number(row[ix('season')]), week = Number(row[ix('week')]);
      if (!id || !Number.isInteger(season) || !Number.isInteger(week) || season !== year || week < 1 || week > 18) continue;
      const base = id + '|' + position;
      const game = row[ix('game_id')];
      if (!game || !game.startsWith(season+'_'+String(week).padStart(2,'0')+'_')) { unmatchedPlayerRows++; continue; }
      for (const market of Object.keys(markets)) {
        if (!markets[market].positions.includes(position)) continue;
        const value = parseHistoricalValue(market, row[ix(market)] ?? '');
        if (value === null) continue;
        (all[market] ??= []).push({ id: base, season, week, value, game });
      }
      count++;
    }
  }));
  if(!count || unmatchedPlayerRows > count / 4) throw Error('Player source game_id identity mismatch: ' + unmatchedPlayerRows + ' rows unmatched.');
  for (const rows of Object.values(all)) validateHistoricalRows(rows);
  return { rows: all, count, unmatchedPlayerRows, fetchedAt: new Date().toISOString() };
}
async function history() {
  if (!dataCache) dataCache = fetchOfficial().catch(e => { dataCache = null; throw e; });
  return dataCache;
}
export async function getHistoricalLineAwareRows(market: string) {
  if (!(market in markets)) throw Error('Unsupported historical market.');
  const data = await history();
  return { rows: data.rows[market] ?? [], fetchedAt: data.fetchedAt };
}
export function buildHistoricalObservations(raw: StatRow[], threshold: number): Obs[] {
  validateHistoricalRows(raw);
  const order = [...raw].sort((a,b) => a.season-b.season || a.week-b.week || a.id.localeCompare(b.id));
  const byPlayer = new Map<string, number[]>();
  const unique = new Set<string>();
  const out: Obs[] = [];
  for (const r of order) {
    const key = r.id + '|' + r.season + '|' + r.week;
    if (unique.has(key)) throw Error('Duplicate player-week; source must be reconciled.');
    unique.add(key);
    const prior = byPlayer.get(r.id) ?? [];
    if (prior.length >= 3) {
      const last3 = prior.slice(-3), last8 = prior.slice(-8);
      const mean = (v: number[]) => v.reduce((s,x)=>s+x,0)/v.length;
      const share = (v: number[]) => v.filter(x => x >= threshold).length / v.length;
      out.push({ season: r.season, week: r.week, game: r.game, x: [mean(last3)/Math.max(1,threshold),mean(last8)/Math.max(1,threshold),
        share(last3),share(last8),Math.min(50,prior.length)/50], y: r.value >= threshold ? 1 : 0});
    }
    prior.push(r.value);
    byPlayer.set(r.id, prior);
  }
  return out;
}
function evaluate(raw: StatRow[], threshold: number) {
  const obs = buildHistoricalObservations(raw, threshold);
  const train=obs.filter(x=>x.season<=2023), validation=obs.filter(x=>x.season===2024), test=obs.filter(x=>x.season===2025);
  const selectionValidation=validation.filter(r=>r.week<=9);
  const calibrationValidation=validation.filter(r=>r.week>=10);
  if (train.length<500 || selectionValidation.length<100 || calibrationValidation.length<100 || test.length<150) throw Error('Insufficient chronological player observations in training, selection, calibration or test splits.');
  const dim = 5;
  const means=Array.from({length:dim},(_,j)=>train.reduce((s,r)=>s+r.x[j],0)/train.length);
  const scales=means.map((mean,j)=>Math.sqrt(train.reduce((s,r)=>s+(r.x[j]-mean)**2,0)/train.length)||1);
  const standardized=(rows:Obs[])=>rows.map(r=>[1,...r.x.map((v,j)=>Math.max(-8,Math.min(8,(v-means[j])/scales[j])))]);
  const a=standardized(train), b=standardized(validation), c=standardized(test);
  const selectionFeatures=standardized(selectionValidation);
  const calibrationFeatures=standardized(calibrationValidation);
  const predict=(x:number[][],w:number[])=>x.map(v=>logistic(v.reduce((s,z,j)=>s+z*w[j],0)));
  const baseRate=(train.reduce((s,r)=>s+r.y,0)+1)/(train.length+2);
  function fit(lambda:number) {
    const w=Array(dim+1).fill(0) as number[];
    w[0]=Math.log(baseRate/(1-baseRate));
    for(let iteration=0;iteration<155;iteration++){
      const grad=w.map(()=>0);
      for(let i=0;i<a.length;i++){
        const e=logistic(a[i].reduce((s,v,j)=>s+v*w[j],0))-train[i].y;
        for(let j=0;j<grad.length;j++)grad[j]+=e*a[i][j];
      }
      for(let j=0;j<w.length;j++) w[j]-=0.17*(grad[j]/a.length+(j?lambda*w[j]:0));
    }
    return w;
  }
  const candidates=[0.001,0.01,0.1].map(lambda=>{
    const weights=fit(lambda);
    return { lambda, weights, error: score(selectionValidation,predict(selectionFeatures,weights)).logLoss };
  }).sort((x,y)=>x.error-y.error);
  const winner=candidates[0];
  const validationScores=score(validation,predict(b,winner.weights));
  const calibrationRawPredictions=predict(calibrationFeatures,winner.weights);
  const calibrator=fitPlattCalibration(calibrationRawPredictions,calibrationValidation.map(r=>r.y));
  const originalPredictions=predict(c,winner.weights);
  const predictions=applyPlattCalibration(originalPredictions,calibrator);
  const testScores=score(test,predictions);
  const uncalibratedTest=score(test,originalPredictions);
  const calibratedTestReliability=reliabilitySummary(predictions,test.map(r=>r.y));
  const baseline=score(test,test.map(()=>baseRate));
  const clusters=new Map<string,{n:number,brier:number,logLoss:number}>();
  const binaryLoss=(p:number,y:number) => -(y*Math.log(Math.max(1e-9,p))+(1-y)*Math.log(Math.max(1e-9,1-p)));
  for(let i=0;i<test.length;i++) {
    const row=test[i], group=clusters.get(row.game) ?? {n:0,brier:0,logLoss:0};
    group.n++;
    group.brier+=(baseRate-row.y)**2-(predictions[i]-row.y)**2;
    group.logLoss+=binaryLoss(baseRate,row.y)-binaryLoss(predictions[i],row.y);
    clusters.set(row.game,group);
  }
  const games=[...clusters.values()];
  let seed=51733;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const replicates=Array.from({length:500},()=>{
    let n=0,b=0,l=0;
    for(let j=0;j<games.length;j++) {
      const g=games[Math.floor(random()*games.length)];
      n+=g.n;b+=g.brier;l+=g.logLoss;
    }
    return [b/n,l/n];
  });
  const interval=(i:number):[number,number]=>{
    const values=replicates.map(x=>x[i]).sort((a,b)=>a-b);
    return [values[12],values[487]];
  };
  const brierInterval=interval(0), logLossInterval=interval(1);
  const uncertaintyDiagnostic={method:'500 fixed-seed whole-game bootstrap resamples; event-grouped 2025 held-out improvement over historical base rate',
    gameClusters:games.length,positiveDifferenceFavorsModel:true,
    improvementBrier95:brierInterval,improvementLogLoss95:logLossInterval,
    lowerBrierBoundPositive:brierInterval[0]>0,lowerLogLossBoundPositive:logLossInterval[0]>0,
    limitations:'Game clustering does not account for multiweek player dependence, selection bias or model-search multiplicity. Not per-selection probability intervals.'};
  return { cohort: { protocol: 'SIGNED_YARDAGE_RECORDED_ROWS_V2', eligible: raw.length, scored: obs.length,
    warmupExcluded: raw.length - obs.length, minimumPriorRecords: 3,
    negativeYardageRetained: raw.filter(r => r.value < 0).length,
    historyIdentity: 'player_id|position', currentOutcomeUsedForEligibility: false },
    evaluationStatus: 'CONSUMED_2025_RETROSPECTIVE_DIAGNOSTIC',
    split: {train:train.length,validation:validation.length,test:test.length,
    selectionValidation:selectionValidation.length,calibrationValidation:calibrationValidation.length}, regularization:winner.lambda,
    calibration: { status:'CONSUMED_2025_RETROSPECTIVE_DIAGNOSTIC',
      selectionWindow:'2024 weeks 1-9: choose logistic regularization',
      fitWindow:'2024 weeks 10-18: fit Platt scaling without using 2025 outcomes',
      evaluationWindow:'2025 regular season: consumed retrospective diagnostic; no new untouched holdout',
      fit:calibrator, uncalibratedTest, calibratedTest:testScores, testReliability:calibratedTestReliability,
      performanceVersusUncalibrated:{brierReduction:uncalibratedTest.brier-testScores.brier,logLossReduction:uncalibratedTest.logLoss-testScores.logLoss},
      caveats:['Calibration of fixed 60/50/200/4 thresholds does not calibrate arbitrary sportsbook prop lines.',
        '2025 ECE and Wilson reliability bins evaluate an historical cohort, not individual wager confidence intervals.',
        'No independently authenticated point-in-time sportsbook odds. No claim of market-beating forecasts or executable EV.'] }, 
    features:['past3_average','past8_average','past3_hit_frequency','past8_hit_frequency','previous_games'],
    validation:validationScores, test:testScores, baseline, uncertaintyDiagnostic,
    improvementVersusBaseline: { brier: baseline.brier-testScores.brier,logLoss:baseline.logLoss-testScores.logLoss },
    limitations: ['Source values are current/revised; original historical publication vintages not verified.',
      'Samples include recorded player games, which may omit inactive/non-participating players.',
      'No contemporaneous two-way sportsbook odds; performance versus market is NOT established.',
      'Retrospective 2025 reliability bins are descriptive and do not validate per-wager probability intervals or correlated SGP probabilities.',
      'No live injury or lineup features. Results are retrospective, not executable odds.'] };
}
export async function nflPropBacktest(market='receiving_yards') {
  if (!(market in markets)) throw Error('Choose an allowed market: receiving_yards, rushing_yards, passing_yards or receptions.');
  const cached = resultCache.get(market);
  if (cached && Date.now()-cached.at < 3600000) return cached.report;
  const data=await history();
  const marketRows=data.rows[market] ?? [];
  const result=evaluate(marketRows,markets[market].threshold);
  const report={status:'HISTORICAL_RESEARCH_ONLY',liveApproved:false,verifiedPositiveEv:false,source:{ name:'nflverse weekly player statistics',
    urls:seasons.map(asset), gameIdentityField:'game_id', fetchedAt:data.fetchedAt, parsedRegularSeasonRows:data.count, excludedUnmatchedPlayerRows:data.unmatchedPlayerRows,
    provenance:'Public community-maintained nflverse GitHub release URLs, revised retrospective CSVs; source release vintage not independently authenticated' },
    market,threshold:markets[market].threshold, eligibleObservations:marketRows.length,...result,recommendation:'HOLD'};
  resultCache.set(market,{at:Date.now(),report});
  return report;
}
export async function nflPropSourceHealth() {
  const data=await history();
  return { status:'DOWNLOADED_FOR_INSPECTION',source:'Public community-maintained nflverse stats_player weekly release',
    parsedRegularSeasonRows:data.count,observationsByMarket:Object.fromEntries(Object.entries(data.rows).map(([k,v])=>[k,v.length])),
    cohortPolicy:'SIGNED_YARDAGE_RECORDED_ROWS_V2',
    cohorts:Object.fromEntries(Object.entries(data.rows).map(([market, rows]) => {
      const scored=buildHistoricalObservations(rows,markets[market].threshold).length;
      return [market,{eligible:rows.length,scored,warmupExcluded:rows.length-scored,negativeYardageRetained:rows.filter(r=>r.value<0).length}];
    })),
    urls:seasons.map(asset),gameIdentityField:'game_id',excludedUnmatchedPlayerRows:data.unmatchedPlayerRows,fetchedAt:data.fetchedAt,pointInTimeVintageVerified:false,liveApproved:false };
}
