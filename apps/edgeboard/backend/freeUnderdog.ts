import {
  decimalImpliedProbability,
  evaluateResearch,
  fairTwoWay,
  type ResearchResult,
} from './researchControls';
import { identity, marketKey } from '../shared/accountSlip';

type RecordLike = Record<string, unknown>;

type FreeSide = {
  choice: 'Higher' | 'Lower';
  americanPrice: number | null;
  decimalPrice: number | null;
  payoutMultiplier: number | null;
  fantasyProbability: number | null;
};

export type FreeLine = {
  lineId: string;
  eventId: string;
  event: string;
  commenceTime: string | null;
  player: string;
  market: string;
  marketLabel: string;
  line: number;
  sportId: string;
  status: string;
  lineType: string;
  isLive: boolean;
  period: string;
  periodEvidence: string;
  observedAt: string;
  lineUpdatedAt: string | null;
  higher: FreeSide | null;
  lower: FreeSide | null;
};

type FreeEdge = {
  id: string;
  lineId: string;
  eventId: string;
  period: string;
  event: string;
  commenceTime: string;
  timing: 'pregame';
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
  verification: 'pending';
  research: ResearchResult;
  displayPayoutMultiplier: number | null;
  priceBasis: 'decimal_price';
};

const SOURCE_URL = 'https://api.underdogfantasy.com/v1/over_under_lines';
const CACHE_MS = 60_000;
const STALE_CACHE_MS = 10 * 60_000;

const sportAliases: Record<string, string[]> = {
  baseball_mlb: ['MLB'],
  baseball_kbo: ['KBO'],
  baseball_npb: ['NPB'],
  americanfootball_nfl: ['NFL'],
  americanfootball_ncaaf: ['CFB', 'NCAAF'],
  basketball_nba: ['NBA'],
  basketball_wnba: ['WNBA'],
  icehockey_nhl: ['NHL'],
  tennis: ['TENNIS'],
  mma: ['MMA'],
  soccer: ['SOCCER'],
  golf_pga: ['PGA'],
  esports_cs2: ['CS', 'CS2'],
  esports_lol: ['LOL'],
  esports_valorant: ['VAL', 'VALORANT'],
  motorsport_f1: ['F1', 'F1SZN'],
};

type PublicBoard = {
  fetchedAt: number;
  lastCheckedAt: number;
  etag: string | null;
  lines: FreeLine[];
  staleCacheUsed: boolean;
};
let cachedBoard: PublicBoard | null = null;
let inFlight: Promise<PublicBoard> | null = null;
let previousById = new Map<
  string,
  { line: number; higher: number | null; lower: number | null }
>();

function record(value: unknown): RecordLike {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';
}

