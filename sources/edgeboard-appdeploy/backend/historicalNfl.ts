export const HISTORICAL_NFL_SOURCE = 'https://github.com/nflverse/nfldata/raw/refs/heads/master/data/games.csv';
const SOURCE = HISTORICAL_NFL_SOURCE;
export function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(Boolean)) out.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
export async function inspectHistoricalNfl() {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('Historical source unavailable: ' + response.status);
  const text = await response.text();
  if (text.length > 10000000) throw Error('Historical file exceeds inspection limit');
  const parsed = csvRows(text);
  const [headers, ...data] = parsed;
  if (!headers || data.length < 100) throw Error('Insufficient verified historical game rows');
  const columns = ['game_id','season','gameday','home_team','away_team','home_score','away_score','home_moneyline','away_moneyline'];
  const indices = Object.fromEntries(columns.map(k => [k, headers.indexOf(k)]));
  const years = data.map(row => Number(row[indices.season])).filter(Number.isFinite);
  const scored = data.filter(row => indices.home_score >= 0 && indices.away_score >= 0 && Number.isFinite(Number(row[indices.home_score])) && row[indices.home_score] !== '' && row[indices.away_score] !== '');
  const withPrices = data.filter(row => indices.home_moneyline >= 0 && indices.away_moneyline >= 0 && row[indices.home_moneyline] !== '' && row[indices.away_moneyline] !== '');
  return { source: SOURCE, fetchedAt: new Date().toISOString(), rows: data.length,
    seasons: years.length ? [Math.min(...years), Math.max(...years)] : [],
    columnsPresent: columns.filter(k => indices[k] >= 0), columnsMissing: columns.filter(k => indices[k] < 0),
    scoredGames: scored.length, rowsWithMoneylines: withPrices.length,
    sourceVerified: false, bookmakerAndQuoteTimestampVerified: false,
    modelReady: false, note: 'Historical source inspection only. No fit, no point-in-time price guarantee, no Caesars-specific historical EV.' };
}
