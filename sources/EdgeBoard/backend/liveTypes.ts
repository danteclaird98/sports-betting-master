export type Row = Record<string, unknown>;
export const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
export const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
export const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'number' ? value : Date.parse(String(value));
  const time = typeof value === 'number' && value < 1e12 ? value * 1000 : raw;
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null;
}
export type LiveTeam = { id: string; name: string; shortName: string; abbreviation: string; score: number | null };
export type LiveGame = {
  id: string; event: string; startTime: string; season: number; week: number | null;
  state: string; phase: 'pregame' | 'first_half' | 'halftime' | 'second_half' | 'final' | 'unknown';
  period: number | null; clock: string; status: string; home: LiveTeam; away: LiveTeam;
};
export type LivePlayer = {
  espnId: string; name: string; team: string; teamId: string;
  receptions: number | null; targets: number | null; receivingYards: number | null;
};
export type LiveQuote = {
  id: string; provider: string; book: string; eventId: string; providerEventId: string;
  event: string; player: string | null; playerId: string | null; market: string;
  side: string; line: number | null; period: string; decimalOdds: number | null;
  americanOdds: number | null; entryMultiplier: number | null;
  retrievedAt: string; oddsAt: string | null; ageSeconds: number | null;
  timestampBasis: string; status: string; settlementRules: string | null;
  accountAvailabilityVerified: false; modelProbability: number | null;
};
export function effectiveQuoteAge(quote:LiveQuote,now=Date.now()):number|null {
  if(quote.oddsAt){const at=Date.parse(quote.oddsAt);return Number.isFinite(at)?(now-at)/1000:null;}
  const observed=Date.parse(quote.retrievedAt);
  return quote.ageSeconds!==null&&Number.isFinite(observed)?quote.ageSeconds+(now-observed)/1000:null;
}
export const teamMatches = (value: string, team: LiveTeam) =>
  [team.name, team.shortName, team.abbreviation].some(name => normalizeName(name) === normalizeName(value));
export function matchTeams(home: string, away: string, game: LiveGame) {
  return Boolean(home && away && teamMatches(home, game.home) && teamMatches(away, game.away));
}
export function normalizePeriod(value: unknown): string {
  const period = text(value).toUpperCase().replace(/[ _-]/g, '');
  if (['2H', 'H2', '2NDHALF', 'SECONDHALF'].includes(period)) return '2H';
  if (['1H', 'H1', '1STHALF', 'FIRSTHALF'].includes(period)) return '1H';
  if (['FT', 'FULL', 'FULLGAME', 'GAME'].includes(period)) return 'FULL';
  if (/^Q[1-4]$/.test(period)) return period;
  return 'UNKNOWN';
}
