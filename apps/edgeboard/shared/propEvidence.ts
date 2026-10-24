export type PropObservation = {
  sport: string;
  event: string;
  startTime: string;
  player: string;
  market: string;
  selection: 'Higher' | 'Lower';
  line: number;
  publicDecimalPrice: number;
  lineId?: string;
  period?: string;
};
export type EvidenceCheck = {
  key: string;
  label: string;
  state: 'CONFIRMED' | 'MISSING' | 'CHANGED' | 'UNAVAILABLE';
  detail: string;
  sourceUrl?: string;
  observedAt?: string;
};
export function readPropObservation(input: unknown): PropObservation {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Supply a public prop observation.');
  const row = input as Record<string, unknown>;
  const sports = [
    'americanfootball_ncaaf',
    'americanfootball_nfl',
    'basketball_nba',
    'basketball_wnba',
    'icehockey_nhl',
    'baseball_mlb',
    'tennis',
    'mma',
  ];
  if (!sports.includes(String(row.sport))) throw Error('Unsupported sport.');
  for (const field of ['event', 'player', 'market', 'startTime']) {
    if (
      typeof row[field] !== 'string' ||
      !String(row[field]).trim() ||
      String(row[field]).length > 200
    )
      throw Error('A valid ' + field + ' is required.');
  }
  if (
    !Number.isFinite(Date.parse(String(row.startTime))) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(String(row.startTime))
  )
    throw Error('Start time must include a timezone.');
  if (
    typeof row.line !== 'number' ||
    !Number.isFinite(row.line) ||
    row.line < 0
  )
    throw Error('An exact numeric threshold is required.');
  if (
    typeof row.publicDecimalPrice !== 'number' ||
    !Number.isFinite(row.publicDecimalPrice) ||
    row.publicDecimalPrice <= 1
  )
    throw Error('A public decimal price above 1 is required.');
  if (row.selection !== 'Higher' && row.selection !== 'Lower')
    throw Error('Choose Higher or Lower.');
  if (
    row.lineId !== undefined &&
    (typeof row.lineId !== 'string' || row.lineId.length > 200)
  )
    throw Error('Invalid public line identity.');
  if (
    row.period !== undefined &&
    !['FULL_GAME', '1H', '2H', 'UNKNOWN'].includes(String(row.period))
  )
    throw Error('Unsupported period.');
  return {
    sport: String(row.sport),
    event: String(row.event).trim(),
    startTime: String(row.startTime),
    player: String(row.player).trim(),
    market: String(row.market).trim(),
    selection: row.selection,
    line: row.line,
    publicDecimalPrice: row.publicDecimalPrice,
    ...(row.lineId ? { lineId: String(row.lineId) } : {}),
    period: String(row.period ?? 'UNKNOWN'),
  };
}
