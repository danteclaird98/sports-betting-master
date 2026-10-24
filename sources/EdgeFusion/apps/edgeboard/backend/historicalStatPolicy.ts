/** Signed yardage is an outcome, not an eligibility failure. */
export function parseHistoricalValue(market: string, raw: string): number | null {
  if (!['receiving_yards', 'rushing_yards', 'passing_yards', 'receptions'].includes(market) || !raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || (market === 'receptions' && (!Number.isInteger(value) || value < 0))) return null;
  return value;
}

export function validateHistoricalRows(rows: Array<{id: string;season: number;week: number;game: string}>) {
  const weeks = new Set<string>(), games = new Set<string>();
  for (const r of rows) {
    const player = r.id.split('|')[0];
    if (!player || !Number.isInteger(r.season) || !Number.isInteger(r.week) || r.week < 1 || r.week > 18
      || !r.game.startsWith(r.season + '_' + String(r.week).padStart(2, '0') + '_')) throw Error('Historical player/game identity mismatch.');
    const week = player + '|' + r.season + '|' + r.week, game = player + '|' + r.game;
    if (weeks.has(week) || games.has(game)) throw Error('Duplicate player-week or player-game; source must be reconciled.');
    weeks.add(week); games.add(game);
  }
}
