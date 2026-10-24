import { secrets } from '@appdeploy/sdk';
import { scanNflKymGameLines } from './gameLines';
import { scanFreeUnderdog } from './freeUnderdog';
import { evaluateResearch, type ResearchResult } from './researchControls';

type PropRow = {
  event_id?: string;
  canonical_event_id?: string;
  sport_key?: string;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  player?: string;
  player_name?: string;
  market_key?: string;
  market?: string;
  market_label?: string;
  line?: number;
  over_price?: number | null;
  under_price?: number | null;
  over_multiplier?: number | null;
  under_multiplier?: number | null;
  higher_multiplier?: number | null;
  lower_multiplier?: number | null;
  bookmaker?: string;
  bookmaker_title?: string;
  last_update?: string | number;
  age_seconds?: number;
  stale_seconds?: number;
  period?: string;
};

type Edge = {
  id: string;
  event: string;
  commenceTime: string;
  timing: 'pregame' | 'live';
  player: string;
  market: string;
  marketLabel: string;
  side: 'Higher' | 'Lower';
  line: number;
  underdogMultiplier: number | null;
  fairProbability: number;
  fairMultiplier: number;
  edgePct: number | null;
  roiPct: number | null;
  refs: string[];
  refCount: number;
  underdogAgeSeconds: number | null;
  breakEvenProbability: number | null;
  fairProbabilityLow: number;
  fairProbabilityHigh: number;
  consensusSpreadPct: number;
  lineMovement: 'strengthening' | 'weakening' | 'stable' | 'unknown';
  verification: 'verified' | 'thin' | 'pending';
  research?: ResearchResult;
};

type EdgeCandidate = Edge & {
  eventId: string;
  screenScore: number;
};

type MovementSeries = {
  source?: string;
  bookmaker?: string;
  player?: string;
  market_key?: string;
  line?: number;
  opening_over?: number | null;
  opening_under?: number | null;
  current_over?: number | null;
  current_under?: number | null;
  snapshots?: Array<{
    timestamp_ms?: number;
    time?: string;
    over_price?: number | null;
    under_price?: number | null;
  }>;
};

type KalshiMarket = {
  ticker?: string;
  title?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  status?: string;
  close_time?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
};

type KalshiReference = {
  ticker: string;
  title: string;
  yesProbability: number | null;
  closeTime: string | null;
};

const referenceBooks = new Set([
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'pinnacle',
  'bovada',
  'novig',
  'betrivers',
  'fanatics',
]);

const excludedDfs = new Set([
  'underdog',
  'prizepicks',
  'sleeper',
  'betr',
  'pick6',
]);

const kalshiCompetition: Record<string, string> = {
  baseball_mlb: 'Pro Baseball',
  americanfootball_nfl: 'Pro Football',
  americanfootball_ncaaf: 'College Football',
  basketball_nba: 'Pro Basketball (M)',
  icehockey_nhl: 'Pro Hockey',
};

const MAX_PREGAME_QUOTE_AGE_SECONDS = 15 * 60;
const MAX_INPLAY_QUOTE_AGE_SECONDS = 90;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function americanImplied(price?: number | null) {
  if (typeof price !== 'number' || price === 0) return null;
  if (price > 0) return 100 / (price + 100);
  return Math.abs(price) / (Math.abs(price) + 100);
}

function americanToDecimal(price?: number | null) {
  if (typeof price !== 'number' || price === 0) return null;
  if (price > 0) return 1 + price / 100;
  return 1 + 100 / Math.abs(price);
}

function playerName(row: PropRow) {
  return (row.player_name ?? row.player ?? '').trim();
}

function eventKey(row: PropRow) {
  return (
    row.canonical_event_id ??
    row.event_id ??
    [row.away_team ?? '', row.home_team ?? '', row.commence_time ?? ''].join('|')
  );
}

function compatibleEvent(a: PropRow, b: PropRow) {
  const aId = a.canonical_event_id ?? a.event_id;
  const bId = b.canonical_event_id ?? b.event_id;
  if (aId && bId) return aId === bId;
  const aTime = a.commence_time ? Date.parse(a.commence_time) : NaN;
  const bTime = b.commence_time ? Date.parse(b.commence_time) : NaN;
  const sameTeams = Boolean(
    a.away_team && b.away_team && a.home_team && b.home_team &&
    normalizeIdentity(a.away_team) === normalizeIdentity(b.away_team) &&
    normalizeIdentity(a.home_team) === normalizeIdentity(b.home_team)
  );
  return sameTeams && Number.isFinite(aTime) && Number.isFinite(bTime) &&
    Math.abs(aTime - bTime) <= 5 * 60 * 1000;
}

