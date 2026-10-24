import { secrets } from '@appdeploy/sdk';

export type ContextHealth = {
  id: string;
  name: string;
  status: 'active' | 'unconfigured' | 'exhausted' | 'error' | 'partial' | 'public';
  detail: string;
  eventCount: number;
};

export type GameContextItem = {
  source: string;
  type: 'injury' | 'weather' | 'odds';
  event: string | null;
  team: string | null;
  headline: string;
  detail: string;
  updatedAt: string | null;
};

type InputEvent = { event?: string; commenceTime?: string };
type GenericRow = Record<string, unknown>;

const stadiums: Record<string, { lat: number; lon: number; indoor?: boolean }> = {
  'Buffalo Bills': { lat: 42.774, lon: -78.787 },
  'Chicago Bears': { lat: 41.863, lon: -87.617 },
  'New England Patriots': { lat: 42.091, lon: -71.264 },
  'Baltimore Ravens': { lat: 39.278, lon: -76.623 },
  'Tennessee Titans': { lat: 36.166, lon: -86.771 },
  'New York Jets': { lat: 40.813, lon: -74.074 },
  'Atlanta Falcons': { lat: 33.755, lon: -84.401, indoor: true },
  'Tampa Bay Buccaneers': { lat: 27.976, lon: -82.503 },
  'Denver Broncos': { lat: 39.744, lon: -105.020 },
  'Los Angeles Chargers': { lat: 33.953, lon: -118.339, indoor: true },
  'Dallas Cowboys': { lat: 32.748, lon: -97.093, indoor: true },
  'Arizona Cardinals': { lat: 33.528, lon: -112.263, indoor: true },
  'San Francisco 49ers': { lat: 37.403, lon: -121.970 },
  'Kansas City Chiefs': { lat: 39.049, lon: -94.484 },
  'Los Angeles Rams': { lat: 33.953, lon: -118.339, indoor: true },
};

function rows(value: unknown): GenericRow[] {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object') as GenericRow[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of ['data', 'results', 'injuries', 'odds', 'games']) {
    if (Array.isArray(record[key])) return record[key] as GenericRow[];
  }
  return [];
}