function numberValue(value: unknown) {
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function americanToDecimal(price: number | null) {
  if (price === null || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function impliedFromAmerican(price: number | null) {
  const decimal = americanToDecimal(price);
  return decimal && decimal > 1 ? 1 / decimal : null;
}

function fantasyProbability(option: RecordLike) {
  const fantasy = record(record(option.odds).fantasy);
  const direct = numberValue(
    fantasy.implied_probability ??
      fantasy.implied_probability_percent ??
      fantasy.probability ??
      option.implied_probability,
  );
  if (direct !== null) {
    const probability = direct > 1 ? direct / 100 : direct;
    if (probability >= 0 && probability <= 1) return probability;
  }
  const decimal = numberValue(
    fantasy.decimal ?? fantasy.decimal_price ?? fantasy.odds_decimal,
  );
  if (decimal !== null && decimal > 1) return 1 / decimal;
  const american = numberValue(
    fantasy.american ?? fantasy.american_price ?? fantasy.odds_american,
  );
  return impliedFromAmerican(american);
}

function sideFromOption(option: RecordLike): FreeSide | null {
  if (
    ['closed', 'suspended', 'inactive', 'settled'].includes(
      stringValue(option.status).toLowerCase(),
    )
  )
    return null;
  const choice = stringValue(option.choice).toLowerCase();
  if (choice !== 'higher' && choice !== 'lower') return null;
  const americanPrice = numberValue(option.american_price);
  return {
    choice: choice === 'higher' ? 'Higher' : 'Lower',
    americanPrice,
    decimalPrice:
      numberValue(option.decimal_price) ?? americanToDecimal(americanPrice),
    payoutMultiplier: numberValue(option.payout_multiplier),
    fantasyProbability: fantasyProbability(option),
  };
}

function fullPlayerName(player: RecordLike, fallback: string) {
  const joined = [stringValue(player.first_name), stringValue(player.last_name)]
    .filter(Boolean)
    .join(' ')
    .trim();
  return joined || fallback;
}

export function normalizeBoard(payload: unknown, observedAt: string) {
  const root = record(payload);
  const nested = record(root.data);
  const data = Object.keys(nested).length ? nested : root;
  const appearances = new Map(
    array(data.appearances).map((value) => {
      const item = record(value);
      return [stringValue(item.id), item] as const;
    }),
  );
  const players = new Map(
    array(data.players).map((value) => {
      const item = record(value);
      return [stringValue(item.id), item] as const;
    }),
  );
  const games = new Map(
    [...array(data.games), ...array(data.solo_games)].map((value) => {
      const item = record(value);
      return [stringValue(item.id), item] as const;
    }),
  );
  const lines: FreeLine[] = [];
  const currentById = new Map<
    string,
    { line: number; higher: number | null; lower: number | null }
  >();

  for (const rawValue of array(data.over_under_lines)) {
    const raw = record(rawValue);
    const overUnder = record(raw.over_under);
    const appearanceStat = record(overUnder.appearance_stat);
    const appearance =
      appearances.get(stringValue(appearanceStat.appearance_id)) ?? {};
    const player = players.get(stringValue(appearance.player_id)) ?? {};
    const game = games.get(stringValue(appearance.match_id)) ?? {};
    const options = array(raw.options)
      .map((value) => sideFromOption(record(value)))
      .filter((value): value is FreeSide => value !== null);
    const higher = options.find((option) => option.choice === 'Higher') ?? null;
    const lower = options.find((option) => option.choice === 'Lower') ?? null;
    const line = numberValue(raw.stat_value ?? raw.line);
    const lineId = stringValue(raw.id);
    if (line === null || !lineId) continue;

    const firstOption = record(array(raw.options)[0]);
    const playerName = fullPlayerName(
      player,
      stringValue(firstOption.selection_header),
    );
    if (!playerName) continue;

    const eventId = stringValue(game.id) || stringValue(appearance.match_id);
    const event =
      stringValue(game.full_team_names_title) ||
      stringValue(game.title) ||
      stringValue(game.short_title) ||
      'Season / outright market';
    const commenceTime =
      stringValue(
        game.scheduled_at ??
          game.starts_at ??
          game.start_time ??
          raw.expires_at,
      ) || null;
    const sportId = (
      stringValue(player.sport_id) || stringValue(game.sport_id)
    ).toUpperCase();
    const market =
      stringValue(appearanceStat.stat) ||
      stringValue(overUnder.title) ||
      'prop';
    const marketLabel =
      stringValue(appearanceStat.display_stat) ||
      stringValue(overUnder.title) ||
      market;
    const declaredPeriod = stringValue(
      raw.period ?? overUnder.period ?? appearanceStat.period,
    ).toUpperCase();
    const segmentLabel = [
      market,
      marketLabel,
      stringValue(overUnder.title),
      stringValue(game.title_suffix),
    ].join(' ');
    const explicitHalf = /\b(?:2H|2nd[ _-]?half|second[ _-]?half)\b/i.test(
      segmentLabel,
    )
      ? '2H'
      : /\b(?:1H|1st[ _-]?half|first[ _-]?half)\b/i.test(segmentLabel)
        ? '1H'
        : '';

    lines.push({
      lineId,
      eventId,
      event,
      commenceTime,
      player: playerName,
      market,
      marketLabel,
      line,
      sportId,
      status: stringValue(raw.status) || 'unknown',
      lineType: stringValue(raw.line_type) || 'unknown',
      isLive: raw.live_event === true,
      period: declaredPeriod || explicitHalf || 'UNKNOWN',
      periodEvidence: declaredPeriod
        ? 'provider period field'
        : explicitHalf
          ? 'explicit source segment label'
          : 'source segment not retained; not inferred from kickoff',
      observedAt,
      lineUpdatedAt:
        stringValue(
          raw.updated_at ?? raw.line_updated_at ?? overUnder.updated_at,
        ) || null,
      higher,
      lower,
    });
    currentById.set(lineId, {
      line,
      higher: higher?.decimalPrice ?? null,
      lower: lower?.decimalPrice ?? null,
    });
  }
  return { lines, currentById };
}

async function fetchFreshBoard(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedBoard &&
    !cachedBoard.staleCacheUsed &&
    now - cachedBoard.lastCheckedAt < CACHE_MS
  )
    return cachedBoard;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (cachedBoard?.etag) headers['If-None-Match'] = cachedBoard.etag;
      const response = await fetch(SOURCE_URL, {
        headers,
        signal: controller.signal,
      });
      if (response.status === 304 && cachedBoard) {
        cachedBoard = {
          ...cachedBoard,
          lastCheckedAt: Date.now(),
          staleCacheUsed: false,
        };
        return cachedBoard;
      }
      if (!response.ok) throw new Error(`FREE_UNDERDOG:${response.status}`);
      const observedAt = new Date().toISOString();
      const payload = (await response.json()) as unknown;
      const normalized = normalizeBoard(payload, observedAt);
      if (cachedBoard) {
        previousById = new Map(
          cachedBoard.lines.map((line) => [
            line.lineId,
            {
              line: line.line,
              higher: line.higher?.decimalPrice ?? null,
              lower: line.lower?.decimalPrice ?? null,
            },
          ]),
        );
      }
      const result = {
        fetchedAt: Date.now(),
        lastCheckedAt: Date.now(),
        etag: response.headers.get('etag'),
        lines: normalized.lines,
        staleCacheUsed: false,
      };
      cachedBoard = result;
      return result;
    } catch (error) {
      if (
        cachedBoard &&
        Date.now() - cachedBoard.lastCheckedAt < STALE_CACHE_MS
      ) {
        cachedBoard = { ...cachedBoard, staleCacheUsed: true };
        return cachedBoard;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      inFlight = null;
    }
  })();

  return inFlight;
}

