import { object, rows, text, numeric, iso, type LiveGame, type LivePlayer, type Row } from './liveTypes';

const ROOT = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const cache = new Map<string, { at: number; data: unknown }>();
const pending = new Map<string, Promise<unknown>>();
async function get(url: string, forceRefresh = false) {
  const cached = cache.get(url);
  if (!forceRefresh && cached && Date.now() - cached.at < 15_000) return cached;
  let request = pending.get(url);
  if (!request) {
    request = (async () => {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw Error('Live ESPN source returned HTTP ' + response.status);
      const data: unknown = await response.json();
      const value = { at: Date.now(), data };
      cache.set(url, value);
      return value;
    })();
    pending.set(url, request);
  }
  try { return await request as { at: number; data: unknown }; }
  finally { pending.delete(url); }
}
function team(competitor: Row) {
  const info = object(competitor.team);
  return { id: text(info.id), name: text(info.displayName), shortName: text(info.shortDisplayName),
    abbreviation: text(info.abbreviation), score: numeric(competitor.score) };
}
export function normalizeLiveGame(event: Row, season: number, week: number | null): LiveGame | null {
  const competition = rows(event.competitions)[0];
  if (!competition) return null;
  const competitors = rows(competition.competitors);
  const home = competitors.find(row => row.homeAway === 'home');
  const away = competitors.find(row => row.homeAway === 'away');
  const status = object(event.status ?? competition.status);
  const type = object(status.type);
  const state = text(type.state);
  const label = [text(type.name), text(type.description), text(type.detail)].join(' ');
  const period = numeric(status.period);
  const rawClock = numeric(status.clock);
  const displayClock = text(status.displayClock);
  const clockKnown = rawClock !== null || displayClock !== '';
  const zeroClock = (rawClock === null || rawClock === 0)
    && (displayClock === '' || /^0*:0{2}$/.test(displayClock));
  // ESPN may omit the clock during an explicit halftime status. A positive or
  // contradictory clock still blocks it; elapsed wall time never proves halftime.
  const halftime = /HALFTIME|HALF TIME/i.test(label) && state === 'in' && period === 2
    && (!clockKnown || zeroClock);
  const phase: LiveGame['phase'] = type.completed === true || state === 'post' ? 'final'
    : halftime ? 'halftime' : state === 'pre' ? 'pregame'
    : state === 'in' && period !== null ? period <= 2 ? 'first_half' : 'second_half' : 'unknown';
  const startTime = iso(event.date ?? competition.date);
  if (!home || !away || !startTime || !text(event.id)) return null;
  return { id: text(event.id), event: text(event.name) || team(away).name + ' at ' + team(home).name,
    startTime, season, week, state, phase, period, clock: text(status.displayClock),
    status: text(type.detail) || text(type.description), home: team(home), away: team(away) };
}
export function currentLosAngelesDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
}
export async function liveScoreboard(date = currentLosAngelesDate()) {
  if (!/^20\d{6}$/.test(date)) throw Error('Use a date formatted YYYYMMDD.');
  const url = ROOT + '/scoreboard?dates=' + date;
  const snapshot = await get(url);
  const data = object(snapshot.data);
  const fallbackSeason = numeric(object(data.season).year) ?? Number(date.slice(0, 4));
  const games = rows(data.events).map(event => normalizeLiveGame(event,
    numeric(object(event.season).year) ?? fallbackSeason, numeric(object(event.week).number) ?? numeric(object(data.week).number)))
    .filter((game): game is LiveGame => game !== null);
  games.sort((a, b) => Number(['first_half','halftime','second_half'].includes(b.phase)) - Number(['first_half','halftime','second_half'].includes(a.phase)) || Date.parse(a.startTime) - Date.parse(b.startTime));
  return { games, date, source: 'ESPN public scoreboard', sourceUrl: url,
    retrievedAt: new Date(snapshot.at).toISOString(), providerTimestamp: iso(data.timestamp),
    observationAgeSeconds: (Date.now()-snapshot.at)/1000, providerLatencyVerified: false,
    providerCreditsUsed: 0, emptyMeans: 'No returned games for this date; not proof that the source covers every game.' };
}
export function normalizeLivePlayers(data: Row): LivePlayer[] {
  const out: LivePlayer[] = [];
  for (const section of rows(object(data.boxscore).players)) {
    const teamInfo = object(section.team);
    const receiving = rows(section.statistics).find(stat => stat.name === 'receiving');
    if (!receiving || !Array.isArray(receiving.keys)) continue;
    const keys = receiving.keys.map(String);
    for (const row of rows(receiving.athletes)) {
      const athlete = object(row.athlete);
      const stats = Array.isArray(row.stats) ? row.stats : [];
      const stat = (name: string) => keys.indexOf(name) >= 0 ? numeric(stats[keys.indexOf(name)]) : null;
      out.push({ espnId: text(athlete.id), name: text(athlete.displayName), team: text(teamInfo.abbreviation), teamId: text(teamInfo.id),
        receptions: stat('receptions'), targets: stat('receivingTargets'), receivingYards: stat('receivingYards') });
    }
  }
  return out;
}
export async function liveGame(eventId: string, forceRefresh = false) {
  if (!/^\d{6,12}$/.test(eventId)) throw Error('A verified ESPN game ID is required.');
  const url = ROOT + '/summary?event=' + encodeURIComponent(eventId);
  const snapshot = await get(url, forceRefresh);
  const data = object(snapshot.data);
  const header = object(data.header);
  const competition = rows(header.competitions)[0] ?? {};
  const game = normalizeLiveGame({ ...header, status: competition.status },
    numeric(object(header.season).year) ?? new Date().getUTCFullYear(), numeric(object(header.week).number));
  if (!game || game.id !== eventId) throw Error('ESPN game identity was not confirmed.');
  const injuries = rows(data.injuries).flatMap(section => rows(section.injuries).map(item => ({
    player: text(object(item.athlete).displayName), status: text(item.status),
    note: text(item.shortComment), reportAt: iso(item.date),
  })));
  return { game, players: normalizeLivePlayers(data), injuries,
    injuryStatusVerified: false, missingPlayerMeansZero: false,
    source: 'ESPN public game summary', sourceUrl: url, retrievedAt: new Date(snapshot.at).toISOString(),
    observationAgeSeconds: (Date.now()-snapshot.at)/1000, providerLatencyVerified: false,
    playerStatsScope: game.phase === 'halftime' ? 'completed_first_half' : 'full_game_to_current_clock',
    providerCreditsUsed: 0 };
}
