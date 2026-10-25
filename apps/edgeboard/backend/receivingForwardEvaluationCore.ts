import protocol from './receivingForwardProtocol.json' with { type: 'json' };
import { canonicalJson } from './correctedReceiving.ts';
import { createReceivingForwardService, forwardHash, receivingForwardProtocol, type ForwardReceipt } from './receivingForwardCore.ts';

export type ForwardOutcome = {
  playerId: string;
  gameId: string;
  seasonType: string;
  position: string;
  receivingYards: number | null;
  finalStatus: 'FINAL' | 'NOT_FINAL' | 'UNKNOWN';
  unresolvedReason?: string;
};
export type ForwardOutcomeSource = {
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_REQUESTED';
  retrievedAt: string;
  files: { url: string; sha256: string; observedAt: string }[];
  publicationClockVerified: false;
  reason?: string;
  finalGameWindow?: {
    offset: number;
    maximum: 8;
    totalDueGames: number;
    checked: number;
    nextOffset: number | null;
  };
};
type Variant = 'selected' | 'raw' | 'trainBaseRate';
type Metrics = { n: number; brier: number; logLoss: number };
type ScoredRow = {
  receiptId: string; playerId: string; gameId: string;
  status: 'SCORED'; reason: 'EXACT_PUBLISHED_FINAL_PLAYER_ROW';
  receivingYards: number; outcome: 0 | 1;
  probabilities: Record<Variant, number>;
};
type UnresolvedRow = {
  receiptId: string; playerId: string | null; gameId: string | null;
  status: 'UNRESOLVED'; reason: string;
};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const probability = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(value);
const validTime = (value: unknown): value is string => typeof value === 'string'
  && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clip = (value: number) => Math.min(1 - 1e-15, Math.max(1e-15, value));