function movementFor(line: FreeLine, side: 'Higher' | 'Lower') {
  const prior = previousById.get(line.lineId);
  const currentDecimal =
    side === 'Higher'
      ? (line.higher?.decimalPrice ?? null)
      : (line.lower?.decimalPrice ?? null);
  const previousDecimal =
    side === 'Higher' ? (prior?.higher ?? null) : (prior?.lower ?? null);
  if (
    currentDecimal === null ||
    previousDecimal === null ||
    currentDecimal <= 1 ||
    previousDecimal <= 1
  ) {
    return 'unknown' as const;
  }
  const delta = 1 / currentDecimal - 1 / previousDecimal;
  return delta > 0.005
    ? ('strengthening' as const)
    : delta < -0.005
      ? ('weakening' as const)
      : ('stable' as const);
}

export function matchesSport(line: FreeLine, sport: string) {
  if (sport === 'all') return true;
  return (sportAliases[sport] ?? []).includes(line.sportId);
}

function withinWindow(line: FreeLine, from?: string, to?: string) {
  if (!line.commenceTime) return false;
  const eventTime = Date.parse(line.commenceTime);
  if (!Number.isFinite(eventTime)) return false;
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : NaN;
  if (Number.isFinite(start) && eventTime < start) return false;
  if (Number.isFinite(end) && eventTime >= end) return false;
  return true;
}

function offeredSides(line: FreeLine) {
  return [
    line.higher ? (['Higher', line.higher] as const) : null,
    line.lower ? (['Lower', line.lower] as const) : null,
  ].filter(
    (item): item is readonly ['Higher' | 'Lower', FreeSide] => item !== null,
  );
}