function text(row: GenericRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function clearSportsItems(injuries: GenericRow[], odds: GenericRow[]) {
  const items: GameContextItem[] = injuries.slice(0, 18).map(row => {
    const player = text(row, ['player_name', 'player', 'name']) ?? 'NFL player';
    const team = text(row, ['team_name', 'team', 'team_abbreviation', 'team_id']);
    const status = text(row, ['status', 'injury_status', 'game_status', 'practice_status']) ?? 'injury report';
    const injury = text(row, ['injury', 'injury_type', 'body_part', 'description', 'note']) ?? 'No additional detail';
    return { source: 'ClearSports', type: 'injury', event: null, team, headline: `${player} · ${status}`, detail: injury, updatedAt: text(row, ['updated_at', 'last_updated', 'timestamp']) };
  });
  if (odds.length) items.unshift({ source: 'ClearSports', type: 'odds', event: null, team: null, headline: `${odds.length} NFL odds rows available`, detail: 'Independent odds context is connected. EdgeBoard keeps sportsbook consensus de-duplicated by book before labeling an edge.', updatedAt: new Date().toISOString() });
  return items;
}

async function clearSports() {
  const names = await secrets.listSecretNames();
  if (!names.includes('CLEARSPORTS_API_KEY')) return {
    items: [] as GameContextItem[],
    health: { id: 'clearsports', name: 'ClearSports', status: 'unconfigured' as const, detail: 'Add the free key to activate NFL injuries and independent odds context.', eventCount: 0 },
  };
  const key = (await secrets.readSecret('CLEARSPORTS_API_KEY')).trim();
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  try {
    const [injuryResponse, oddsResponse] = await Promise.all([
      fetch('https://api.clearsportsapi.com/api/v1/nfl/injury-stats', { headers }),
      fetch('https://api.clearsportsapi.com/api/v1/nfl/game-odds', { headers }),
    ]);
    const injuryRows = injuryResponse.ok ? rows(await injuryResponse.json() as unknown) : [];
    const oddsRows = oddsResponse.ok ? rows(await oddsResponse.json() as unknown) : [];
    if (!injuryResponse.ok && !oddsResponse.ok) {
      const exhausted = injuryResponse.status === 403 || oddsResponse.status === 403;
      return { items: [] as GameContextItem[], health: { id: 'clearsports', name: 'ClearSports', status: exhausted ? 'exhausted' as const : 'error' as const, detail: `Injuries HTTP ${injuryResponse.status} · odds HTTP ${oddsResponse.status}.`, eventCount: 0 } };
    }
    return { items: clearSportsItems(injuryRows, oddsRows), health: { id: 'clearsports', name: 'ClearSports', status: 'active' as const, detail: `Injuries ${injuryResponse.ok ? 'active' : 'unavailable'} · odds ${oddsResponse.ok ? 'active' : 'unavailable'}.`, eventCount: Math.max(injuryRows.length, oddsRows.length) } };
  } catch {
    return { items: [] as GameContextItem[], health: { id: 'clearsports', name: 'ClearSports', status: 'error' as const, detail: 'Could not reach ClearSports. Other sources remain available.', eventCount: 0 } };
  }
}

function parseEvent(value?: string) {
  if (!value?.includes(' @ ')) return null;
  const [away, home] = value.split(' @ ');
  return away && home ? { away, home } : null;
}

async function weatherItem(input: InputEvent): Promise<GameContextItem | null> {
  const teams = parseEvent(input.event);
  if (!teams || !input.commenceTime) return null;
  const stadium = stadiums[teams.home];
  if (!stadium) return null;
  if (stadium.indoor) return { source: 'Open-Meteo', type: 'weather', event: input.event ?? null, team: teams.home, headline: 'Indoor / retractable-roof venue', detail: 'Weather is unlikely to be a primary line driver unless the roof plan changes.', updatedAt: new Date().toISOString() };
  const params = new URLSearchParams({ latitude: String(stadium.lat), longitude: String(stadium.lon), timezone: 'UTC', forecast_days: '2', hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m', temperature_unit: 'fahrenheit', wind_speed_unit: 'mph' });
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) return null;
    const payload = await response.json() as { hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: number[]; wind_speed_10m?: number[]; wind_gusts_10m?: number[] } };
    const hourly = payload.hourly;
    if (!hourly?.time?.length) return null;
    const kickoff = Date.parse(input.commenceTime);
    let best = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    hourly.time.forEach((time, index) => {
      const diff = Math.abs(Date.parse(`${time}Z`) - kickoff);
      if (diff < bestDiff) { best = index; bestDiff = diff; }
    });
    const temp = hourly.temperature_2m?.[best];
    const rain = hourly.precipitation_probability?.[best];
    const wind = hourly.wind_speed_10m?.[best];
    const gust = hourly.wind_gusts_10m?.[best];
    return { source: 'Open-Meteo', type: 'weather', event: input.event ?? null, team: teams.home, headline: `${typeof temp === 'number' ? `${Math.round(temp)}°F` : 'Kickoff weather'} · ${typeof wind === 'number' ? `${Math.round(wind)} mph wind` : 'wind n/a'}`, detail: `${typeof rain === 'number' ? `${Math.round(rain)}% precip` : 'precip n/a'}${typeof gust === 'number' ? ` · gusts ${Math.round(gust)} mph` : ''}`, updatedAt: new Date().toISOString() };
  } catch { return null; }
}

export async function getNflResearchContext(input: { mode?: string; events?: InputEvent[] }, allowProviderRequests = false) {
  if (input.mode === 'demo') return {
    generatedAt: new Date().toISOString(),
    health: [
      { id: 'clearsports', name: 'ClearSports', status: 'active' as const, detail: 'NFL injuries and independent odds context active.', eventCount: 8 },
      { id: 'weather', name: 'Open-Meteo', status: 'public' as const, detail: 'Kickoff weather context active.', eventCount: 2 },
    ],
    items: [
      { source: 'Open-Meteo', type: 'weather' as const, event: 'Indianapolis Colts @ Kansas City Chiefs', team: 'Kansas City Chiefs', headline: '66°F · 9 mph wind', detail: '20% precip · gusts 17 mph', updatedAt: new Date().toISOString() },
      { source: 'ClearSports', type: 'injury' as const, event: null, team: 'Kansas City Chiefs', headline: 'Sample starter · questionable', detail: 'Demo injury context only', updatedAt: new Date().toISOString() },
    ],
  };
  const events = input.events ?? [];
  const clearRequest = allowProviderRequests ? clearSports() : Promise.resolve({
    items: [] as GameContextItem[],
    health: { id: 'clearsports', name: 'ClearSports', status: 'unconfigured' as const, detail: 'Optional keyed context is disabled for public requests; no provider quota used.', eventCount: 0 },
  });
  const [clear, weatherRows] = await Promise.all([clearRequest, Promise.all(events.slice(0, 10).map(weatherItem))]);
  const weather = weatherRows.filter((item): item is GameContextItem => item !== null);
  const weatherHealth: ContextHealth = { id: 'weather', name: 'Open-Meteo', status: weather.length ? 'public' : 'partial', detail: weather.length ? 'Kickoff weather/venue context active for current edge candidates.' : 'No weather candidates matched the current edge list.', eventCount: weather.length };
  return { generatedAt: new Date().toISOString(), health: [clear.health, weatherHealth], items: [...weather, ...clear.items] };
}
