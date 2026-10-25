import type { ScanSourceHealth } from './dailyScanStatus';

export type MarketSample = {
  sport: string;
  sportName: string;
  event: string;
  startTime: string;
  type: 'game' | 'prop';
  player: string | null;
  market: string;
  selection: string;
  line: number | null;
  source: string;
  americanOdds: number | null;
  publicDecimalPrice: number | null;
  retrievedAt: string | null;
  lineId?: string;
  period?: string;
  offeredOddsTimestampVerified: false;
  accountVerified: false;
  estimatedEv: null;
  researchStatus: 'WATCH_ONLY';
  reason: string;
};

export type SportRow = {
  sport: string;
  name: string;
  status: string;
  eventCount: number;
  gamePrices: number;
  propSides: number;
  qualifyingCount: number;
  sourceHealth?: ScanSourceHealth[];
  model?: { status: string; liveApproved: boolean };
  decisionReasons?: string[];
};

export type DailyReport = {
  generatedAt: string;
  refreshAfter?: string;
  requested: { date: string; timezone: string };
  paidProviderRequests: number;
  status: string;
  caution: string;
  sports: SportRow[];
  reviewQueue: MarketSample[];
  qualifyingOpportunities: unknown[];
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown) => finite(value) && Number.isInteger(value) && value >= 0;
const timestamp = (value: unknown): value is string =>
  text(value) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
const nullableNumber = (value: unknown) => value === null || finite(value);
const nullableText = (value: unknown) => value === null || text(value);

function validSport(value: unknown): value is SportRow {
  if (!record(value)) return false;
  return ['sport', 'name', 'status'].every(key => text(value[key])) &&
    ['eventCount', 'gamePrices', 'propSides', 'qualifyingCount'].every(key => count(value[key])) &&
    (value.sourceHealth === undefined || Array.isArray(value.sourceHealth) && value.sourceHealth.every(source =>
      record(source) && text(source.source) && text(source.status) &&
      (source.retrievedAt === undefined || source.retrievedAt === null || timestamp(source.retrievedAt)))) &&
    (value.model === undefined || record(value.model) && text(value.model.status) && typeof value.model.liveApproved === 'boolean') &&
    (value.decisionReasons === undefined || Array.isArray(value.decisionReasons) && value.decisionReasons.every(text));
}

function validPrice(value: unknown): value is MarketSample {
  if (!record(value)) return false;
  return ['sport', 'sportName', 'event', 'market', 'selection', 'source', 'reason'].every(key => text(value[key])) &&
    timestamp(value.startTime) && (value.type === 'game' || value.type === 'prop') &&
    nullableText(value.player) && nullableNumber(value.line) &&
    (value.americanOdds === null || finite(value.americanOdds) && Math.abs(value.americanOdds) >= 100) &&
    (value.publicDecimalPrice === null || finite(value.publicDecimalPrice) && value.publicDecimalPrice > 1) &&
    (value.type === 'game' ? value.americanOdds !== null : value.publicDecimalPrice !== null) &&
    (value.retrievedAt === null || timestamp(value.retrievedAt)) &&
    (value.lineId === undefined || text(value.lineId)) &&
    (value.period === undefined || text(value.period)) &&
    value.offeredOddsTimestampVerified === false && value.accountVerified === false &&
    value.estimatedEv === null && value.researchStatus === 'WATCH_ONLY';
}

/** Check untrusted HTTP-200 data before any array or formatting operations. */
export function parseDailyReport(value: unknown): DailyReport {
  if (!record(value) || !timestamp(value.generatedAt) ||
    !record(value.requested) || !text(value.requested.date) || !text(value.requested.timezone) ||
    !text(value.status) || !text(value.caution) || !count(value.paidProviderRequests) ||
    !Array.isArray(value.sports) || !value.sports.every(validSport) ||
    !Array.isArray(value.reviewQueue) || !value.reviewQueue.every(validPrice) ||
    !Array.isArray(value.qualifyingOpportunities) ||
    (value.refreshAfter !== undefined && (!timestamp(value.refreshAfter) || Date.parse(value.refreshAfter) <= Date.parse(value.generatedAt)))) {
    throw new Error('Scan returned an invalid report. Retry the scan; no prices or model conclusions were loaded.');
  }
  return value as DailyReport;
}

/** A 60-second display limit is an engineering policy, not verified quote freshness. */
export const SCAN_DISPLAY_LIFETIME_MS = 60_000;

export function dailyReportView(report: DailyReport, selectedSport: string, now: number) {
  const generated = Date.parse(report.generatedAt);
  const expiresAt = Math.min(generated + SCAN_DISPLAY_LIFETIME_MS,
    report.refreshAfter ? Date.parse(report.refreshAfter) : Infinity);
  const expired = !Number.isFinite(now) || !Number.isFinite(expiresAt) || now >= expiresAt || now < generated - 5_000;
  const sports = report.sports.filter(row => selectedSport === 'all' || row.sport === selectedSport);
  const prices = expired ? [] : report.reviewQueue.filter(row =>
    (selectedSport === 'all' || row.sport === selectedSport) && Date.parse(row.startTime) > now);
  const candidateCount = expired ? 0 : selectedSport === 'all'
    ? report.qualifyingOpportunities.length
    : sports.reduce((sum, row) => sum + row.qualifyingCount, 0);
  return { expired, expiresAt, sports, prices, candidateCount };
}
