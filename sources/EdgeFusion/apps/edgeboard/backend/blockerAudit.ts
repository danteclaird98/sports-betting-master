import { getRecommendationReadiness } from './settlementSupport';
import { nflPropReadiness } from './nflPropReadiness';

export function blockerAudit() {
  const registry = getRecommendationReadiness();
  const nflProps = nflPropReadiness();
  return {
    generatedAt: new Date().toISOString(),
    recommendation: 'HOLD',
    liveApproved: false,
    evidencePolicy: 'Only authenticated, independently validated and tested evidence can clear a blocker. A software implementation is not proof.',
    blockers: [
      {
        id: 'MODEL', title: 'Independent predictive performance', status: 'BLOCKED',
        implemented: ['Historical NFL/MLB baseline reports', 'Event-grouped chronological candidate evaluator', 'NFL prop-data structural inspector', 'Public nflverse weekly data importer, time-separated 2024 calibration fit, and 2025 held-out player-prop backtest', 'Game-grouped bootstrap research confidence intervals'],
        missing: ['Verified historical point-in-time feature lineage', 'Independently verified historical nflverse release vintages and authenticated contemporaneous sportsbook pricing', 'Improvement against contemporaneous de-vigged sportsbook market benchmark'],
        solution: 'Import authenticated player-game history; fit pregame-only sport/market models; evaluate chronological holdouts and market comparisons.',
        nextAction: 'Run existing time-separated NFL backtest; audit real historical quote archives, authenticate provider origin, and match exact 2025 player-game thresholds before market benchmarking.',
        source: '/api/nfl-prop-readiness',
      },
      {
        id: 'UNCERTAINTY', title: 'Calibrated uncertainty and correlated parlays', status: 'BLOCKED',
        implemented: ['Brier, log-loss and reliability-bin scoring', 'Event-cluster bootstrap for historical candidate loss', 'Joint-scenario settlement calculator requiring explicit joint probabilities', 'Game-grouped retrospective uncertainty bootstrap against historical base rate'],
        missing: ['Independently tested per-prop probability interval coverage', 'Joint event simulation or correlation model tested on held-out same-game results'],
        solution: 'Calibrate probability intervals using validation games, evaluate coverage on untouched future games, then test joint game-level simulation against actual parlay outcome frequencies.',
        nextAction: 'Keep same-game probability and EV unavailable until joint-model holdout and interval coverage tests pass.',
        source: '/api/research-policy',
      },
      {
        id: 'SETTLEMENT', title: 'Exact sportsbook ticket grading rules', status: 'BLOCKED',
        implemented: ['Ordinary parlay push/void arithmetic', 'Same-game branch repricing requires explicit accepted quotes', 'Reference sportsbook rule collection', 'Jurisdiction-scoped Caesars rulebook references'],
        missing: ['Caesars ticket-specific current rule version and account jurisdiction (Oregon, Maryland, Massachusetts references published; not automatically applicable)', 'Participation, timing, overtime, push/void and promotion terms for each market', 'Verified grading outcomes across rule fixtures'],
        solution: 'Archive versioned official terms per sportsbook, jurisdiction, sport, period and market; require an exact rule contract ID on each ticket; replay graded examples.',
        nextAction: 'Capture official Caesars market terms and compare against actual graded test tickets; never infer SGP repricing.',
        source: '/api/recommendation-readiness',
      },
      {
        id: 'EXECUTION', title: 'Actual accepted price and stake limits', status: 'BLOCKED',
        implemented: ['Caesars quote feed adapter', 'Authenticated quote batch archive', 'Private wager ledger and database diagnostic', 'Authenticated user-confirmed accepted-ticket evidence capture with offered-versus-accepted prices', 'Authenticated user-confirmed acceptance evidence archive'],
        missing: ['Confirmed accepted Caesars price/amount and market availability', 'Rejections, stake limits, promotions and price-changes recorded', 'Actual combined SGP and revised/void payout confirmation'],
        solution: 'Record timestamped offer versus acceptance and final settlement separately. Validate account-specific execution using user-authorized receipts, not market snapshots.',
        nextAction: 'Use quote archive and wager ledger to reconcile screenshots/receipts with prices and settled tickets.',
        source: '/api/quote-archive',
      },
    ],
    existingGate: { recommendationsEnabled: registry.recommendationsEnabled, executionEnabled: registry.executionEnabled, originalBlockers: registry.blockers, nflPlayerPropModelTrained: nflProps.modelTrained },
  };
}