export async function getFreeUnderdogLines(input: {
  sport?: string;
  limit?: number;
  includeSeasonMarkets?: boolean;
  eventTeams?: string[];
  player?: string;
  market?: string;
  offset?: number;
  snapshotId?: string;
  pregameOnly?: boolean;
  forceRefresh?: boolean;
}) {
  const board = await fetchFreshBoard(input.forceRefresh);
  const sport = input.sport ?? 'all';
  const limit = Number.isFinite(input.limit)
    ? Math.min(1000, Math.max(1, Math.floor(input.limit!)))
    : 250;
  const offset = Number.isFinite(input.offset)
    ? Math.max(0, Math.floor(input.offset!))
    : 0;
  const snapshotId = String(board.fetchedAt);
  if (offset > 0 && (!input.snapshotId || input.snapshotId !== snapshotId))
    throw new Error(
      'SNAPSHOT_CHANGED: Refresh the search before loading another page.',
    );
  if ((input.player?.length ?? 0) > 200 || (input.market?.length ?? 0) > 200)
    throw new Error('Search filters are too long.');
  const playerSearch = identity(input.player ?? '');
  const exactMarket = input.market
    ? (marketKey(input.market) ?? input.market)
    : null;
  const matching = board.lines
    .filter((line) => matchesSport(line, sport))
    .filter((line) => input.includeSeasonMarkets || Boolean(line.commenceTime))
    .filter(
      (line) => !playerSearch || identity(line.player).includes(playerSearch),
    )
    .filter(
      (line) =>
        !exactMarket || (marketKey(line.market) ?? line.market) === exactMarket,
    )
    .filter(
      (line) =>
        !input.pregameOnly ||
        (!line.isLive &&
          Boolean(line.commenceTime) &&
          Date.parse(line.commenceTime!) > Date.now() &&
          ['active', 'open', 'available'].includes(line.status.toLowerCase())),
    )
    .filter(
      (line) =>
        !input.eventTeams?.length ||
        input.eventTeams.every((team) =>
          line.event
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .includes(team.toLowerCase().replace(/[^a-z0-9]/g, '')),
        ),
    );
  matching.sort(
    (a, b) =>
      (Date.parse(a.commenceTime ?? '') || Infinity) -
        (Date.parse(b.commenceTime ?? '') || Infinity) ||
      a.player.localeCompare(b.player) ||
      a.market.localeCompare(b.market) ||
      a.line - b.line ||
      a.lineId.localeCompare(b.lineId),
  );
  const lines = matching.slice(offset, offset + limit);
  return {
    source: 'Underdog public board',
    sourceUrl: SOURCE_URL,
    cost: '$0',
    retrievedAt: new Date(board.fetchedAt).toISOString(),
    lastCheckedAt: new Date(board.lastCheckedAt).toISOString(),
    staleCacheUsed: board.staleCacheUsed,
    sourceStatus: board.staleCacheUsed
      ? 'STALE_CACHE_UPSTREAM_UNAVAILABLE'
      : 'PUBLIC_OBSERVATION_ONLY',
    priceTimestampVerified: false,
    accountAvailability: 'UNVERIFIED',
    cacheSeconds: CACHE_MS / 1000,
    pregameOnly: matching.every((line) => !line.isLive),
    sport,
    count: lines.length,
    totalMatchingLines: matching.length,
    offset,
    nextOffset:
      offset + lines.length < matching.length ? offset + lines.length : null,
    snapshotId,
    truncated: offset + lines.length < matching.length,
    filters: { player: input.player ?? null, market: input.market ?? null },
    disclosure:
      'Search filters apply to the complete source board before paging. Public prices are not account offers. Unknown periods and grading rules remain unverified.',
    lines,
  };
}

