import artifact from './independentReceptionArtifact.json';
import halftime from './halftime_model.json';
import validation from './independentReceptionValidation.json';

export const RECEPTION_FEATURES = artifact.features;
export function negativeBinomialCdf(threshold: number, shape: number, success: number) {
  if (!Number.isInteger(threshold) || threshold < 0 || !Number.isFinite(shape) || shape <= 0 || !Number.isFinite(success) || success <= 0 || success > 1) {
    throw Error('Invalid count-distribution parameters.');
  }
  let mass = Math.exp(shape * Math.log(success));
  let total = mass;
  for (let k = 1; k <= threshold; k++) {
    mass *= (k - 1 + shape) / k * (1 - success);
    total += mass;
  }
  return Math.max(0, Math.min(1, total));
}
function interpolate(value: number, x: number[], y: number[]) {
  if (value <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (value <= x[i]) return y[i - 1] + (value-x[i-1]) / (x[i]-x[i-1]) * (y[i]-y[i-1]);
  }
  return y[y.length - 1];
}
export function receptionMean(features: number[]) {
  if (features.length !== artifact.features.length || features.some(value => !Number.isFinite(value))) throw Error('Complete finite independent-model features are required.');
  if (features.some((value, index) => value < artifact.feature_min[index] - 1e-10 || value > artifact.feature_max[index] + 1e-10)) throw Error('Current usage is outside the evaluated model feature range.');
  const logMean = features.reduce((sum, value, i) => sum + (value-artifact.scale_mean[i])/artifact.scale_std[i]*artifact.coefficients[i], artifact.intercept);
  if (!Number.isFinite(logMean) || logMean < -10 || logMean > 4) throw Error('Model mean outside safe numeric support.');
  return Math.exp(logMean);
}
export function receptionEstimate(features: number[], line: number, side: string,
  period: 'FULL' | '2H', observedFirstHalfReceptions: number | null = null) {
  if (!Number.isFinite(line) || line < .5 || line > 9.5 || line % 1 !== .5 || !['over','under'].includes(side)) {
    throw Error('Model supports only reception over/under half-lines 0.5 through 9.5.');
  }
  const mean = receptionMean(features);
  let shape = 1 / artifact.dispersion;
  let success = shape/(shape+mean);
  const calibration = period === '2H' ? halftime : artifact;
  if (period === '2H') {
    if (observedFirstHalfReceptions === null || !Number.isInteger(observedFirstHalfReceptions) || observedFirstHalfReceptions < 0) throw Error('Observed completed first-half receptions are required.');
    const rate = shape/mean + halftime.first_half_fraction;
    shape += observedFirstHalfReceptions;
    success = rate/(rate+1-halftime.first_half_fraction);
  }
  const rawCdf = negativeBinomialCdf(Math.floor(line), shape, success);
  const cdf = interpolate(rawCdf, calibration.calibration_x, calibration.calibration_y);
  const probability = side === 'over' ? 1-cdf : cdf;
  const margin = calibration.stress_bins[Math.min(9, Math.floor(cdf*10))].margin;
  return { probability, probabilityLow: Math.max(0, probability-margin), probabilityHigh: Math.min(1, probability+margin),
    expectedCountBeforeCdfCalibration: shape*(1-success)/success,
    mode: period === '2H' ? 'HALFTIME_CONDITIONAL_RESEARCH' : 'PREGAME_RESEARCH',
    modelId: period === '2H' ? halftime.artifact_id : 'independent-full-game-receptions-nb2-v1',
    labelsUsedThrough: artifact.labels_used_through, independentOfOdds: true,
    marketValidated: false, liveApproved: false, recommendedStake: 0,
    uncertaintyMeaning: 'Pooled calibration stress range, not an individual true-probability confidence interval',
    researchContract: period === '2H' ? 'Second half including overtime; only halftime forecasts evaluated' : 'Full game including overtime',
  };
}
export function independentModelStatus() {
  return { integrated: true, independentOfOdds: true, liveApproved: false,
    fullGame: { period: 'FULL', trainRows: artifact.train_rows, testPlayerGames: validation.player_game_count,
      brier: validation.calibrated_model.brier, baselineBrier: validation.rolling_8_game_Poisson_baseline.brier, labelsUsedThrough: artifact.labels_used_through },
    halftime: { period: '2H', method: halftime.method, testPlayerGames: halftime.test_summary.test_rows,
      testGames: halftime.test_summary.test_games, brier: halftime.model_brier, baselineBrier: halftime.baseline_brier,
      includesOvertime: true, requiresPhase: 'halftime' },
    limits: halftime.limits,
  };
}
