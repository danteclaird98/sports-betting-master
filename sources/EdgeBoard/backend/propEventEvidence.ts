import { identity } from '../shared/accountSlip';
import type { PropObservation } from '../shared/propEvidence';

type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const mappings: Record<string, [string, string]> = {
  americanfootball_ncaaf: ['football', 'college-football'],
  americanfootball_nfl: ['football', 'nfl'],
  basketball_nba: ['basketball', 'nba'],
  basketball_wnba: ['basketball', 'wnba'],
  icehockey_nhl: ['hockey', 'nhl'],
  baseball_mlb: ['baseball', 'mlb'],
};
export type EventEvidence = {
  status: 'MATCHED' | 'NO_MATCH' | 'AMBIGUOUS' | 'UNAVAILABLE' | 'UNSUPPORTED';
  sourceUrl?: string;
  observedAt?: string;
  eventId?: string;
  eventState?: string;
  startTime?: string;
  roster: {
    status: 'MATCHED' | 'NO_MATCH' | 'AMBIGUOUS' | 'UNAVAILABLE';
    playerId?: string;
    team?: string;
    position?: string;
    rosterStatus?: string;
    sourceUrl?: string;
    observedAt?: string;
  };
};
export function matchingEvents(payload: unknown, observation: PropObservation) {
  const expectedTeams = observation.event
    .split(/\s*(?:@|\bvs\.?\b|\bat\b)\s*/i)
    .map(identity);
  if (expectedTeams.length !== 2 || new Set(expectedTeams).size !== 2)
    return [];
  return rows(object(payload).events).filter((event) => {
    const competition = rows(event.competitions)[0] ?? {};
    const actual = rows(competition.competitors).map((row) => object(row.team));
    const start = Date.parse(text(event.date ?? competition.date));
    const aliases = (team: Row) =>
      ['displayName', 'shortDisplayName', 'abbreviation'].map((field) =>
        identity(text(team[field])),
      );
    return (
      actual.length === 2 &&
      Number.isFinite(start) &&
      Math.abs(start - Date.parse(observation.startTime)) <= 60_000 &&
      ((aliases(actual[0]).includes(expectedTeams[0]) &&
        aliases(actual[1]).includes(expectedTeams[1])) ||
        (aliases(actual[1]).includes(expectedTeams[0]) &&
          aliases(actual[0]).includes(expectedTeams[1])))
    );
  });
}
export function rosterPlayers(
  payload: unknown,
  player: string,
  season: number,
  teamId: string,
) {
  const root = object(payload);
  if (
    Number(object(root.season).year) !== season ||
    text(object(root.team).id) !== teamId
  )
    return [];
  const athletes = rows(root.athletes).flatMap((group) =>
    Array.isArray(group.items) ? rows(group.items) : [group],
  );
  return athletes.filter(
    (row) =>
      [row.displayName, row.fullName].some(
        (name) => identity(text(name)) === identity(player),
      ) && /^\d+$/.test(text(row.id)),
  );
}
const cache = new Map<
  string,
  { data: unknown; observedAt: string; at: number }
>();
const pending = new Map<
  string,
  Promise<{ data: unknown; observedAt: string; at: number }>
>();
async function getSource(url: string) {
  const saved = cache.get(url);
  if (saved && Date.now() - saved.at < 15_000) return saved;
  const running = pending.get(url);
  if (running) return running;
  const request = (async () => {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Error('Independent context unavailable.');
    const data: unknown = await response.json();
    const result = {
      data,
      observedAt: new Date().toISOString(),
      at: Date.now(),
    };
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    cache.set(url, result);
    return result;
  })();
  pending.set(url, request);
  try {
    return await request;
  } finally {
    pending.delete(url);
  }
}
export async function loadEventEvidence(
  observation: PropObservation,
): Promise<EventEvidence> {
  const mapping = mappings[observation.sport];
  if (!mapping)
    return { status: 'UNSUPPORTED', roster: { status: 'UNAVAILABLE' } };
  const root = `https://site.api.espn.com/apis/site/v2/sports/${mapping[0]}/${mapping[1]}`;
  // Scoreboard dates follow local competition days, which can precede UTC kickoff.
  const kickoff = Date.parse(observation.startTime);
  const day = (offset: number) =>
    new Date(kickoff + offset * 86400000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
  const sourceUrls = [day(-1), day(0)].map(
    (dates) =>
      root +
      '/scoreboard?' +
      new URLSearchParams({
        dates,
        limit: '1000',
        ...(observation.sport === 'americanfootball_ncaaf'
          ? { groups: '80' }
          : {}),
      }),
  );
  let sourceUrl = sourceUrls[0];
  try {
    const sources = await Promise.all(
      sourceUrls.map(async (url) => ({ ...(await getSource(url)), url })),
    );
    const matches = [
      ...new Map(
        sources.flatMap((source) =>
          matchingEvents(source.data, observation).map(
            (event) => [text(event.id), { event, source }] as const,
          ),
        ),
      ).values(),
    ];
    if (matches.length !== 1 || !text(matches[0].event.id))
      return {
        status: matches.length ? 'AMBIGUOUS' : 'NO_MATCH',
        sourceUrl,
        observedAt: sources[0].observedAt,
        roster: { status: 'UNAVAILABLE' },
      };
    const { event, source } = matches[0];
    sourceUrl = source.url;
    const competition = rows(event.competitions)[0] ?? {};
    const teams = rows(competition.competitors).map((row) => object(row.team));
    const season = Number(object(event.season).year);
    const result: EventEvidence = {
      status: 'MATCHED',
      sourceUrl,
      observedAt: source.observedAt,
      eventId: text(event.id),
      eventState: text(
        object(object(event.status ?? competition.status).type).state,
      ),
      startTime: text(event.date ?? competition.date),
      roster: { status: 'UNAVAILABLE' },
    };
    if (
      !Number.isInteger(season) ||
      season < 2000 ||
      season > 2100 ||
      teams.some((team) => !/^\d+$/.test(text(team.id)))
    )
      return result;
    const fetched = await Promise.allSettled(
      teams.map(async (team) => {
        const url =
          root + '/teams/' + text(team.id) + '/roster?season=' + season;
        const roster = await getSource(url);
        return {
          team,
          url,
          source: roster,
          athletes: rosterPlayers(
            roster.data,
            observation.player,
            season,
            text(team.id),
          ),
        };
      }),
    );
    const rosterMatches = fetched.flatMap((entry) =>
      entry.status === 'fulfilled'
        ? entry.value.athletes.map((athlete) => ({ athlete, ...entry.value }))
        : [],
    );
    if (
      rosterMatches.length === 1 &&
      fetched.every((entry) => entry.status === 'fulfilled')
    ) {
      const match = rosterMatches[0];
      result.roster = {
        status: 'MATCHED',
        playerId: text(match.athlete.id),
        team: text(match.team.displayName),
        position: text(object(match.athlete.position).abbreviation),
        rosterStatus: text(object(match.athlete.status).name),
        sourceUrl: match.url,
        observedAt: match.source.observedAt,
      };
    } else
      result.roster = {
        status: fetched.some((entry) => entry.status === 'rejected')
          ? 'UNAVAILABLE'
          : rosterMatches.length
            ? 'AMBIGUOUS'
            : 'NO_MATCH',
      };
    return result;
  } catch {
    return {
      status: 'UNAVAILABLE',
      sourceUrl,
      roster: { status: 'UNAVAILABLE' },
    };
  }
}
