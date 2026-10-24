import { secrets } from '@appdeploy/sdk';
import type { NormalizedOddsEvent, ProviderHealth } from './altOdds';

export type GameContext = {
  event: string;
  weather: string | null;
  injuries: string[];
};

type Stadium = {
  lat: number;
  lon: number;
  covered: boolean;
  label: string;
};

const stadiums: Record<string, Stadium> = {
  buffalobills: { lat: 42.774, lon: -78.787, covered: false, label: 'Buffalo' },
  chicagobears: { lat: 41.863, lon: -87.617, covered: false, label: 'Chicago' },
  newenglandpatriots: { lat: 42.091, lon: -71.264, covered: false, label: 'Foxborough' },
  baltimoreravens: { lat: 39.278, lon: -76.623, covered: false, label: 'Baltimore' },
  tennesseetitans: { lat: 36.166, lon: -86.771, covered: false, label: 'Nashville' },
  newyorkjets: { lat: 40.813, lon: -74.074, covered: false, label: 'East Rutherford' },
  atlantafalcons: { lat: 33.755, lon: -84.401, covered: true, label: 'Atlanta retractable roof' },
  tampabaybuccaneers: { lat: 27.976, lon: -82.503, covered: false, label: 'Tampa' },
  denverbroncos: { lat: 39.744, lon: -105.020, covered: false, label: 'Denver' },
  losangeleschargers: { lat: 33.953, lon: -118.339, covered: true, label: 'SoFi Stadium covered venue' },
  dallascowboys: { lat: 32.748, lon: -97.093, covered: true, label: 'Dallas retractable roof' },
  arizonacardinals: { lat: 33.528, lon: -112.263, covered: true, label: 'Arizona retractable roof' },
  sanfrancisco49ers: { lat: 37.403, lon: -121.970, covered: false, label: 'Santa Clara' },
  kansascitychiefs: { lat: 39.049, lon: -94.484, covered: false, label: 'Kansas City' },
  losangelesrams: { lat: 33.953, lon: -118.339, covered: true, label: 'SoFi Stadium covered venue' },
};

const teamAliases: Record<string, string[]> = {
  detroitlions: ['detroitlions', 'det', 'nfldet'], buffalobills: ['buffalobills', 'buf', 'nflbuf'],
  minnesotavikings: ['minnesotavikings', 'min', 'nflmin'], chicagobears: ['chicagobears', 'chi', 'nflchi'],
  pittsburghsteelers: ['pittsburghsteelers', 'pit', 'nflpit'], newenglandpatriots: ['newenglandpatriots', 'ne', 'nflne'],
  neworleanssaints: ['neworleanssaints', 'no', 'nflno'], baltimoreravens: ['baltimoreravens', 'bal', 'nflbal'],
  philadelphiaeagles: ['philadelphiaeagles', 'phi', 'nflphi'], tennesseetitans: ['tennesseetitans', 'ten', 'nflten'],
  greenbaypackers: ['greenbaypackers', 'gb', 'nflgb'], newyorkjets: ['newyorkjets', 'nyj', 'nflnyj'],
  carolinapanthers: ['carolinapanthers', 'car', 'nflcar'], atlantafalcons: ['atlantafalcons', 'atl', 'nflatl'],
  clevelandbrowns: ['clevelandbrowns', 'cle', 'nflcle'], tampabaybuccaneers: ['tampabaybuccaneers', 'tb', 'nfltb'],
  jacksonvillejaguars: ['jacksonvillejaguars', 'jax', 'nfljax'], denverbroncos: ['denverbroncos', 'den', 'nflden'],
  lasvegasraiders: ['lasvegasraiders', 'lv', 'nfllv'], losangeleschargers: ['losangeleschargers', 'lac', 'nfllac'],
  washingtoncommanders: ['washingtoncommanders', 'was', 'nflwas'], dallascowboys: ['dallascowboys', 'dal', 'nfldal'],
  seattleseahawks: ['seattleseahawks', 'sea', 'nflsea'], arizonacardinals: ['arizonacardinals', 'ari', 'nflari'],
  miamidolphins: ['miamidolphins', 'mia', 'nflmia'], sanfrancisco49ers: ['sanfrancisco49ers', 'sf', 'nflsf'],
  indianapoliscolts: ['indianapoliscolts', 'ind', 'nflind'], kansascitychiefs: ['kansascitychiefs', 'kc', 'nflkc'],
  newyorkgiants: ['newyorkgiants', 'nyg', 'nflnyg'], losangelesrams: ['losangelesrams', 'lar', 'nfllar'],
};

function normalize(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (isRecord(value)) {
      const nested = value.name ?? value.full_name ?? value.abbreviation ?? value.id;
      if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
  }
  return '';
}

