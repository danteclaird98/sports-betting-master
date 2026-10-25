import { csvRows, HISTORICAL_NFL_SOURCE } from './historicalNfl.ts';

type Game = { date: string; season: number; home: string; away: string; homePoints: number; awayPoints: number; homeOdds: number | null; awayOdds: number | null };
const logistic = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const american = (v: string | undefined): number | null => {
  if (!v?.trim()) return null;
  const n = Number(v);
  return v.trim() && Number.isFinite(n) && Math.abs(n) >= 100 ? (n > 0 ? 1 + n / 100 : 1 + 100 / -n) : null;
};
function score(rows: { outcome: number; p: number }[]) {
  if (!rows.length) return null;
  const brier = rows.reduce((s, r) => s + (r.p - r.outcome) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((s, r) => s - r.outcome * Math.log(Math.max(1e-9,r.p)) - (1-r.outcome)*Math.log(Math.max(1e-9,1-r.p)),0)/rows.length;
  const bins = Array.from({ length: 10 }, (_, i) => {
    const selected = rows.filter(r => Math.min(9,Math.floor(r.p*10))===i);
    return { bin: i, count: selected.length, predicted: selected.length ? selected.reduce((s,r)=>s+r.p,0)/selected.length : null, observed: selected.length ? selected.reduce((s,r)=>s+r.outcome,0)/selected.length : null };
  });
  return { count: rows.length, brier, logLoss, calibrationError: bins.reduce((s,b)=>s+b.count/rows.length*Math.abs((b.predicted??0)-(b.observed??0)),0), bins };
}
export async function researchNflCalibration() {
  const response = await fetch(HISTORICAL_NFL_SOURCE, { signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw Error('Historical NFL source unavailable');
  const csv = await response.text();
  if (csv.length > 10000000) throw Error('History too large');
  const [headers, ...raw] = csvRows(csv);
  if (!headers) throw Error('Missing historical game columns');
  const index = (key: string) => headers.indexOf(key);
  const required = ['season','gameday','home_team','away_team','home_score','away_score'];
  if (required.some(key => index(key) < 0)) throw Error('Missing historical game columns');
  const wholeNumber = (value: string | undefined): number | null => {
    // Check source text before Number(): a missing score must never become zero.
    if (!value || !/^\d+$/.test(value.trim())) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const identities = new Set<string>();
  const today = new Date().toISOString().slice(0,10);
  const games: Game[] = [];
  for (const row of raw) {
    const date = row[index('gameday')]?.trim() ?? '';
    const season = wholeNumber(row[index('season')]);
    const home = row[index('home_team')]?.trim() ?? '';
    const away = row[index('away_team')]?.trim() ?? '';
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
    if (!validDate || date > today || season === null || season < 1900 || !home || !away || home === away) continue;
    // Do not choose between duplicate or conflicting source outcomes, or update
    // Elo twice for one fixture. Sorting participants also detects reversed rows.
    const identity = JSON.stringify([season,date,...[home,away].sort()]);
    if (identities.has(identity)) throw Error('Duplicate historical game fixture');
    identities.add(identity);
    const homePoints = wholeNumber(row[index('home_score')]);
    const awayPoints = wholeNumber(row[index('away_score')]);
    const statusIndex = index('game_status') >= 0 ? index('game_status') : index('status');
    if (statusIndex >= 0 && !['final','completed','closed'].includes((row[statusIndex] ?? '').trim().toLowerCase())) continue;
    // Ties are excluded from this binary win/loss calibration.
    if (homePoints === null || awayPoints === null || homePoints === awayPoints) continue;
    games.push({date,season,home,away,homePoints,awayPoints,
      homeOdds: index('home_moneyline') >= 0 ? american(row[index('home_moneyline')]) : null,
      awayOdds: index('away_moneyline') >= 0 ? american(row[index('away_moneyline')]) : null});
  }
  games.sort((a,b)=>a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  const seasons = [...new Set(games.map(g=>g.season))].sort((a,b)=>a-b);
  if (seasons.length < 7 || games.length < 700) throw Error('Insufficient chronological history');
  const cut = Math.floor(seasons.length * .6), cut2=Math.floor(seasons.length*.8);
  const trainSeasons = seasons.slice(0,cut), validationSeasons=seasons.slice(cut,cut2), testSeasons=seasons.slice(cut2);
  const ratings = new Map<string,number>();
  const predictions: Array<{ season:number; date:string; outcome:number; margin:number; marketP:number|null }>=[];
  let i=0;
  while(i<games.length) {
    let j=i; while(j<games.length && games[j].date===games[i].date) j++;
    const day=games.slice(i,j);
    for(const g of day) {
      const h=ratings.get(g.home)??1500, aw=ratings.get(g.away)??1500;
      const margin=(h-aw+55)/400*Math.log(10);
      const marketP=g.homeOdds && g.awayOdds ? (1/g.homeOdds)/(1/g.homeOdds+1/g.awayOdds) : null;
      predictions.push({ season:g.season, date:g.date, outcome:g.homePoints>g.awayPoints?1:0, margin, marketP });
    }
    for(const g of day) {
      const h=ratings.get(g.home)??1500, aw=ratings.get(g.away)??1500;
      const expected=logistic((h-aw+55)/400*Math.log(10));
      const delta=20*((g.homePoints>g.awayPoints?1:0)-expected);
      ratings.set(g.home,h+delta);ratings.set(g.away,aw-delta);
    }
    i=j;
  }
  const validation=predictions.filter(r=>validationSeasons.includes(r.season));
  const test=predictions.filter(r=>testSeasons.includes(r.season));
  if(validation.length<100 || test.length<100) throw Error('Insufficient held-out games');
  const scales=[.5,.75,1,1.25,1.5], intercepts=[-.3,-.15,0,.15,.3];
  const candidates=scales.flatMap(scale=>intercepts.map(intercept=>({scale,intercept,metric:score(validation.map(r=>({outcome:r.outcome,p:logistic(scale*r.margin+intercept)})))!})))
    .sort((a,b)=>a.metric.logLoss-b.metric.logLoss);
  const best=candidates[0];
  const modelRows=test.map(r=>({outcome:r.outcome,p:logistic(best.scale*r.margin+best.intercept)}));
  const matched=test.filter(r=>r.marketP!==null);
  const marketRows=matched.map(r=>({outcome:r.outcome,p:r.marketP!}));
  return {
    status:'RESEARCH_ONLY', liveApproved:false, source:HISTORICAL_NFL_SOURCE, retrievedAt:new Date().toISOString(),
    method:'Pregame Elo updated only after all games on each date; fixed home advantage and rating update. Calibration scale/intercept selected on validation seasons only.',
    chronologicalSplits:{train:trainSeasons,validation:validationSeasons,test:testSeasons},
    games:games.length, inputRows:raw.length, excludedGames:raw.length-games.length,
    validationCalibration:{scale:best.scale,intercept:best.intercept,metric:best.metric},
    heldOut:{model:score(modelRows), uncalibrated:score(test.map(r=>({outcome:r.outcome,p:logistic(r.margin)}))),
      modelMatched:score(matched.map(r=>({outcome:r.outcome,p:logistic(best.scale*r.margin+best.intercept)}))),
      uncalibratedMatched:score(matched.map(r=>({outcome:r.outcome,p:logistic(r.margin)}))),
      marketMatched:score(marketRows), matchedGames:matched.length, marketCoverage:marketRows.length, testGames:test.length,
      comparisonNote:'Compare modelMatched and uncalibratedMatched with marketMatched on the identical moneyline-eligible cohort; model and uncalibrated describe all test games.'},
    blockers:['Source rows and rights require independent validation','Published moneylines lack verified bookmaker and observation time','Elo parameters were not independently fitted or prospectively registered','No verified Caesars offered or accepted prices','No per-pick uncertainty interval or real execution simulation'],
    recommendation:'PASS', noWagersPlaced:true
  };
}