/** A final status is adapter-supplied source evidence, never inferred from the current clock. */
export async function evaluateReceivingForward(input: {
  owner: string;
  receipts: ForwardReceipt[];
  outcomes: ForwardOutcome[];
  source: ForwardOutcomeSource;
  cohortComplete: boolean;
}) {
  if (!input.owner) throw Error('AUTHENTICATION_REQUIRED');
  if (!Array.isArray(input.receipts) || !Array.isArray(input.outcomes) || typeof input.cohortComplete !== 'boolean')
    throw Error('INVALID_FORWARD_EVALUATION_INPUT');
  if (input.receipts.some(receipt => !receipt || receipt.owner !== input.owner)) throw Error('FORECAST_OWNER_MISMATCH');

  const frozen = await receivingForwardProtocol();
  const source = input.source;
  const window = source?.finalGameWindow;
  const windowValid = window === undefined || !!window
    && Number.isSafeInteger(window.offset) && window.offset >= 0 && window.offset <= 199
    && window.maximum === 8
    && Number.isSafeInteger(window.totalDueGames) && window.totalDueGames >= 0 && window.totalDueGames <= 200
    && Number.isSafeInteger(window.checked) && window.checked >= 0
    && window.checked === Math.min(8, Math.max(0, window.totalDueGames - window.offset))
    && window.nextOffset === (window.offset + window.checked < window.totalDueGames
      ? window.offset + window.checked : null);
  const sourceAvailable = !!source && source.status === 'AVAILABLE' && source.publicationClockVerified === false
    && windowValid
    && validTime(source.retrievedAt) && Array.isArray(source.files) && source.files.length > 0
    && source.files.every(file => typeof file.url === 'string' && /^https:\/\//.test(file.url)
      && hash(file.sha256) && validTime(file.observedAt) && Date.parse(file.observedAt) <= Date.parse(source.retrievedAt));
  const frozenSupported = protocol.schemaVersion === 1 && protocol.id === 'receiving60-forward-v1'
    && protocol.target.stat === 'receiving_yards' && protocol.target.threshold === 60
    && protocol.target.comparison === '>='
    && canonicalJson(protocol.variants) === canonicalJson(['selected', 'raw', 'trainBaseRate']);
  const key = (playerId: string, gameId: string) => JSON.stringify([playerId, gameId]);
  const receiptCounts = new Map<string, number>();
  for (const receipt of input.receipts) {
    const k = key(receipt.forecast?.playerId ?? '', receipt.forecast?.gameId ?? '');
    receiptCounts.set(k, (receiptCounts.get(k) ?? 0) + 1);
  }
  const outcomeRows = new Map<string, ForwardOutcome[]>();
  for (const row of input.outcomes) {
    if (!row || !identity(row.playerId) || !identity(row.gameId)) continue;
    const k = key(row.playerId, row.gameId);
    outcomeRows.set(k, [...(outcomeRows.get(k) ?? []), row]);
  }
  const rows: Array<ScoredRow | UnresolvedRow> = [];
  async function receiptProblem(receipt: ForwardReceipt): Promise<string | null> {
    if (!frozenSupported || receipt.protocolSha256 !== frozen.protocolSha256) return 'PROTOCOL_NOT_SUPPORTED';
    const f = receipt.forecast;
    if (!f || !identity(f.playerId) || !identity(f.gameId) || f.calculationStatus !== 'CALCULATED'
      || f.artifactSha256 !== protocol.artifactSha256 || f.modelVersion !== protocol.modelVersion
      || f.bettingDecision !== 'HOLD' || f.liveApproved !== false || f.executionEnabled !== false
      || ![f.probability, f.rawProbability, f.calibratedProbability, receipt.baselineProbability].every(probability)
      || receipt.baselineProbability !== protocol.baselineProbability) return 'FORECAST_RECEIPT_INTEGRITY_FAILURE';
    const {receiptSha256, ...payload} = receipt;
    if (!hash(receiptSha256) || receiptSha256 !== await forwardHash(canonicalJson(payload))
      || receipt.id !== 'forecast_' + await forwardHash(canonicalJson([protocol.artifactSha256, f.playerId, f.gameId])))
      return 'FORECAST_RECEIPT_INTEGRITY_FAILURE';
    if (![receipt.savedAt, f.decisionAt, f.kickoffAt].every(validTime)) return 'FORECAST_CLOCK_UNVERIFIED';
    const saved = Date.parse(receipt.savedAt), decision = Date.parse(f.decisionAt), kickoff = Date.parse(f.kickoffAt);
    if (saved < Date.parse(protocol.frozenAt) || decision > saved || saved - decision > protocol.maximumCalculationAgeSeconds * 1000
      || kickoff - saved < protocol.minimumLeadSeconds * 1000) return 'FORECAST_CLOCK_UNVERIFIED';
    // Reuse the archive's installed verification policy, including frozen-model
    // math/scope/source-clock checks. This in-memory list adapter performs no writes.
    const verifier = createReceivingForwardService({owner:input.owner,
      store:{get:async()=>null,add:async()=>false,list:async()=>({items:[receipt],nextToken:null})},
      forecast:(async()=>{throw Error('READ_ONLY_EVALUATION');}) as never});
    try { await verifier.history(); }
    catch { return 'FORECAST_RECEIPT_INTEGRITY_FAILURE'; }
    return null;
  }
  for (const receipt of input.receipts) {
    const f = receipt.forecast;
    const unresolved = (reason: string) => rows.push({receiptId:receipt.id, playerId:f?.playerId ?? null,
      gameId:f?.gameId ?? null, status:'UNRESOLVED', reason});
    const problem = await receiptProblem(receipt);
    if (problem) { unresolved(problem); continue; }
    if ((receiptCounts.get(key(f.playerId, f.gameId)) ?? 0) !== 1) { unresolved('DUPLICATE_ARCHIVED_SELECTION'); continue; }
    if (!sourceAvailable) {
      unresolved(!windowValid ? 'FINAL_GAME_WINDOW_INVALID'
        : source?.status === 'AVAILABLE' ? 'OUTCOME_SOURCE_EVIDENCE_INVALID'
          : source?.reason ?? 'OUTCOME_SOURCE_UNAVAILABLE');
      continue;
    }
    const matches = outcomeRows.get(key(f.playerId, f.gameId)) ?? [];
    if (matches.length === 1 && matches[0].finalStatus !== 'FINAL' && matches[0].unresolvedReason) {
      unresolved(matches[0].unresolvedReason); continue;
    }
    const eligible = matches.filter(row => row.seasonType === 'REG' && ['WR','RB','TE'].includes(row.position));
    if (eligible.length === 0) { unresolved(matches.length ? 'OUTCOME_OUTSIDE_FROZEN_SCOPE' : 'PUBLISHED_PLAYER_ROW_MISSING'); continue; }
    if (eligible.length !== 1) { unresolved('PUBLISHED_PLAYER_ROW_AMBIGUOUS'); continue; }
    const result = eligible[0];
    if (result.finalStatus !== 'FINAL') { unresolved(result.unresolvedReason ?? 'GAME_FINAL_STATUS_UNVERIFIED'); continue; }
    if (!finite(result.receivingYards) || !Number.isInteger(result.receivingYards)) { unresolved('RECEIVING_YARDS_INVALID'); continue; }
    if (Date.parse(source.retrievedAt) < Date.parse(f.kickoffAt)
      || source.files.some(file => Date.parse(file.observedAt) < Date.parse(f.kickoffAt))) {
      unresolved('OUTCOME_OBSERVED_BEFORE_KICKOFF'); continue;
    }
    rows.push({receiptId:receipt.id, playerId:f.playerId, gameId:f.gameId, status:'SCORED',
      reason:'EXACT_PUBLISHED_FINAL_PLAYER_ROW', receivingYards:result.receivingYards,
      outcome:result.receivingYards >= protocol.target.threshold ? 1 : 0,
      probabilities:{selected:f.probability,raw:f.rawProbability,trainBaseRate:receipt.baselineProbability}});
  }
  const scored = rows.filter((row): row is ScoredRow => row.status === 'SCORED');
  const scores = Object.fromEntries((['selected','raw','trainBaseRate'] as const).map(variant => {
    const metrics: Metrics | null = scored.length ? {
      n:scored.length,
      brier:scored.reduce((sum,row) => sum + (row.probabilities[variant]-row.outcome)**2,0)/scored.length,
      logLoss:scored.reduce((sum,row) => {const p=clip(row.probabilities[variant]);return sum-row.outcome*Math.log(p)-(1-row.outcome)*Math.log(1-p);},0)/scored.length,
    } : null;
    return [variant, metrics];
  })) as Record<Variant, Metrics | null>;
  return {
    schemaVersion:'edgeboard.receiving-forward-evaluation.v1',
    owner:input.owner, protocol: frozen.protocol, protocolSha256:frozen.protocolSha256,
    bettingDecision:'HOLD' as const, liveApproved:false as const, verifiedPositiveEv:false as const, executionEnabled:false as const,
    independentOfOdds:true as const, readOnly:true as const,
    evaluationStatus:!input.cohortComplete ? 'PARTIAL_COHORT' : scored.length ? 'DESCRIPTIVE_SCORES_AVAILABLE' : 'NO_SCORABLE_OUTCOMES',
    cohortComplete:input.cohortComplete,
    recordsIncluded:rows.length, scoredCount:scored.length, unresolvedCount:rows.length-scored.length,
    uniqueScoredGames:new Set(scored.map(row => row.gameId)).size,
    logLossClip:1e-15, scores, rows, source,
    limitations:[...protocol.limitations,
      'These proper scores describe only the manually selected archived receipts included here. They are not betting returns, an approval decision or proof of profitability.',
      'Missing, ambiguous, invalid and non-final outcomes remain unresolved, never losses.',
      'Outcome publication time is not independently verified. Results are as observed in the reported source files.',
      ...(!input.cohortComplete ? ['The receipt cohort is incomplete; counts and scores cover only included records, not the full private log.'] : []),
    ],
  };
}