export async function scanFreeUnderdog(input: {
  sport: string;
  marketTiming: 'auto' | 'pregame';
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
}) {
  const board = await fetchFreshBoard();
  const checkedAt = Date.now();
  const blockedStatus =
    /^(closed|suspended|inactive|cancelled|canceled|settled|expired)$/i;
  const allSportLines = board.lines.filter(
    (line) =>
      matchesSport(line, input.sport) &&
      !line.isLive &&
      !blockedStatus.test(line.status.trim()) &&
      line.commenceTime !== null &&
      Number.isFinite(Date.parse(line.commenceTime)) &&
      Date.parse(line.commenceTime) > checkedAt &&
      withinWindow(line, input.from, input.to),
  );

  const edges: FreeEdge[] = [];
  for (const line of allSportLines) {
    const hasTwoWayPrice = Boolean(
      line.higher?.decimalPrice &&
      line.lower?.decimalPrice &&
      line.higher.decimalPrice > 1 &&
      line.lower.decimalPrice > 1,
    );
    const higherFair = hasTwoWayPrice
      ? fairTwoWay(line.higher!.decimalPrice!, line.lower!.decimalPrice!)
      : null;

    for (const [side, offered] of offeredSides(line)) {
      if (!offered.decimalPrice || offered.decimalPrice <= 1) continue;
      const deViggedComparator =
        higherFair === null
          ? null
          : side === 'Higher'
            ? higherFair
            : 1 - higherFair;
      const benchmark =
        offered.fantasyProbability ??
        deViggedComparator ??
        decimalImpliedProbability(offered.decimalPrice);
      const comparisonValues = [benchmark, deViggedComparator].filter(
        (value): value is number => value !== null && Number.isFinite(value),
      );
      const low = Math.min(...comparisonValues);
      const high = Math.max(...comparisonValues);
      const rulesVerified = false;
      const research = evaluateResearch({
        eventId: line.eventId || line.event,
        marketKey: `${line.market}|${side}|${line.line}`,
        book: 'underdog-public',
        decisionAt: line.observedAt,
        oddsAt:
          line.lineUpdatedAt &&
          /(?:Z|[+-]\d{2}:\d{2})$/i.test(line.lineUpdatedAt) &&
          Number.isFinite(Date.parse(line.lineUpdatedAt))
            ? line.lineUpdatedAt
            : '1970-01-01T00:00:00Z',
        featureAvailableAt: line.observedAt,
        modelTrainedThrough: '1970-01-01T00:00:00Z',
        decimalOdds: offered.decimalPrice,
        probability: benchmark,
        probabilityLow: low,
        probabilityHigh: high,
        marketType: rulesVerified ? 'binary_no_push' : 'unsupported',
        playerProp: true,
        uncertaintyValidated: false,
        independentProbabilityValidated: false,
        eventVerified: Boolean(
          line.eventId &&
          line.commenceTime &&
          Number.isFinite(Date.parse(line.commenceTime)),
        ),
        marketVerified: Boolean(line.market && Number.isFinite(line.line)),
        sourceVerified: true,
        rulesVerified,
        priceAvailable: true,
        modelVersion:
          offered.fantasyProbability !== null
            ? 'underdog-fantasy-benchmark-v1'
            : 'underdog-devig-benchmark-v1',
        deViggedComparator,
        evidence: [
          'Exact Underdog pregame line and price observed from the public pick’em feed.',
          offered.fantasyProbability !== null
            ? 'Underdog fantasy implied probability is shown only as a market benchmark, not an independent model.'
            : 'Two-way de-vig is shown only as a market benchmark, not an independent model.',
        ],
        sources: [
          {
            source: 'Underdog public pregame feed',
            observedAt: line.observedAt,
          },
        ],
      });

      edges.push({
        id: `${line.lineId}|${side}`,
        lineId: line.lineId,
        eventId: line.eventId,
        period: line.period,
        event: line.event,
        commenceTime: line.commenceTime ?? line.observedAt,
        timing: 'pregame',
        player: line.player,
        market: line.market,
        marketLabel: line.marketLabel,
        side,
        line: line.line,
        underdogMultiplier: offered.decimalPrice,
        fairProbability: benchmark,
        fairMultiplier: benchmark > 0 ? 1 / benchmark : 0,
        edgePct: null,
        roiPct: null,
        refs:
          offered.fantasyProbability !== null
            ? [
                'Underdog fantasy benchmark',
                ...(deViggedComparator !== null
                  ? ['Underdog two-way de-vig']
                  : []),
              ]
            : deViggedComparator !== null
              ? ['Underdog two-way de-vig']
              : ['Underdog raw price only'],
        refCount: 1,
        underdogAgeSeconds: Math.max(
          0,
          Math.round((Date.now() - board.fetchedAt) / 1000),
        ),
        breakEvenProbability: decimalImpliedProbability(offered.decimalPrice),
        fairProbabilityLow: low,
        fairProbabilityHigh: high,
        consensusSpreadPct: Math.abs(high - low) * 100,
        lineMovement: movementFor(line, side),
        verification: 'pending',
        research,
        displayPayoutMultiplier: offered.payoutMultiplier,
        priceBasis: 'decimal_price',
      });
    }
  }

  // The platform's own pricing margin is not an edge ranking signal.
  // Show nearest future events first; all rows remain research abstentions.
  edges.sort(
    (a, b) =>
      Date.parse(a.commenceTime) - Date.parse(b.commenceTime) ||
      a.player.localeCompare(b.player) ||
      a.market.localeCompare(b.market) ||
      a.line - b.line ||
      a.side.localeCompare(b.side),
  );
  const offset = Number.isFinite(input.offset)
    ? Math.max(0, Math.floor(input.offset!))
    : 0;
  const limit = Number.isFinite(input.limit)
    ? Math.min(500, Math.max(1, Math.floor(input.limit!)))
    : 150;
  const selected = edges.slice(offset, offset + limit);
  const researchPassCount = edges.filter(
    (edge) => edge.research.status === 'PASSES_RESEARCH',
  ).length;
  const researchAbstainCount = edges.length - researchPassCount;
  const marketSummary = [...new Set(edges.map((edge) => edge.market))].map(
    (market) => {
      const matching = edges.filter((edge) => edge.market === market);
      return {
        market,
        candidatesScreened: matching.length,
        qualifyingCount: matching.filter(
          (edge) => edge.research.status === 'PASSES_RESEARCH',
        ).length,
        modelStatus: 'NO_APPROVED_INDEPENDENT_PROP_MODEL',
      };
    },
  );

  return {
    mode: 'live' as const,
    provider: 'EdgeBoard Free API',
    sourceRetrievedAt: new Date(board.fetchedAt).toISOString(),
    sourceMode: 'free-public' as const,
    dataCostLabel: '$0 public feed',
    underdogStatus:
      allSportLines.length === 0
        ? ('unavailable' as const)
        : board.staleCacheUsed || checkedAt - board.lastCheckedAt > 120000
          ? ('stale' as const)
          : ('fresh' as const),
    sport: input.sport,
    marketTiming: input.marketTiming,
    maxQuoteAgeSeconds: 120,
    generatedAt: new Date().toISOString(),
    eventCount: new Set(allSportLines.map((line) => line.eventId || line.event))
      .size,
    creditsUsed: 0,
    creditsRemaining: null,
    partialBoard: selected.length < edges.length,
    returnedRows: selected.length,
    offset,
    nextOffset:
      offset + selected.length < edges.length ? offset + selected.length : null,
    paginationBasis:
      'Current cached snapshot; a refreshed feed can reorder rows.',
    underdogPropsLoaded: allSportLines.length,
    liveUnderdogPropsLoaded: 0,
    pregameUnderdogPropsLoaded: allSportLines.length,
    referencePropsLoaded: 0,
    referenceBookCount: 0,
    consensusAvailable: false,
    rawPriceStatus: 'pending' as const,
    candidatesScreened: edges.length,
    candidateScopeCount: edges.length,
    rawEventChecks: 0,
    rawEventCap: 0,
    rawVerifiedCount: 0,
    staleCacheUsed: board.staleCacheUsed,
    sourceLastCheckedAt: new Date(board.lastCheckedAt).toISOString(),
    accountPriceVerified: false,
    independentReferenceBookCount: 0,
    rawSeriesTruncated: false,
    researchPassCount,
    researchAbstainCount,
    marketSummary,
    edges: selected,
    kalshiMarkets: [],
    note: allSportLines.length
      ? `Zero-cost Underdog public feed loaded ${allSportLines.length} future pregame lines. Snapshot age ${Math.max(0, Math.round((checkedAt - board.fetchedAt) / 1000))} seconds. Source prices are research observations, not executable account quotes. A market-derived benchmark is not an independently validated probability, so no +EV play is approved.`
      : 'The zero-cost public Underdog feed returned no matching pregame lines in this sport/time window. No paid API was called.',
  };
}

export async function getFreeUnderdogHealth(sport = 'baseball_mlb') {
  const board = await fetchFreshBoard();
  const matching = board.lines.filter(
    (line) => matchesSport(line, sport) && !line.isLive,
  );
  return {
    source: 'Underdog public pregame feed',
    cost: '$0',
    coverage: 'pregame player/pick’em lines; live in-play is not public',
    cacheSeconds: CACHE_MS / 1000,
    observedAt: new Date(board.fetchedAt).toISOString(),
    lastCheckedAt: new Date(board.lastCheckedAt).toISOString(),
    staleCacheUsed: board.staleCacheUsed,
    priceTimestampVerified: false,
    accountAvailability: 'UNVERIFIED',
    sport,
    lines: matching.length,
    historicalLedger:
      'Only process-memory movement comparison is implemented; persistent historical validation is not yet available.',
  };
}
