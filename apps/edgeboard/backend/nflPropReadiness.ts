const required = ['player_id', 'season', 'week', 'season_type'];
const markets = ['receiving_yards', 'rushing_yards', 'passing_yards', 'receptions', 'passing_tds', 'receiving_tds', 'rushing_tds'];
export function nflPropReadiness(input?: unknown) {
  const base = { status: 'RESEARCH_ONLY', liveApproved: false, betRecommendationsEnabled: false, modelTrained: false, historicalPrototypeImplemented: true, modelScope: 'Broad multi-market prototype; corrected receiving60 candidate has separate /api/corrected-receiving-readiness evidence', independentLiveModelApproved: false, historicalSource: 'community-maintained nflverse weekly player statistics', markets, provenanceVerified: false, historicalTestCompleted: false, sportsbookBenchmarkVerified: false, parlayCorrelationModelVerified: false, requirements: ['Independently verified nflverse asset and checksum', 'Pregame-only rolling statistics from prior games', 'No duplicate player-season-week records', 'Chronological train through 2023, early-2024 model selection, late-2024 calibration, reused2025 diagnostics plus a new frozen forward holdout', 'Run historical held-out Brier, log loss and calibration (not proof of a live-ready model)', 'Independently authenticated timestamped historical sportsbook lines, exact identity, settlement rules and calibrated market benchmarking', 'Validated per-wager uncertainty and parlay joint probabilities'], recommendation: 'HOLD' };
  if (input === undefined) return base;
  const body = input as { headers?: unknown; rows?: unknown };
  if (!body || !Array.isArray(body.headers) || !body.headers.every(x => typeof x === 'string') || !Array.isArray(body.rows)) return {...base, valid: false, errors: ['Supply a CSV header array and sampled rows for source inspection; no training occurs.']};
  const headers = body.headers as string[];
  const rows = body.rows as unknown[];
  const missing = required.filter(k => !headers.includes(k));
  const presentMarkets = markets.filter(k => headers.includes(k));
  const errors: string[] = [];
  if (missing.length) errors.push('Missing columns: ' + missing.join(', '));
  if (!headers.includes('team') && !headers.includes('recent_team')) errors.push('Missing team identity (team or recent_team).');
  if (!presentMarkets.length) errors.push('No supported player-stat columns present.');
  if (rows.length > 5000) errors.push('Sample inspection is limited to 5000 rows.');
  const seen = new Set<string>();
  if (!missing.length) for (const row of rows.slice(0, 5000)) {
    if (!Array.isArray(row) || row.length !== headers.length) { errors.push('Malformed sample row.'); break; }
    const value = (key: string) => String(row[headers.indexOf(key)] ?? '');
    const season = Number(value('season')), week = Number(value('week'));
    if (!Number.isInteger(season) || season < 1999 || season > 2100 || !Number.isInteger(week) || week < 1 || week > 23) { errors.push('Invalid season/week.'); break; }
    const key = [value('player_id'), season, week, value('season_type')].join('|');
    if (seen.has(key)) { errors.push('Duplicate player-season-week detected: ' + key); break; }
    seen.add(key);
  }
  return {...base, valid: errors.length === 0, errors, sampleRowsInspected: Math.min(rows.length,5000), columnsPresent: presentMarkets, sourceAuthenticityVerified: false, notice: 'Structural inspection is not a trained, calibrated, or approved player-prop model.'};
}