function rowsFrom(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ['data', 'results', 'injuries', 'items']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function rowMatchesTeam(row: Record<string, unknown>, team?: string) {
  if (!team) return false;
  const target = normalize(team);
  const aliases = teamAliases[target] ?? [target];
  const candidate = normalize(getString(row, ['team_name', 'team', 'team_id', 'team_abbreviation', 'team_abbr']));
  return aliases.some(alias => candidate === alias || candidate.includes(alias) || alias.includes(candidate));
}

function injuryLabel(row: Record<string, unknown>) {
  const player = getString(row, ['player_name', 'player', 'name', 'athlete_name']) || 'Player';
  const status = getString(row, ['status', 'injury_status', 'designation', 'practice_status']) || 'injury listed';
  const issue = getString(row, ['injury', 'injury_description', 'body_part', 'injury_type']);
  return `${player}: ${status}${issue ? ` · ${issue}` : ''}`;
}

function isNotable(row: Record<string, unknown>) {
  const status = normalize(getString(row, ['status', 'injury_status', 'designation', 'practice_status']));
  return ['out', 'doubtful', 'questionable', 'injuredreserve', 'ir', 'pup'].some(term => status.includes(term));
}

async function fetchClearSportsInjuries(events: NormalizedOddsEvent[]) {
  const names = await secrets.listSecretNames();
  if (!names.includes('CLEARSPORTS_API_KEY')) {
    return {
      health: { id: 'clearsports', name: 'ClearSports', status: 'unconfigured' as const, detail: 'Optional injury/context feed. Add a free key to attach NFL injury reports to each game.', eventCount: 0, bookCount: 0 },
      byEvent: new Map<string, string[]>(),
    };
  }
  try {
    const key = (await secrets.readSecret('CLEARSPORTS_API_KEY')).trim();
    const response = await fetch('https://api.clearsportsapi.com/api/v1/nfl/injury-stats', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!response.ok) {
      return {
        health: { id: 'clearsports', name: 'ClearSports', status: response.status === 403 ? 'exhausted' as const : 'error' as const, detail: response.status === 401 ? 'The saved ClearSports key was rejected (HTTP 401). Injury context is disabled until that key is replaced; odds consensus and weather still run independently.' : `Injury feed returned HTTP ${response.status}; EdgeBoard excluded it from context.`, eventCount: 0, bookCount: 0 },
        byEvent: new Map<string, string[]>(),
      };
    }
    const rows = rowsFrom(await response.json());
    const byEvent = new Map<string, string[]>();
    for (const event of events) {
      const keyName = `${event.away_team ?? 'Away'} @ ${event.home_team ?? 'Home'}`;
      const matching = rows.filter(row => rowMatchesTeam(row, event.away_team) || rowMatchesTeam(row, event.home_team));
      const notable = matching.filter(isNotable).slice(0, 5).map(injuryLabel);
      if (notable.length) byEvent.set(keyName, notable);
    }
    return {
      health: { id: 'clearsports', name: 'ClearSports', status: rows.length ? 'active' as const : 'partial' as const, detail: rows.length ? `NFL injury context active · ${rows.length} injury rows received.` : 'Connected, but no NFL injury rows were returned.', eventCount: rows.length, bookCount: 0 },
      byEvent,
    };
  } catch {
    return {
      health: { id: 'clearsports', name: 'ClearSports', status: 'error' as const, detail: 'NFL injury context could not be refreshed. Odds consensus still runs independently.', eventCount: 0, bookCount: 0 },
      byEvent: new Map<string, string[]>(),
    };
  }
}

async function weatherForEvent(event: NormalizedOddsEvent) {
  const homeKey = normalize(event.home_team);
  const stadium = stadiums[homeKey];
  if (!stadium || !event.commence_time) return null;
  if (stadium.covered) return `${stadium.label}: roof/covered venue, so wind and precipitation should have limited direct field impact.`;
  try {
    const params = new URLSearchParams({
      latitude: String(stadium.lat), longitude: String(stadium.lon),
      hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m',
      temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'UTC', forecast_days: '3',
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) return null;
    const payload = await response.json() as { hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; wind_speed_10m?: number[]; wind_gusts_10m?: number[] } };
    const hourly = payload.hourly;
    if (!hourly?.time?.length) return null;
    const kickoff = Date.parse(event.commence_time);
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    hourly.time.forEach((time, index) => {
      const millis = Date.parse(time.endsWith('Z') ? time : `${time}Z`);
      const distance = Math.abs(millis - kickoff);
      if (Number.isFinite(millis) && distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    const temp = hourly.temperature_2m?.[bestIndex];
    const rain = hourly.precipitation_probability?.[bestIndex];
    const wind = hourly.wind_speed_10m?.[bestIndex];
    const gust = hourly.wind_gusts_10m?.[bestIndex];
    return `${stadium.label}: ${typeof temp === 'number' ? `${Math.round(temp)}°F` : 'temperature n/a'} · precipitation ${typeof rain === 'number' ? `${Math.round(rain)}%` : 'n/a'} · wind ${typeof wind === 'number' ? `${Math.round(wind)} mph` : 'n/a'}${typeof gust === 'number' ? `, gusts ${Math.round(gust)} mph` : ''}.`;
  } catch {
    return null;
  }
}

export async function fetchNflGameContext(events: NormalizedOddsEvent[], allowProviderRequests = false) {
  const injuries = allowProviderRequests ? await fetchClearSportsInjuries(events) : {
    health: { id: 'clearsports', name: 'ClearSports', status: 'unconfigured' as const, detail: 'Optional keyed context is disabled for public scans; no provider quota used.', eventCount: 0, bookCount: 0 },
    byEvent: new Map<string, string[]>(),
  };
  const weatherResults = await Promise.all(events.map(async event => ({ event: `${event.away_team ?? 'Away'} @ ${event.home_team ?? 'Home'}`, weather: await weatherForEvent(event) })));
  const weatherCount = weatherResults.filter(item => item.weather).length;
  const contexts: GameContext[] = weatherResults.map(item => ({ event: item.event, weather: item.weather, injuries: injuries.byEvent.get(item.event) ?? [] })).filter(item => item.weather || item.injuries.length);
  const weatherHealth: ProviderHealth = { id: 'weather', name: 'Open-Meteo weather', status: weatherCount ? 'public' : 'partial', detail: weatherCount ? `Public kickoff weather/venue context active for ${weatherCount} games.` : 'No kickoff weather context was available for the matched games.', eventCount: weatherCount, bookCount: 0 };
  return { gameContext: contexts, providerHealth: [injuries.health as ProviderHealth, weatherHealth] };
}
