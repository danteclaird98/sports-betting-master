import { getHistoricalLineAwareRows } from './nflPropBacktest';
import { validateHistoricalRows } from './historicalStatPolicy';
import { fitPlattCalibration, applyPlattCalibration, reliabilitySummary } from './nflPropCalibration';

const ladders = {
  receptions: [2.5, 4.5, 6.5, 8.5],
  receiving_yards: [24.5, 49.5, 74.5, 99.5],
  rushing_yards: [24.5, 49.5, 74.5, 99.5],
  passing_yards: [174.5, 224.5, 274.5, 324.5],
} as const;
type Market = keyof typeof ladders;
type RecordStat = { id: string; season: number; week: number; game: string; value: number };
type Labeled = { p: number; y: number; season: number; week: number; game: string; player: string; line: number };
const cache = new Map<string, { at: number; report: unknown }>();
const minProb = (p: number) => Math.max(0.001, Math.min(0.999, p));
function cross(p: number, y: number) {
  const x = minProb(p);
  return -(y * Math.log(x) + (1 - y) * Math.log(1 - x));
}
function logistic(x: number) {
  return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, x))));
}
function modelLineScore(
  history: number[],
  line: number,
  leaguePrior: number,
  smoothing: number,
  shrinkage: number,
) {
  const latest = history.slice(-12);
  if (latest.length < 4) return null;
  const perPlayer = latest.reduce((sum, value) => sum +
    (smoothing === 0 ? Number(value > line) : logistic((value - line - 0.5) / smoothing)), 0) / latest.length;
  return minProb((perPlayer * latest.length + leaguePrior * shrinkage) / (latest.length + shrinkage));
}
function metrics(rows: Labeled[], calibrated = false) {
  const n = rows.length;
  return {
    n,
    brier: rows.reduce((sum, row) => sum + Math.pow(row.p - row.y, 2), 0) / n,
    logLoss: rows.reduce((sum, row) => sum + cross(row.p, row.y), 0) / n,
    byThreshold: [...new Set(rows.map(r => r.line))].map(line => {
      const group = rows.filter(r => r.line === line);
      return {
        line, observations: group.length,
        brier: group.reduce((s, r) => s + Math.pow(r.p - r.y, 2), 0) / group.length,
        logLoss: group.reduce((s, r) => s + cross(r.p, r.y), 0) / group.length,
        averageForecast: group.reduce((s, r) => s + r.p, 0) / group.length,
        observedRate: group.reduce((s, r) => s + r.y, 0) / group.length,
      };
    }),
    reliability: calibrated
      ? reliabilitySummary(rows.map(r => r.p), rows.map(r => r.y))
      : null,
  };
}
function buildData(
  data: RecordStat[],
  thresholds: readonly number[],
  smooth: number,
  shrink: number,
) {
  validateHistoricalRows(data);
  const training = data.filter(r => r.season <= 2023);
  if (training.length < 1200) throw Error('Insufficient 2021-2023 training rows.');
  const leagues = thresholds.map(line => ({
    line,
    prior: (training.filter(r => r.value > line).length + 2) / (training.length + 4),
  }));
  const earlier = new Map<string, number[]>();
  const dataset: Labeled[] = [];
  const sorted = [...data].sort((a, b) =>
    a.season - b.season || a.week - b.week || a.id.localeCompare(b.id));
  for (const item of sorted) {
    const previous = earlier.get(item.id) ?? [];
    if (item.season >= 2024 && previous.length >= 4) {
      for (const league of leagues) {
        const p = modelLineScore(previous, league.line, league.prior, smooth, shrink);
        if (p !== null) dataset.push({
          p, y: item.value > league.line ? 1 : 0, season: item.season, week: item.week,
          game: item.game, player: item.id, line: league.line,
        });
      }
    }
    previous.push(item.value);
    if (previous.length > 12) previous.shift();
    earlier.set(item.id, previous);
  }
  return { dataset, leaguePrior: leagues };
}
function fixedModelTest(raw: RecordStat[], thresholds: readonly number[]) {
  const grid = [0, 4, 10, 20].flatMap(smoothing => [4, 12].map(shrinkage => ({ smoothing, shrinkage })));
  const scored = grid.map(parameters => {
    const model = buildData(raw, thresholds, parameters.smoothing, parameters.shrinkage);
    const selection = model.dataset.filter(r => r.season === 2024 && r.week <= 9);
    if (selection.length < 500) throw Error('Too few early-2024 selection observations.');
    const selectionLoss = metrics(selection).logLoss;
    return { ...parameters, selectionLoss };
  }).sort((a, b) => a.selectionLoss - b.selectionLoss ||
    a.smoothing - b.smoothing || a.shrinkage - b.shrinkage);
  const choice = scored[0];
  const built = buildData(raw, thresholds, choice.smoothing, choice.shrinkage);
  const calibration = built.dataset.filter(r => r.season === 2024 && r.week >= 10);
  const test = built.dataset.filter(r => r.season === 2025);
  if (calibration.length < 500 || test.length < 500) throw Error('Insufficient 2024 calibration or 2025 test observations.');
  const fitted = fitPlattCalibration(calibration.map(r => r.p), calibration.map(r => r.y));
  const calibrated = applyPlattCalibration(test.map(r => r.p), fitted)
    .map((p, i) => ({ ...test[i], p }));
  const trainModel = metrics(test);
  const calibratedModel = metrics(calibrated, true);
  const leagueForecasts = test.map(r => {
    const prior = built.leaguePrior.find(p => p.line === r.line);
    if (!prior) throw Error('Missing training-only prior');
    return { ...r, p: prior.prior };
  });
  const leagueBaseline = metrics(leagueForecasts);
  const distinctGames = new Set(test.map(r => r.game));
  return {
    configuration: { ...choice, trainingSeasons: '2021–2023', modelSelection: '2024 weeks 1–9',
      calibrationFit: '2024 weeks 10–18', diagnosticWindow: '2025 (consumed retrospective diagnostic)',
      ladder: [...thresholds], lastPlayerGames: 12,
      method: 'Smoothed conditional past-game exceedance rate with training-only league prior',
    },
    dataset: {
      testThresholdObservations: test.length, testPlayerGames: test.length / thresholds.length,
      distinctGames: distinctGames.size, calibrationObservations: calibration.length,
      selectionCandidates: scored.length,
      inactivePlayers: 'Not represented: an observed player-game cohort only',
    },
    test: { uncalibrated: trainModel, plattCalibrated: calibratedModel,
      staticLeagueBaseline: leagueBaseline },
    calibration: { fit: fitted,
      brierImprovement: trainModel.brier - calibratedModel.brier,
      logLossImprovement: trainModel.logLoss - calibratedModel.logLoss,
      improvesBoth: calibratedModel.brier < trainModel.brier &&
        calibratedModel.logLoss < trainModel.logLoss },
    comparisons: {
      againstTrainingLeaguePrior: true,
      againstMatchedSportsbook: false,
      againstContemporaneousOdds: false,
      verifiedBettingROI: null,
      perWagerUncertaintyValidated: false,
      historicalOddsAvailable: false,
    },
  };
}
export async function nflLineAwareBacktest(market: string) {
  if (!Object.prototype.hasOwnProperty.call(ladders, market)) {
    throw Error('Allowed markets: receptions, receiving_yards, rushing_yards, passing_yards.');
  }
  const hit = cache.get(market);
  if (hit && Date.now() - hit.at < 3600000) return hit.report;
  const m = market as Market;
  const history = await getHistoricalLineAwareRows(m);
  const result = fixedModelTest(history.rows, ladders[m]);
  const report = {
    status: 'HISTORICAL_THRESHOLD_RESEARCH_ONLY',
    selection: 'HOLD',
    liveApproved: false,
    sport: 'americanfootball_nfl',
    market,
    source: {
      label: 'nflverse community-maintained weekly player stats',
      fetchedAt: history.fetchedAt,
      pointInTimeSourceVintageVerified: false,
      rawRecords: history.rows.length,
    },
    ...result,
    caveats: [
      'Ladder thresholds are preselected research examples, NOT recorded sportsbook lines or favorable wager selections.',
      'Ladder outcomes share games and player observations; threshold-observation count is not independent sample size.',
      'Historical source is retrospectively revised and original publication vintages are not independently verified.',
      'Player games absent due to injury or nonparticipation are omitted; role, opponent, coaching and coverage features unavailable.',
      'A leave-past-only model may be informative but is NOT tested against contemporaneous sportsbook prices.',
      'Calibration fitted on 2024 only; 2025 has been inspected and is a reused retrospective diagnostic, not a new untouched holdout.',
      'No validated individual-event uncertainty or same-game correlation model. No live +EV approval.',
    ],
  };
  cache.set(market, { at: Date.now(), report });
  return report;
}
export function lineAwareSelftest() {
  const p = modelLineScore([1, 3, 5, 7, 9, 11], 4.5, 0.5, 0, 4);
  const harder = modelLineScore([1, 3, 5, 7, 9, 11], 8.5, 0.5, 0, 4);
  const one = modelLineScore([0, 0, 0, 0], 0.5, 0.2, 0, 12);
  const checks = {
    probabilitiesBounded: [p, harder, one].every(v => v !== null && v > 0 && v < 1),
    increasingLineNeverRaisesOverProbability: p !== null && harder !== null && harder <= p,
    zeroObservedDoesNotBecomeCertainty: one !== null && one > 0,
    pregameOnlyInputMethod: true,
    noProviderCallsOrWagers: true,
  };
  return {
    status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    fixture: 'SYNTHETIC_VALUES_ONLY',
    checks, liveModelApproved: false, verifiedEV: null,
  };
}
