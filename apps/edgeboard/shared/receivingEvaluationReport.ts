type Metric = { n: number; brier: number; logLoss: number };
export type ReceivingEvaluationReport = {
  owner: string;
  schemaVersion: 'edgeboard.receiving-forward-evaluation.v1';
  protocolSha256: string;
  evaluationStatus: string;
  cohortComplete: boolean;
  recordsIncluded: number;
  scoredCount: number;
  unresolvedCount: number;
  uniqueScoredGames: number;
  scores: Record<'selected' | 'raw' | 'trainBaseRate', Metric | null>;
  rows: Array<{receiptId: string; playerId: string | null; gameId: string | null; status:'SCORED' | 'UNRESOLVED'; reason:string; kickoffAt?:string; receivingYards?:number; outcome?:0 | 1}>;
  source: {status:string;retrievedAt:string;reason?:string;files:Array<{url:string;sha256:string;observedAt:string}>;
    finalGameWindow?:{offset:number;maximum:8;totalDueGames:number;checked:number;nextOffset:number|null}};
  limitations: string[];
  historyRange: {startsAtBeginning:boolean;startToken:string|null;pagesRead:number;maximumRecords:number;nextToken:string | null;maximumFinalGameChecks:number};
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const kickoffTime = (v: unknown) => time(v) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(v as string);
const textOrNull = (v: unknown) => v === null || typeof v === 'string';

/** Owner and shape checks precede rendering or generating a private download. */
export function parseReceivingEvaluation(value: unknown, owner: string): ReceivingEvaluationReport {
  const invalid = () => { throw Error('Evaluation response could not be verified. Retry under the current account.'); };
  if (!object(value) || value.owner !== owner || !owner || value.schemaVersion !== 'edgeboard.receiving-forward-evaluation.v1'
    || value.bettingDecision !== 'HOLD' || value.liveApproved !== false || value.verifiedPositiveEv !== false
    || value.executionEnabled !== false || value.readOnly !== true || value.independentOfOdds !== true
    || !hash(value.protocolSha256) || typeof value.cohortComplete !== 'boolean'
    || !['PARTIAL_COHORT','DESCRIPTIVE_SCORES_AVAILABLE','NO_SCORABLE_OUTCOMES'].includes(String(value.evaluationStatus))
    || ![value.recordsIncluded,value.scoredCount,value.unresolvedCount,value.uniqueScoredGames].every(count)
    || !Array.isArray(value.rows) || value.rows.length > 200 || value.rows.length !== value.recordsIncluded
    || !Array.isArray(value.limitations) || !value.limitations.every(v => typeof v === 'string')
    || !object(value.scores) || !object(value.source) || !object(value.historyRange)) return invalid();
  const n = value.scoredCount as number;
  if (n + (value.unresolvedCount as number) !== value.recordsIncluded || (value.uniqueScoredGames as number) > n) return invalid();
  if (!value.rows.every(row => object(row) && typeof row.receiptId === 'string'
    && textOrNull(row.playerId) && textOrNull(row.gameId) && typeof row.reason === 'string'
    && (row.status === 'UNRESOLVED' || row.status === 'SCORED' && typeof row.playerId === 'string' && typeof row.gameId === 'string'
      && Number.isSafeInteger(row.receivingYards) && row.outcome === Number((row.receivingYards as number) >= 60)))) return invalid();
  if (value.rows.filter(row => row.status === 'SCORED').length !== n) return invalid();
  for (const variant of ['selected','raw','trainBaseRate']) {
    const metric = value.scores[variant];
    if (n === 0 ? metric !== null : !object(metric) || metric.n !== n || !finite(metric.brier)
      || metric.brier < 0 || metric.brier > 1 || !finite(metric.logLoss) || metric.logLoss < 0) return invalid();
  }
  const source = value.source;
  if (!['AVAILABLE','UNAVAILABLE','NOT_REQUESTED'].includes(String(source.status)) || !time(source.retrievedAt)
    || source.publicationClockVerified !== false || source.reason !== undefined && typeof source.reason !== 'string'
    || !Array.isArray(source.files) || !source.files.every(file => object(file) && typeof file.url === 'string'
      && file.url.startsWith('https://') && hash(file.sha256) && time(file.observedAt))) return invalid();
  if (n > 0 && source.status !== 'AVAILABLE') return invalid();
  if (!value.rows.every(row => (row.kickoffAt === undefined || kickoffTime(row.kickoffAt))
    && (row.reason !== 'GAME_NOT_STARTED' || row.status === 'UNRESOLVED'
      && kickoffTime(row.kickoffAt) && Date.parse(row.kickoffAt as string) > Date.parse(source.retrievedAt as string)))) return invalid();
  const range = value.historyRange;
  if (!(range.startToken === null || typeof range.startToken === 'string' && range.startToken.length > 0 && range.startToken.length <= 3000)) return invalid();
  if (typeof range.startsAtBeginning !== 'boolean' || !count(range.pagesRead) || range.pagesRead > 20
    || range.maximumRecords !== 200 || range.maximumFinalGameChecks !== 8
    || !(range.nextToken === null || typeof range.nextToken === 'string' && range.nextToken.length > 0 && range.nextToken.length <= 3000)) return invalid();
  if (range.startsAtBeginning !== (range.startToken === null)
    || value.cohortComplete === true && (!range.startsAtBeginning || range.nextToken !== null)
    || value.evaluationStatus !== (!value.cohortComplete ? 'PARTIAL_COHORT' : n > 0 ? 'DESCRIPTIVE_SCORES_AVAILABLE' : 'NO_SCORABLE_OUTCOMES')) return invalid();
  if (source.finalGameWindow !== undefined) {
    const window = source.finalGameWindow;
    if (!object(window) || !count(window.offset) || window.offset >= 200 || window.maximum !== 8
      || !count(window.totalDueGames) || window.totalDueGames > 200 || !count(window.checked) || window.checked > 8
      || !(window.nextOffset === null || count(window.nextOffset) && window.nextOffset > window.offset && window.nextOffset < window.totalDueGames)) return invalid();
  }
  return value as ReceivingEvaluationReport;
}
