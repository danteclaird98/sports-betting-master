// Research-only Platt scaling. Fit on validation labels; never use test outcomes in fitting.
export function logitProbability(probability: number) {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, probability));
  return Math.log(p / (1 - p));
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
export type Calibration = {
  intercept: number;
  slope: number;
  fitObservations: number;
  method: string;
};
export function fitPlattCalibration(predictions: number[], outcomes: number[]): Calibration {
  if (predictions.length !== outcomes.length || predictions.length < 100 ||
      predictions.some(p => !Number.isFinite(p) || p <= 0 || p >= 1) ||
      outcomes.some(y => y !== 0 && y !== 1)) {
    throw Error('Platt calibration needs at least 100 valid chronological validation observations.');
  }
  const logits = predictions.map(logitProbability);
  let intercept = 0;
  let slope = 1;
  for (let epoch = 0; epoch < 550; epoch++) {
    let gi = 0;
    let gs = 0;
    for (let i = 0; i < logits.length; i++) {
      const residual = sigmoid(intercept + slope * logits[i]) - outcomes[i];
      gi += residual;
      gs += residual * logits[i];
    }
    intercept -= 0.18 * (gi / logits.length + intercept * 0.002);
    slope -= 0.18 * (gs / logits.length + (slope - 1) * 0.002);
    slope = Math.max(0.05, Math.min(4, slope));
  }
  return {
    intercept,
    slope,
    fitObservations: outcomes.length,
    method: 'Platt logistic recalibration fit only on late-2024 validation games; fixed penalty and optimization settings',
  };
}
export function applyPlattCalibration(probs: number[], fit: Calibration) {
  return probs.map(p => sigmoid(fit.intercept + fit.slope * logitProbability(p)));
}
export function reliabilitySummary(predictions: number[], outcomes: number[]) {
  if (!predictions.length || predictions.length !== outcomes.length) throw Error('Calibration diagnostic rows missing.');
  const bins = Array.from({ length: 10 }, (_, bucket) => {
    const ix = predictions.map((p, i) => Math.min(9, Math.floor(p * 10)) === bucket ? i : -1).filter(i => i >= 0);
    if (!ix.length) return { bucket, n: 0, predicted: null, observed: null, observedWilson95: null };
    const n = ix.length;
    const predicted = ix.reduce((s, i) => s + predictions[i], 0) / n;
    const observed = ix.reduce((s, i) => s + outcomes[i], 0) / n;
    const z2 = 1.96 * 1.96;
    const denominator = 1 + z2 / n;
    const center = (observed + z2 / (2 * n)) / denominator;
    const radius = 1.96 * Math.sqrt(observed * (1 - observed) / n + z2 / (4 * n * n)) / denominator;
    return { bucket, n, predicted, observed, observedWilson95: [Math.max(0, center - radius), Math.min(1, center + radius)] };
  });
  const ece = bins.reduce((sum, b) => sum + (b.predicted === null || b.observed === null ? 0 : b.n / predictions.length * Math.abs(b.predicted - b.observed)), 0);
  return { count: predictions.length, expectedCalibrationError: ece, bins, caveat: 'Wilson bands describe observed bin frequencies; not predictive intervals for individual upcoming wagers.' };
}
export function calibrationFixture() {
  // Deterministic synthetic fixtures: only software integrity, never measured real-world calibration.
  const y = Array.from({ length: 200 }, (_, i) => (i % 5 < (i < 100 ? 2 : 3) ? 1 : 0));
  const p = Array.from({ length: 200 }, (_, i) => i < 100 ? 0.34 : 0.57);
  const fitted = fitPlattCalibration(p, y);
  const applied = applyPlattCalibration([0.1, 0.5, 0.9], fitted);
  const report = reliabilitySummary(p, y);
  const checks = {
    trainedOnValidationOnly: fitted.fitObservations === 200,
    validSlope: fitted.slope > 0 && fitted.slope <= 4,
    boundedCalibratedProbabilities: applied.every(x => x > 0 && x < 1),
    orderedProbabilities: applied[0] < applied[1] && applied[1] < applied[2],
    binsCountCorrect: report.bins.reduce((s, b) => s + b.n, 0) === y.length,
  };
  return { status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    fixture: 'SYNTHETIC_CALIBRATION_INTEGRITY_ONLY', checks, approvedLiveModel: false, verifiedEv: false };
}