function normalizeIdentity(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function exactLine(a?: number, b?: number) {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.001;
}

function displayMarket(row: PropRow) {
  return row.market_label ?? row.market ?? row.market_key ?? 'prop';
}

function quoteAgeSeconds(row: PropRow) {
  if (typeof row.age_seconds === 'number') return row.age_seconds;
  if (typeof row.stale_seconds === 'number') return row.stale_seconds;
  if (row.last_update === undefined) return null;
  const millis =
    typeof row.last_update === 'number'
      ? row.last_update > 1_000_000_000_000
        ? row.last_update
        : row.last_update * 1000
      : Date.parse(row.last_update);
  if (!Number.isFinite(millis)) return null;
  const age = Math.round((Date.now() - millis) / 1000);
  return age < -5 ? null : Math.max(0, age);
}

function allowedSides(row: PropRow): Array<'Higher' | 'Lower'> {
  if (row.market_key === 'player_home_runs') return ['Higher'];

  const key = (row.market_key ?? '').trim().toLowerCase();
  const label = displayMarket(row).trim().toLowerCase();
  const isHalfUnit = typeof row.line === 'number' && Math.abs(row.line - 0.5) < 0.001;
  const isHits = key === 'player_hits' || key === 'batter_hits' || label === 'hits';
  const isStolenBases =
    key === 'player_stolen_bases' ||
    key === 'batter_stolen_bases' ||
    label === 'stolen base' ||
    label === 'stolen bases';

  if (isHalfUnit && (isHits || isStolenBases)) return ['Higher'];
  return ['Higher', 'Lower'];
}

function buildCandidates(rows: PropRow[], scanStartedAt = Date.now()) {
  const underdogRows = rows.filter(row => row.bookmaker === 'underdog');
  const referenceRows = rows.filter(
    row =>
      !!row.bookmaker &&
      !excludedDfs.has(row.bookmaker) &&
      referenceBooks.has(row.bookmaker)
  );
  const candidates: EdgeCandidate[] = [];

  for (const offered of underdogRows) {
    const player = playerName(offered);
    if (!player || typeof offered.line !== 'number' || !offered.market_key) continue;

    const matching = referenceRows.filter(
      row =>
        row.market_key === offered.market_key &&
        playerName(row).toLowerCase() === player.toLowerCase() &&
        exactLine(row.line, offered.line) &&
        compatibleEvent(row, offered)
    );

    for (const side of allowedSides(offered)) {
      const fairSamples: number[] = [];
      const refs: string[] = [];
      for (const row of matching) {
        const over = americanImplied(row.over_price);
        const under = americanImplied(row.under_price);
        if (over === null || under === null || over + under <= 0) continue;
        fairSamples.push(side === 'Higher' ? over / (over + under) : under / (over + under));
        refs.push(row.bookmaker_title ?? row.bookmaker ?? 'market');
      }
      if (!fairSamples.length) continue;

      const fairProbability = median(fairSamples);
      const fairProbabilityLow = Math.min(...fairSamples);
      const fairProbabilityHigh = Math.max(...fairSamples);
      const consensusSpreadPct = (fairProbabilityHigh - fairProbabilityLow) * 100;
      const uniqueRefs = [...new Set(refs)];
      const screeningPrice = side === 'Higher' ? offered.over_price : offered.under_price;
      const screeningImplied = americanImplied(screeningPrice) ?? 0.5;
      const screenScore =
        (uniqueRefs.length >= 2 ? 15 : 0) +
        Math.min(uniqueRefs.length, 5) * 3 +
        Math.abs(fairProbability - screeningImplied) * 100 -
        consensusSpreadPct * 1.5;
      const commenceTime = offered.commence_time ?? new Date().toISOString();
      const commenceMillis = Date.parse(commenceTime);
      const timing: Edge['timing'] =
        Number.isFinite(commenceMillis) && commenceMillis <= scanStartedAt
          ? 'live'
          : 'pregame';
      candidates.push({
        id: [eventKey(offered), offered.market_key, player, side, offered.line].join('|'),
        eventId: offered.canonical_event_id ?? offered.event_id ?? '',
        event: `${offered.away_team ?? 'Away'} @ ${offered.home_team ?? 'Home'}`,
        commenceTime,
        timing,
        player,
        market: offered.market_key,
        marketLabel: displayMarket(offered),
        side,
        line: offered.line,
        underdogMultiplier: null,
        fairProbability,
        fairMultiplier: 1 / fairProbability,
        edgePct: null,
        roiPct: null,
        refs: uniqueRefs,
        refCount: uniqueRefs.length,
        underdogAgeSeconds: quoteAgeSeconds(offered),
        breakEvenProbability: null,
        fairProbabilityLow,
        fairProbabilityHigh,
        consensusSpreadPct,
        lineMovement: 'unknown',
        verification: 'thin',
        screenScore,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (a.screenScore !== b.screenScore) return b.screenScore - a.screenScore;
    if (a.refCount !== b.refCount) return b.refCount - a.refCount;
    return a.consensusSpreadPct - b.consensusSpreadPct;
  });
}

type RawEventSeriesResult = {
  series: MovementSeries[];
  remaining: number | null;
  truncated: boolean;
};

async function rawUnderdogEventSeries(
  key: string,
  sport: string,
  eventId: string
): Promise<RawEventSeriesResult> {
  const query = new URLSearchParams({
    eventId,
    bookmaker: 'underdog',
    hours: '6',
  });
  const baseUrl = `https://parlay-api.com/v1/sports/${sport}/line-movement`;
  let { response, text } = await fetchText(`${baseUrl}?${query.toString()}`, {
    headers: { 'X-API-Key': key },
  });
  if (response.status === 401) {
    query.set('apiKey', key);
    const retry = await fetchText(`${baseUrl}?${query.toString()}`);
    response = retry.response;
    text = retry.text;
  }
  if (!response.ok) {
    return { series: [], remaining: null, truncated: false };
  }

  const parsed = JSON.parse(text) as MovementSeries[] | { movements?: MovementSeries[] };
  const series = (Array.isArray(parsed) ? parsed : parsed.movements ?? []).filter(
    item => item.source === 'underdog' || item.bookmaker === 'underdog'
  );
  return {
    series,
    remaining: headerNumber(response, ['x-credits-remaining', 'x-requests-remaining']),
    truncated: response.headers.get('x-line-movement-truncated') === '1',
  };
}

function rawQuoteForCandidate(candidate: EdgeCandidate, series: MovementSeries[]) {
  const exact = series.find(item =>
    (item.player ?? '').toLowerCase() === candidate.player.toLowerCase() &&
    item.market_key === candidate.market &&
    exactLine(item.line, candidate.line)
  );
  if (!exact) return null;

  const snapshots = exact.snapshots ?? [];
  const last = snapshots[snapshots.length - 1];
  const price =
    candidate.side === 'Higher'
      ? exact.current_over ?? last?.over_price
      : exact.current_under ?? last?.under_price;
  const multiplier = americanToDecimal(price);
  if (!multiplier) return null;

  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : undefined;
  const previousPrice =
    candidate.side === 'Higher'
      ? previous?.over_price ?? exact.opening_over
      : previous?.under_price ?? exact.opening_under;
  const currentImplied = americanImplied(price);
  const previousImplied = americanImplied(previousPrice);
  let movement: Edge['lineMovement'] = 'unknown';
  if (currentImplied !== null && previousImplied !== null) {
    const delta = currentImplied - previousImplied;
    movement = delta > 0.005 ? 'strengthening' : delta < -0.005 ? 'weakening' : 'stable';
  }

  const timestamp =
    typeof last?.timestamp_ms === 'number'
      ? last.timestamp_ms
      : last?.time
        ? Date.parse(last.time)
        : NaN;
  const rawAge = Number.isFinite(timestamp)
    ? Math.round((Date.now() - timestamp) / 1000)
    : null;
  // Never substitute a different feed's age for missing raw quote evidence.
  const ageSeconds = rawAge !== null && rawAge >= -5 ? Math.max(0, rawAge) : null;

  return { multiplier, movement, ageSeconds };
}

function researchForCandidate(edge: EdgeCandidate, decimalOdds: number, ageSeconds: number | null, source: string) {
  const observedAt = new Date(Date.now() - Math.max(0, ageSeconds ?? 0) * 1000).toISOString();
  const rulesVerified = Math.abs(edge.line - Math.round(edge.line)) > 0.001;
  return evaluateResearch({
    eventId: edge.eventId || edge.event,
    marketKey: `${edge.market}|${edge.side}|${edge.line}`,
    book: source,
    decisionAt: new Date().toISOString(),
    oddsAt: observedAt,
    featureAvailableAt: observedAt,
    modelTrainedThrough: '1970-01-01T00:00:00Z',
    decimalOdds,
    probability: edge.fairProbability,
    probabilityLow: edge.fairProbabilityLow,
    probabilityHigh: edge.fairProbabilityHigh,
    marketType: rulesVerified ? 'binary_no_push' : 'unsupported',
    playerProp: true,
    uncertaintyValidated: false,
    independentProbabilityValidated: false,
    eventVerified: Boolean(edge.eventId && Number.isFinite(Date.parse(edge.commenceTime))),
    marketVerified: Boolean(edge.market && Number.isFinite(edge.line)),
    sourceVerified: true,
    rulesVerified,
    priceAvailable: true,
    modelVersion: 'sportsbook-consensus-benchmark-v1',
    deViggedComparator: edge.fairProbability,
    evidence: edge.refs.map(ref => `Exact-line market reference: ${ref}`),
    sources: edge.refs.map(ref => ({ source: ref, observedAt })),
  });
}

function demoEdges(): Edge[] {
  return [
    {
      id: 'demo-1',
      event: 'Sample Away @ Sample Home',
      commenceTime: new Date(Date.now() + 3600000).toISOString(),
      timing: 'pregame',
      player: 'Sample Pitcher A',
      market: 'player_strikeouts',
      marketLabel: 'Strikeouts',
      side: 'Lower',
      line: 5.5,
      underdogMultiplier: 2.02,
      fairProbability: 0.54,
      fairMultiplier: 1.85,
      edgePct: 4.5,
      roiPct: 9.1,
      refs: ['Pinnacle', 'DraftKings', 'Kalshi'],
      refCount: 3,
      underdogAgeSeconds: 18,
      breakEvenProbability: 1 / 2.02,
      fairProbabilityLow: 0.53,
      fairProbabilityHigh: 0.55,
      consensusSpreadPct: 2,
      lineMovement: 'stable',
      verification: 'verified',
    },
    {
      id: 'demo-2',
      event: 'Demo Club @ Example Club',
      commenceTime: new Date(Date.now() + 7200000).toISOString(),
      timing: 'pregame',
      player: 'Sample Pitcher B',
      market: 'player_strikeouts',
      marketLabel: 'Strikeouts',
      side: 'Higher',
      line: 7.5,
      underdogMultiplier: 1.86,
      fairProbability: 0.57,
      fairMultiplier: 1.75,
      edgePct: 3.2,
      roiPct: 6.0,
      refs: ['Pinnacle', 'FanDuel'],
      refCount: 2,
      underdogAgeSeconds: 31,
      breakEvenProbability: 1 / 1.86,
      fairProbabilityLow: 0.56,
      fairProbabilityHigh: 0.58,
      consensusSpreadPct: 2,
      lineMovement: 'strengthening',
      verification: 'verified',
    },
    {
      id: 'demo-pending',
      event: 'Pending Away @ Pending Home',
      commenceTime: new Date(Date.now() + 10800000).toISOString(),
      timing: 'pregame',
      player: 'Sample Pending C',
      market: 'player_assists',
      marketLabel: 'Assists',
      side: 'Higher',
      line: 4.5,
      underdogMultiplier: null,
      fairProbability: 0.56,
      fairMultiplier: 1 / 0.56,
      edgePct: null,
      roiPct: null,
      refs: ['Pinnacle', 'FanDuel'],
      refCount: 2,
      underdogAgeSeconds: 45,
      breakEvenProbability: null,
      fairProbabilityLow: 0.55,
      fairProbabilityHigh: 0.57,
      consensusSpreadPct: 2,
      lineMovement: 'unknown',
      verification: 'pending',
    },
  ];
}

async function readParlayKey() {
  const names = await secrets.listSecretNames();
  if (!names.includes('PARLAY_API_KEY')) return null;
  return (await secrets.readSecret('PARLAY_API_KEY')).trim();
}

async function fetchText(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text };
}

function headerNumber(response: Response, names: string[]) {
  for (const name of names) {
    const raw = response.headers.get(name);
    if (raw !== null && raw !== '') {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

async function scanParlay(
  key: string,
  sport: string,
  from?: string,
  to?: string,
  marketTiming: 'auto' | 'pregame' | 'live' = 'auto'
) {
  const query = new URLSearchParams({
    limit: '10000',
  });
  const url = `https://parlay-api.com/v1/sports/${sport}/props?${query.toString()}`;
  const { response, text } = await fetchText(url, {
    headers: { 'X-API-Key': key },
  });
  if (!response.ok) {
    const lower = text.toLowerCase();
    const exhausted =
      response.status === 402 ||
      lower.includes('credits exhausted') ||
      lower.includes('insufficient credits') ||
      lower.includes('credit balance');
    const kind = exhausted
      ? 'PARLAY_CREDITS'
      : response.status === 429
        ? 'PARLAY_RATE_LIMIT'
        : response.status === 403
          ? 'PARLAY_ACCESS'
          : 'PARLAY_ERROR';
    throw new Error(`${kind}:${response.status}`);
  }

  const parsed = JSON.parse(text) as PropRow[] | { data?: PropRow[] };
  const allRows = Array.isArray(parsed) ? parsed : parsed.data ?? [];
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : NaN;
  const scanStartedAt = Date.now();
  const maxQuoteAgeSeconds =
    marketTiming === 'live'
      ? MAX_INPLAY_QUOTE_AGE_SECONDS
      : MAX_PREGAME_QUOTE_AGE_SECONDS;
  const rows = allRows.filter(row => {
    if (!row.commence_time) return marketTiming === 'pregame';
    const time = Date.parse(row.commence_time);
    if (!Number.isFinite(time)) return false;
    if (Number.isFinite(start) && time < start) return false;
    if (Number.isFinite(end) && time >= end) return false;
    const isLive = time <= scanStartedAt;
    if (marketTiming === 'live') {
      if (!isLive) return false;
      const age = quoteAgeSeconds(row);
      return age !== null && age <= MAX_INPLAY_QUOTE_AGE_SECONDS;
    }
    if (marketTiming === 'pregame') return !isLive;
    if (!isLive) return true;
    const age = quoteAgeSeconds(row);
    return age !== null && age <= MAX_INPLAY_QUOTE_AGE_SECONDS;
  });
  const candidates = buildCandidates(rows, scanStartedAt);
  const events = new Set(rows.map(eventKey));
  const underdogRows = rows.filter(row => row.bookmaker === 'underdog');
  const underdogPropsLoaded = underdogRows.length;
  const liveUnderdogPropsLoaded = underdogRows.filter(row => {
    const time = row.commence_time ? Date.parse(row.commence_time) : NaN;
    return Number.isFinite(time) && time <= scanStartedAt;
  }).length;
  const pregameUnderdogPropsLoaded = underdogPropsLoaded - liveUnderdogPropsLoaded;
  const referenceRows = rows.filter(
    row =>
      !!row.bookmaker &&
      !excludedDfs.has(row.bookmaker) &&
      referenceBooks.has(row.bookmaker)
  );
  const referencePropsLoaded = referenceRows.length;
  const referenceBookCount = new Set(referenceRows.map(row => row.bookmaker)).size;
  const grouped = new Map<string, EdgeCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.eventId) continue;
    const group = grouped.get(candidate.eventId) ?? [];
    group.push(candidate);
    grouped.set(candidate.eventId, group);
  }
  const rankedEventGroups = [...grouped.entries()].sort((a, b) => {
    const bestA = Math.max(...a[1].map(item => item.screenScore));
    const bestB = Math.max(...b[1].map(item => item.screenScore));
    return bestB - bestA;
  });
  const rawEventCap = marketTiming === 'auto' ? 4 : 2;
  const rawEligibleEventGroups = rankedEventGroups.filter(([, group]) =>
    group.some(candidate => candidate.refCount >= 2)
  );
  const candidateEventsWithIds = grouped.size;
  const candidatesWithoutEventIds = candidates.filter(candidate => !candidate.eventId).length;
  const candidatesWithTwoReferences = candidates.filter(candidate => candidate.refCount >= 2).length;
  const rawEligibleGameCount = rawEligibleEventGroups.length;
  let selectedEventGroups: Array<[string, EdgeCandidate[]]> = [];
  if (marketTiming === 'auto') {
    const liveGroups = rawEligibleEventGroups.filter(([, group]) =>
      group.some(candidate => candidate.timing === 'live')
    );
    const pregameGroups = rawEligibleEventGroups.filter(([, group]) =>
      group.some(candidate => candidate.timing === 'pregame')
    );
    selectedEventGroups = [...liveGroups.slice(0, 2), ...pregameGroups.slice(0, 2)];
    const selectedIds = new Set(selectedEventGroups.map(([eventId]) => eventId));
    for (const entry of rawEligibleEventGroups) {
      if (selectedEventGroups.length >= rawEventCap) break;
      if (selectedIds.has(entry[0])) continue;
      selectedEventGroups.push(entry);
      selectedIds.add(entry[0]);
    }
  } else {
    selectedEventGroups = rawEligibleEventGroups.slice(0, rawEventCap);
  }
  const candidateScopeCount = selectedEventGroups.reduce(
    (total, [, group]) => total + group.length,
    0
  );
  const verifiedEdges: Edge[] = [];
  let rawEventChecks = 0;
  let rawSeriesTruncated = false;
  let remainingCredits = headerNumber(response, [
    'x-credits-remaining',
    'x-requests-remaining',
  ]);

  for (const [eventId, group] of selectedEventGroups) {
    rawEventChecks += 1;
    const raw = await rawUnderdogEventSeries(key, sport, eventId);
    if (raw.remaining !== null) remainingCredits = raw.remaining;
    rawSeriesTruncated = rawSeriesTruncated || raw.truncated;
    for (const candidate of group) {
      const quote = rawQuoteForCandidate(candidate, raw.series);
      if (!quote) continue;
      const candidateMaxQuoteAgeSeconds =
        candidate.timing === 'live'
          ? MAX_INPLAY_QUOTE_AGE_SECONDS
          : MAX_PREGAME_QUOTE_AGE_SECONDS;
      if (
        quote.ageSeconds === null ||
        quote.ageSeconds > candidateMaxQuoteAgeSeconds
      ) continue;
      const breakEvenProbability = 1 / quote.multiplier;
      const edgePct = (candidate.fairProbability - breakEvenProbability) * 100;
      const roiPct = (candidate.fairProbability * quote.multiplier - 1) * 100;
      verifiedEdges.push({
        ...candidate,
        underdogMultiplier: quote.multiplier,
        breakEvenProbability,
        edgePct,
        roiPct,
        lineMovement: quote.movement,
        underdogAgeSeconds: quote.ageSeconds,
        verification: candidate.refCount >= 2 ? 'verified' : 'thin',
        research: researchForCandidate(candidate, quote.multiplier, quote.ageSeconds, 'underdog-via-parlay'),
      });
    }
  }
  const verifiedIds = new Set(verifiedEdges.map(item => item.id));
  const pendingEdges: Edge[] = candidates
    .filter(
      candidate =>
        !verifiedIds.has(candidate.id) &&
        candidate.refCount >= 2 &&
        candidate.underdogAgeSeconds !== null &&
        candidate.underdogAgeSeconds <=
          (candidate.timing === 'live'
            ? MAX_INPLAY_QUOTE_AGE_SECONDS
            : MAX_PREGAME_QUOTE_AGE_SECONDS)
    )
    .slice(0, 6)
    .map(candidate => ({
      ...candidate,
      underdogMultiplier: null,
      breakEvenProbability: null,
      edgePct: null,
      roiPct: null,
      lineMovement: 'unknown',
      verification: 'pending',
    }));
  const edges: Edge[] = [...verifiedEdges, ...pendingEdges];
  const researchPassCount = edges.filter(edge => edge.research?.status === 'PASSES_RESEARCH').length;
  const researchAbstainCount = edges.filter(edge => edge.research?.status === 'ABSTAIN').length;
  const verificationRank: Record<Edge['verification'], number> = {
    verified: 0,
    thin: 1,
    pending: 2,
  };
  edges.sort((a, b) => {
    if (a.verification !== b.verification) {
      return verificationRank[a.verification] - verificationRank[b.verification];
    }
    return (b.edgePct ?? -999) - (a.edgePct ?? -999);
  });
  return {
    mode: 'live' as const,
    provider: 'ParlayAPI',
    providerDiscovery: {
      rowsBeforeTimingFilter: allRows.length,
      booksBeforeTimingFilter: [...new Set(allRows.map(row => row.bookmaker).filter(Boolean))],
      referenceRowsBeforeTimingFilter: allRows.filter(row => row.bookmaker && referenceBooks.has(row.bookmaker)).length,
      returnedRowsInTimingScope: rows.length,
      partialSourcePage: response.headers.get('x-result-has-more') === 'true',
      scopeNote: 'A live-only scan can return no scoped rows before kickoff even when the provider has pregame coverage. Broad source counts do not verify exact settlement, freshness or account availability.',
    },
    underdogStatus: underdogPropsLoaded > 0 ? 'fresh' as const : 'unavailable' as const,
    sport,
    marketTiming,
    maxQuoteAgeSeconds,
    generatedAt: new Date().toISOString(),
    eventCount: events.size,
    underdogPropsLoaded,
    liveUnderdogPropsLoaded,
    pregameUnderdogPropsLoaded,
    referencePropsLoaded,
    referenceBookCount,
    consensusAvailable: referencePropsLoaded > 0,
    rawPriceStatus:
      verifiedEdges.length > 0
        ? 'verified' as const
        : underdogPropsLoaded > 0
          ? 'pending' as const
          : 'unavailable' as const,
    candidatesScreened: candidates.length,
    candidateScopeCount,
    candidatesWithoutEventIds,
    candidatesWithTwoReferences,
    candidateEventsWithIds,
    rawEligibleGameCount,
    rawEventChecks,
    rawEventCap,
    rawVerifiedCount: verifiedEdges.length,
    rawSeriesTruncated,
    researchPassCount,
    researchAbstainCount,
    sourceMode: 'optional-live-feed' as const,
    dataCostLabel: `${3 + rawEventChecks * 2} Parlay credits`,
    creditsUsed: 3 + rawEventChecks * 2,
    creditsRemaining: remainingCredits,
    partialBoard: response.headers.get('x-result-has-more') === 'true',
    paginationStatus: response.headers.get('x-result-has-more') === 'true' ? 'INCOMPLETE_PROVIDER_PAGE' as const : 'COMPLETE_RETURNED_PAGE' as const,
    rawCoverageStatus: rawEligibleGameCount === 0 ? 'NO_ELIGIBLE_GAMES' as const : rawEventChecks < rawEligibleGameCount ? 'PARTIAL_GAME_VERIFICATION' as const : 'ALL_ELIGIBLE_GAMES_CHECKED' as const,
    edges,
    kalshiMarkets: [] as KalshiReference[],
    note:
      candidates.length > 0 && rawEligibleGameCount === 0
        ? `Screened ${candidates.length} provisional exact-line candidates, but ZERO games were eligible for raw price checks. ${candidatesWithoutEventIds} candidates lack a provider event ID; ${candidatesWithTwoReferences} candidates have two or more comparison books. This is a coverage/identity blocker, not ${candidates.length} completed quote checks. ${response.headers.get('x-result-has-more') === 'true' ? 'The upstream props page is incomplete.' : ''}`
      : underdogPropsLoaded === 0
        ? `Loaded ${referencePropsLoaded} sportsbook prop rows across ${referenceBookCount} reference books, but Parlay returned no matching Underdog rows in the requested scope. Consensus coverage remains visible; no EV is calculated without an exact Underdog line.`
        : verifiedEdges.length > 0
          ? `Found ${underdogPropsLoaded} Underdog rows (${liveUnderdogPropsLoaded} live, ${pregameUnderdogPropsLoaded} pregame), screened ${candidates.length} exact-line consensus candidates, and raw-verified ${verifiedEdges.length} fresh side prices across ${rawEventChecks} prioritized games. Live quotes must be 90 seconds old or fresher; pregame quotes must be 15 minutes old or fresher. EV is calculated only from raw Underdog side prices.`
          : `Found ${underdogPropsLoaded} Underdog rows (${liveUnderdogPropsLoaded} live, ${pregameUnderdogPropsLoaded} pregame) and screened ${candidates.length} exact-line consensus candidates. Fresh raw side-price verification is still pending in the prioritized scope. The separate watchlist requires at least two consensus books and timing-appropriate freshness.`,  
  };
}

function dollars(value?: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function kalshiReferences(
  sport: string,
  from?: string,
  to?: string
): Promise<KalshiReference[]> {
  const competition = kalshiCompetition[sport];
  if (!competition) return [];
  const params = new URLSearchParams({
    limit: '100',
    category: 'Sports',
    competition,
    minimum_start_date: from ?? new Date().toISOString(),
  });
  const milestoneUrl = `https://external-api.kalshi.com/trade-api/v2/milestones?${params.toString()}`;
  const milestoneResponse = await fetch(milestoneUrl);
  if (!milestoneResponse.ok) return [];
  const milestoneJson = (await milestoneResponse.json()) as {
    milestones?: Array<{
      start_date?: string;
      related_event_tickers?: string[];
      primary_event_tickers?: string[];
    }>;
  };
  const end = to ? Date.parse(to) : NaN;
  const eventTickers = new Set<string>();
  for (const milestone of milestoneJson.milestones ?? []) {
    if (milestone.start_date && Number.isFinite(end)) {
      const startTime = Date.parse(milestone.start_date);
      if (Number.isFinite(startTime) && startTime >= end) continue;
    }
    for (const ticker of [
      ...(milestone.primary_event_tickers ?? []),
      ...(milestone.related_event_tickers ?? []),
    ]) {
      eventTickers.add(ticker);
      if (eventTickers.size >= 12) break;
    }
    if (eventTickers.size >= 12) break;
  }

  const eventResults = await Promise.all(
    [...eventTickers].map(async ticker => {
      const response = await fetch(
        `https://external-api.kalshi.com/trade-api/v2/events/${encodeURIComponent(ticker)}?with_nested_markets=true`
      );
      if (!response.ok) return null;
      return (await response.json()) as {
        event?: { title?: string; markets?: KalshiMarket[] };
        markets?: KalshiMarket[];
      };
    })
  );

  const refs: KalshiReference[] = [];
  for (const item of eventResults) {
    if (!item) continue;
    const eventTitle = item.event?.title ?? 'Kalshi sports market';
    const markets = item.event?.markets ?? item.markets ?? [];
    for (const market of markets) {
      if (market.status && !['open', 'unopened'].includes(market.status)) continue;
      const bid = dollars(market.yes_bid_dollars);
      const ask = dollars(market.yes_ask_dollars);
      const probability =
        bid !== null && ask !== null
          ? (bid + ask) / 2
          : ask ?? bid;
      refs.push({
        ticker: market.ticker ?? '',
        title: `${eventTitle}${market.title ? ` — ${market.title}` : market.yes_sub_title ? ` — ${market.yes_sub_title}` : ''}`,
        yesProbability: probability,
        closeTime: market.close_time ?? null,
      });
      if (refs.length >= 20) return refs;
    }
  }
  return refs;
}

export async function getConfig() {
  const names = await secrets.listSecretNames();
  const parlayConfigured = names.includes('PARLAY_API_KEY');
  const sharpConfigured = names.includes('SHARPAPI_KEY');
  const oddsApiConfigured = names.includes('THE_ODDS_API_KEY');
  const clearSportsConfigured = names.includes('CLEARSPORTS_API_KEY');
  return {
    parlayConfigured,
    sharpConfigured,
    oddsApiConfigured,
    clearSportsConfigured,
    sportsbookFeedCount: [parlayConfigured, sharpConfigured, oddsApiConfigured].filter(Boolean).length,
    contextFeedCount: [clearSportsConfigured, true, true].filter(Boolean).length,
    kalshiPublic: true,
    weatherPublic: true,
    freeUnderdogPublic: true,
    researchGate: 'strict',
    primary: 'EdgeBoard Free API · public Underdog pregame feed',
    fallback: 'Optional Parlay live/consensus · SharpAPI · ESPN public odds · Kalshi · public weather',
  };
}

export async function scanEdges(input: {
  sport?: string;
  mode?: string;
  scanType?: 'props' | 'kym';
  marketTiming?: 'auto' | 'pregame' | 'live';
  commenceTimeFrom?: string;
  commenceTimeTo?: string;
  offset?: number;
  limit?: number;
}) {
  const sport = input.sport ?? 'baseball_mlb';
  if (sport === 'americanfootball_nfl' && input.scanType === 'kym') {
    return scanNflKymGameLines({
      mode: input.mode,
      from: input.commenceTimeFrom,
      to: input.commenceTimeTo,
    });
  }
  if (input.mode === 'demo') {
    const demo = demoEdges().map((edge, index) => {
      if (!edge.underdogMultiplier) return edge;
      return {
        ...edge,
        research: evaluateResearch({
          eventId: edge.id,
          marketKey: `${edge.market}|${edge.side}|${edge.line}`,
          book: 'demo-fixture',
          decisionAt: new Date().toISOString(),
          oddsAt: new Date().toISOString(),
          featureAvailableAt: new Date().toISOString(),
          modelTrainedThrough: '1970-01-01T00:00:00Z',
          decimalOdds: edge.underdogMultiplier,
          probability: edge.fairProbability,
          probabilityLow: edge.fairProbabilityLow,
          probabilityHigh: edge.fairProbabilityHigh,
          marketType: 'binary_no_push',
          playerProp: true,
          uncertaintyValidated: index === 0,
          independentProbabilityValidated: index === 0,
          eventVerified: true,
          marketVerified: true,
          sourceVerified: true,
          rulesVerified: true,
          priceAvailable: true,
          modelVersion: 'synthetic-regression-fixture',
          deViggedComparator: edge.fairProbability,
          evidence: ['Synthetic fixture for UI/control regression only'],
          sources: [{ source: 'synthetic fixture', observedAt: new Date().toISOString() }],
        }),
      };
    });
    return {
      mode: 'demo' as const,
      provider: 'Demo',
      underdogStatus: 'sample' as const,
      sport,
      marketTiming: input.marketTiming ?? 'auto',
      maxQuoteAgeSeconds:
        input.marketTiming === 'live'
          ? MAX_INPLAY_QUOTE_AGE_SECONDS
          : MAX_PREGAME_QUOTE_AGE_SECONDS,
      generatedAt: new Date().toISOString(),
      eventCount: 2,
      creditsUsed: 0,
      creditsRemaining: null,
      partialBoard: false,
      researchPassCount: demo.filter(edge => edge.research?.status === 'PASSES_RESEARCH').length,
      researchAbstainCount: demo.filter(edge => edge.research?.status === 'ABSTAIN').length,
      sourceMode: 'demo' as const,
      dataCostLabel: 'sample data',
      edges: demo,
      kalshiMarkets: [] as KalshiReference[],
      note: 'Sample data only. Research PASS/ABSTAIN labels are synthetic regression fixtures and are not evidence of profitability.',
    };
  }

  const marketTiming = input.marketTiming ?? 'auto';
  if (marketTiming !== 'live') {
    try {
      return await scanFreeUnderdog({
        sport,
        marketTiming,
        from: input.commenceTimeFrom,
        to: input.commenceTimeTo,
        offset: input.offset,
        limit: input.limit,
      });
    } catch (freeError) {
      const message = freeError instanceof Error ? freeError.message : 'Free Underdog feed failed';
      console.warn('free_underdog_failed', message);
    }
  }

  const key = await readParlayKey();
  if (key) {
    try {
      return await scanParlay(
        key,
        sport,
        input.commenceTimeFrom,
        input.commenceTimeTo,
        marketTiming
      );
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : 'Parlay scan failed';
      const [failureKind, failureStatus] = message.split(':');
      console.warn('parlay_scan_fallback', [failureKind, failureStatus].filter(Boolean).join(':'));
      const kalshiMarkets = await kalshiReferences(
        sport,
        input.commenceTimeFrom,
        input.commenceTimeTo
      );
      return {
        mode: 'kalshi-fallback' as const,
        provider: 'Kalshi',
        underdogStatus: 'unavailable' as const,
        sport,
        marketTiming: input.marketTiming ?? 'auto',
        generatedAt: new Date().toISOString(),
        eventCount: 0,
        creditsUsed: 0,
        creditsRemaining: message.startsWith('PARLAY_CREDITS') ? 0 : null,
        partialBoard: false,
        edges: [] as Edge[],
        kalshiMarkets,
        note: message.startsWith('PARLAY_CREDITS')
          ? 'Parlay credits are exhausted. Kalshi is still live, but exact Underdog lines cannot be verified until Parlay resets or another Underdog feed is connected.'
          : message.startsWith('PARLAY_RATE_LIMIT')
            ? 'Parlay is temporarily rate-limited. EdgeBoard switched to Kalshi reference mode; retry the live scan shortly.'
            : message.startsWith('PARLAY_ACCESS')
              ? 'Parlay rejected one or more requested sources for this account tier. EdgeBoard switched to Kalshi reference mode without claiming the credit balance is zero.'
              : `Parlay request failed${failureStatus ? ` (HTTP ${failureStatus})` : ''}. EdgeBoard switched to Kalshi reference mode. No Underdog edge is labeled verified in this mode.`, 
      };
    }
  }

  const kalshiMarkets = await kalshiReferences(
    sport,
    input.commenceTimeFrom,
    input.commenceTimeTo
  );
  return {
    mode: 'kalshi-fallback' as const,
    provider: 'Kalshi',
    underdogStatus: 'unavailable' as const,
    sport,
    generatedAt: new Date().toISOString(),
    eventCount: 0,
    creditsUsed: 0,
    creditsRemaining: null,
    partialBoard: false,
    edges: [] as Edge[],
    kalshiMarkets,
    note: marketTiming === 'live'
      ? 'The zero-cost public Underdog endpoint is pregame-only. Live props require the optional authorized live source or manual exact-price input; no research pass is fabricated when live verification is unavailable.'
      : 'The zero-cost public Underdog endpoint was unavailable for this request. Kalshi public context remains available, but no exact Underdog opportunity is labeled research-qualified.',
  };
}
