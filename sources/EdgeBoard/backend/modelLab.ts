type Sample = {
  id: string;
  eventId: string;
  decisionAt: string;
  featuresAt: string;
  settledAt: string;
  oddsAt: string;
  sport: string;
  market: string;
  features: number[];
  outcome: 0 | 1;
  decimalOdds: number;
  oppositeDecimalOdds: number;
  available: boolean;
  feePerUnit: number;
  settlement: 'binary_no_push';
};
type Dataset = {
  source: string;
  featureNames: string[];
  featureDefinitions: string[];
  rows: Sample[];
};
const sigmoid = (x: number) =>
  1 / (1 + Math.exp(-Math.max(-35, Math.min(35, x))));
const loss = (p: number, y: number) =>
  -(
    y * Math.log(Math.max(1e-12, p)) +
    (1 - y) * Math.log(Math.max(1e-12, 1 - p))
  );
function time(value: string) {
  if (
    typeof value !== 'string' ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error('Every timestamp must include a timezone.');
  return Date.parse(value);
}
export function validateDataset(input: unknown): Dataset {
  const d = input as Dataset;
  if (
    !d ||
    typeof d.source !== 'string' ||
    !d.source.trim() ||
    !Array.isArray(d.rows) ||
    d.rows.length < 300 ||
    d.rows.length > 5000
  )
    throw Error(
      'Provide a named historical source and 300–5000 settled samples.',
    );
  if (
    !Array.isArray(d.featureNames) ||
    d.featureNames.length < 1 ||
    d.featureNames.length > 16 ||
    new Set(d.featureNames).size !== d.featureNames.length ||
    !Array.isArray(d.featureDefinitions) ||
    d.featureDefinitions.length !== d.featureNames.length
  )
    throw Error('Provide 1–16 unique feature names and matching definitions.');
  if (
    d.featureNames.some(
      (n, i) =>
        typeof n !== 'string' ||
        !n.trim() ||
        /odds|price|implied|closing|result|outcome|probability|target/i.test(
          n,
        ) ||
        typeof d.featureDefinitions[i] !== 'string' ||
        !d.featureDefinitions[i].trim(),
    )
  )
    throw Error(
      'Use independent pre-decision statistics with definitions; market odds, labels and post-event features are prohibited.',
    );
  const ids = new Set<string>();
  const scope = new Set<string>();
  for (const r of d.rows) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id ||
      ids.has(r.id) ||
      typeof r.eventId !== 'string' ||
      !r.eventId
    )
      throw Error('Sample IDs must be unique and event IDs present.');
    ids.add(r.id);
    if (
      typeof r.sport !== 'string' ||
      !r.sport ||
      typeof r.market !== 'string' ||
      !r.market
    )
      throw Error('Sport and market are required.');
    scope.add(`${r.sport}|${r.market}`);
    if (
      !Array.isArray(r.features) ||
      r.features.length !== d.featureNames.length ||
      !r.features.every(
        (x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e9,
      )
    )
      throw Error('Feature vectors must be complete finite numbers.');
    if (r.outcome !== 0 && r.outcome !== 1)
      throw Error(
        'Only confirmed binary outcomes are supported by this candidate model.',
      );
    const decision = time(r.decisionAt);
    if (
      time(r.featuresAt) > decision ||
      time(r.oddsAt) > decision ||
      time(r.settledAt) <= decision
    )
      throw Error(
        'Future-feature/quote leakage or invalid settlement chronology.',
      );
    if (
      r.settlement !== 'binary_no_push' ||
      typeof r.available !== 'boolean' ||
      !Number.isFinite(r.feePerUnit) ||
      r.feePerUnit < 0 ||
      r.feePerUnit >= 1 ||
      !Number.isFinite(r.decimalOdds) ||
      r.decimalOdds <= 1 ||
      r.decimalOdds > 1000 ||
      !Number.isFinite(r.oppositeDecimalOdds) ||
      r.oppositeDecimalOdds <= 1 ||
      r.oppositeDecimalOdds > 1000
    )
      throw Error(
        'Require matched two-way decimal odds, availability, fees and binary_no_push settlement.',
      );
  }
  if (scope.size !== 1)
    throw Error(
      'Evaluate one preregistered sport/market scope per dataset; pooled searching is not validation.',
    );
  return d;
}
function metrics(rows: Sample[], predictions: number[]) {
  const bins = Array.from({ length: 10 }, (_, bin) => {
    const indexes = rows.map((_, i) => i).filter(i => Math.min(9, Math.floor(predictions[i] * 10)) === bin);
    return { bin, n: indexes.length,
      predicted: indexes.length ? indexes.reduce((s, i) => s + predictions[i], 0) / indexes.length : null,
      observed: indexes.length ? indexes.reduce((s, i) => s + rows[i].outcome, 0) / indexes.length : null };
  });
  return {
    calibrationError: bins.reduce((sum, bin) => sum + (bin.n / rows.length) * Math.abs((bin.predicted ?? 0) - (bin.observed ?? 0)), 0),
    maximumCalibrationGap: Math.max(...bins.filter(b => b.n).map(b => Math.abs((b.predicted ?? 0) - (b.observed ?? 0))), 0),
    n: rows.length,
    brier:
      rows.reduce((s, r, i) => s + (predictions[i] - r.outcome) ** 2, 0) /
      rows.length,
    logLoss:
      rows.reduce((s, r, i) => s + loss(predictions[i], r.outcome), 0) /
      rows.length,
    calibration: Array.from({ length: 10 }, (_, bin) => {
      const indexes = rows
        .map((_, i) => i)
        .filter((i) => Math.min(9, Math.floor(predictions[i] * 10)) === bin);
      return {
        bin,
        n: indexes.length,
        predicted: indexes.length
          ? indexes.reduce((s, i) => s + predictions[i], 0) / indexes.length
          : null,
        observed: indexes.length
          ? indexes.reduce((s, i) => s + rows[i].outcome, 0) / indexes.length
          : null,
      };
    }),
  };
}
export function evaluateModel(input: unknown) {
  const dataset = validateDataset(input);
  const rows = [...dataset.rows].sort(
    (a, b) =>
      time(a.decisionAt) - time(b.decisionAt) || a.id.localeCompare(b.id),
  );
  const events = [...new Set(rows.map((r) => r.eventId))];
  if (events.length < 150)
    throw Error(
      'Require at least 150 independent events for event-grouped evaluation.',
    );
  const first = Math.floor(events.length * 0.6),
    second = Math.floor(events.length * 0.8);
  const groups = new Map(
    events.map((id, i) => [id, i < first ? 0 : i < second ? 1 : 2]),
  );
  const splits = [0, 1, 2].map((g) =>
    rows.filter((r) => groups.get(r.eventId) === g),
  );
  const [train, validation, test] = splits;
  if (train.length < 100 || validation.length < 50 || test.length < 50)
    throw Error(
      'Require at least 100 train / 50 validation / 50 test samples.',
    );
  for (let i = 0; i < 2; i++) {
    const next = Math.min(...splits[i + 1].map((r) => time(r.decisionAt)));
    if (
      splits[i].some(
        (r) => time(r.decisionAt) >= next || time(r.settledAt) >= next,
      )
    )
      throw Error(
        'Event overlap or unsettled-label leakage crosses chronological split; purge overlapping events.',
      );
  }
  const width = dataset.featureNames.length;
  const means = Array.from(
    { length: width },
    (_, j) => train.reduce((s, r) => s + r.features[j], 0) / train.length,
  );
  const scales = means.map(
    (m, j) =>
      Math.sqrt(
        train.reduce((s, r) => s + (r.features[j] - m) ** 2, 0) / train.length,
      ) || 1,
  );
  const vector = (r: Sample) => [
    1,
    ...r.features.map((x, j) =>
      Math.max(-10, Math.min(10, (x - means[j]) / scales[j])),
    ),
  ];
  const probability = (r: Sample, weights: number[]) =>
    sigmoid(vector(r).reduce((s, x, j) => s + x * weights[j], 0));
  const fit = (regularization: number) => {
    const weights = Array(width + 1).fill(0) as number[];
    const vectors = train.map(vector);
    for (let epoch = 0; epoch < 500; epoch++) {
      const gradient = weights.map(() => 0);
      vectors.forEach((x, i) => {
        const difference =
          sigmoid(x.reduce((s, value, j) => s + value * weights[j], 0)) -
          train[i].outcome;
        x.forEach((value, j) => {
          gradient[j] += (difference * value) / train.length;
        });
      });
      weights.forEach((_, j) => {
        weights[j] -=
          0.1 * (gradient[j] + (j ? regularization * weights[j] : 0));
      });
    }
    return weights;
  };
  const candidates = [0.001, 0.01, 0.1]
    .map((lambda) => {
      const weights = fit(lambda);
      return {
        lambda,
        weights,
        score: metrics(
          validation,
          validation.map((r) => probability(r, weights)),
        ).logLoss,
      };
    })
    .sort((a, b) => a.score - b.score);
  const chosen = candidates[0];
  const p = test.map((r) => probability(r, chosen.weights));
  const baseRate =
    (train.reduce((s, r) => s + r.outcome, 0) + 1) / (train.length + 2);
  const benchmark = test.map(
    (r) => 1 / r.decimalOdds / (1 / r.decimalOdds + 1 / r.oppositeDecimalOdds),
  );
  const differences = events
    .filter((id) => groups.get(id) === 2)
    .map((id) => {
      const indexes = test
        .map((r, i) => (r.eventId === id ? i : -1))
        .filter((i) => i >= 0);
      return {
        n: indexes.length,
        sum: indexes.reduce(
          (s, i) =>
            s +
            loss(p[i], test[i].outcome) -
            loss(benchmark[i], test[i].outcome),
          0,
        ),
      };
    });
  // Fixed-seed cluster bootstrap: resample whole events, not correlated selections.
  let seed = 719;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bootstrap = Array.from({ length: 500 }, () => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < differences.length; i++) {
      const cluster = differences[Math.floor(random() * differences.length)];
      sum += cluster.sum;
      count += cluster.n;
    }
    return sum / count;
  }).sort((a, b) => a - b);
  const interval = [bootstrap[12], bootstrap[487]];
  // Without exact selection identity, replay at most one qualifying observation
  // per event. This avoids treating repeated snapshots as multiple fills.
  // The rule is fixed before inspecting outcomes and never chooses a later winner.
  const selectedEvents = new Set<string>();
  let excludedRepeatedEventObservations = 0;
  const executable = test.filter((r, i) => {
    const qualifies =
      r.available &&
      time(r.decisionAt) - time(r.oddsAt) <= 120000 &&
      p[i] * r.decimalOdds - 1 - r.feePerUnit > 0.02;
    if (!qualifies) return false;
    if (selectedEvents.has(r.eventId)) {
      excludedRepeatedEventObservations++;
      return false;
    }
    selectedEvents.add(r.eventId);
    return true;
  });
  const pnl = executable.reduce(
    (s, r) => s + (r.outcome ? r.decimalOdds - 1 : -1) - r.feePerUnit,
    0,
  );
  return {
    status: 'CANDIDATE_ONLY',
    liveApproved: false,
    scope: { sport: rows[0].sport, market: rows[0].market },
    source: dataset.source,
    provenance:
      'User-supplied history; source authenticity, independent feature lineage and actual fills have not been externally verified.',
    model: {
      family: 'regularized logistic regression',
      version: 'independent-logistic-v2-evaluation',
      featureNames: dataset.featureNames,
      featureDefinitions: dataset.featureDefinitions,
      weights: chosen.weights,
      means,
      scales,
      lambda: chosen.lambda,
      trainedThrough: new Date(
        Math.max(...train.map((r) => time(r.settledAt))),
      ).toISOString(),
    },
    splits: splits.map((part, i) => ({
      name: ['train', 'validation', 'held-out test'][i],
      samples: part.length,
      events: new Set(part.map((r) => r.eventId)).size,
      from: part[0].decisionAt,
      to: part[part.length - 1].decisionAt,
    })),
    validation: metrics(
      validation,
      validation.map((r) => probability(r, chosen.weights)),
    ),
    test: metrics(test, p),
    baseRate: metrics(
      test,
      test.map(() => baseRate),
    ),
    marketBenchmark: metrics(test, benchmark),
    uncertainty: {
      method:
        '500 event-cluster bootstrap resamples; resampled loss sums divided by resampled row counts match row-weighted reported log loss; negative favors candidate',
      pairedLogLossDifference:
        metrics(test, p).logLoss - metrics(test, benchmark).logLoss,
      eventClusters: differences.length,
      interval95: interval,
      candidateImproves: interval[1] < 0,
      perWagerProbabilityBounds: null,
    },
    returns: {
      simulationOnly: true,
      selected: executable.length,
      excludedRepeatedEventObservations,
      selectionPolicy:
        'Earliest qualifying observation per event; at most one simulated unit per event',
      unitsStaked: executable.length,
      netUnits: pnl,
      roi: executable.length ? pnl / executable.length : null,
      assumptions:
        'One unit per event; earliest qualifying observation; fixed 2% EV buffer; supplied available matched prices at decision time; <=120-second quotes; supplied fees. Fills, limits, delays, slippage and cross-event dependence are not independently verified. This diagnostic does not validate a wagering policy.',
    },
    validationGate: {
      passed: false,
      explanation: 'Candidate model only; observed test metrics cannot authorize live recommendations without authenticated point-in-time history, independent replay and per-selection calibrated uncertainty.',
      minimumEvidence: ['Verified pre-decision feature timestamps', 'Independently sourced settled labels', 'Frozen untouched chronological test', 'Probability calibration and reliability intervals', 'Recorded offered and filled prices including fees', 'Sport/market-specific grading rules'],
      testCalibrationError: metrics(test, p).calibrationError,
      testMaximumCalibrationGap: metrics(test, p).maximumCalibrationGap,
      testMarketBenchmarkBrier: metrics(test, benchmark).brier,
      testModelBrier: metrics(test, p).brier,
      testImprovesBrier: metrics(test, p).brier < metrics(test, benchmark).brier,
      bootstrapImprovesLogLoss: interval[1] < 0,
    },
    promotionBlockers: [
      'No independently verified point-in-time source history.',
      'No validated per-selection uncertainty estimator or live feature adapter.',
      'No independent replay of execution availability, delays and sportsbook rules.',
      'Repeated dataset searches require an untouched final holdout and multiple-testing controls.',
    ],
    conclusion:
      interval[1] < 0
        ? 'Candidate improves held-out log loss versus supplied market benchmark; further validation required.'
        : 'Inconclusive or inferior versus supplied market benchmark. Do not promote.',
  };
}
