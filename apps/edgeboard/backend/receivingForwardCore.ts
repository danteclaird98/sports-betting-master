import protocol from './receivingForwardProtocol.json' with { type: 'json' };
import artifact from './correctedReceivingArtifact.json' with { type: 'json' };
import manifest from './correctedReceivingManifest.json' with { type: 'json' };
import { canonicalJson } from './correctedReceiving.ts';
import type { receivingForecast } from './receivingForecast.ts';

type Forecast = Extract<Awaited<ReturnType<typeof receivingForecast>>, { calculationStatus: 'CALCULATED' }>;
export type ForwardReceipt = {
  id: string;
  owner: string;
  protocolSha256: string;
  savedAt: string;
  forecast: Forecast;
  baselineProbability: number;
  receiptSha256: string;
};
export interface ForwardStore {
  get(id: string): Promise<ForwardReceipt | null>;
  add(record: ForwardReceipt): Promise<boolean>;
  list(token?: string): Promise<{ items: ForwardReceipt[]; nextToken: string | null }>;
}
export class ForwardWriteUnconfirmed extends Error {}
export const forwardHash = async (text: string) => [...new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
)].map(n => n.toString(16).padStart(2, '0')).join('');
const identity = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(value);
const probability = (value: unknown): value is number => typeof value === 'number'
  && Number.isFinite(value) && value >= 0 && value <= 1;
const frozenModel = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
const sigmoid = (z: number) => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));

/** Verification only: never overwrite saved probabilities with newly computed values. */
async function matchesFrozenModel(forecast: Forecast): Promise<boolean> {
  const features = forecast.features;
  if (!Array.isArray(features) || features.length !== 5
    || !features.every(value => typeof value === 'number' && Number.isFinite(value))
    || !features.slice(2, 4).every(value => value >= 0 && value <= 1)
    || !Number.isSafeInteger(features[4]) || features[4] < 3
    || manifest.sourceArtifactSha256 !== protocol.artifactSha256
    || await forwardHash(canonicalJson(frozenModel)) !== manifest.canonicalArtifactSha256) return false;
  const logit = frozenModel.intercept + features.reduce((sum, value, i) =>
    sum + frozenModel.coefficients[i] * (value - frozenModel.mean[i]) / frozenModel.scale[i], 0);
  const raw = sigmoid(logit);
  const calibrated = sigmoid(frozenModel.calibration.intercept + frozenModel.calibration.slope * logit);
  return Math.abs(forecast.rawProbability - raw) <= 1e-12
    && Math.abs(forecast.calibratedProbability - calibrated) <= 1e-12
    && Math.abs(forecast.probability - (frozenModel.calibration.selected ? calibrated : raw)) <= 1e-12;
}

export async function receivingForwardProtocol() {
  return { protocol, protocolSha256: await forwardHash(canonicalJson(protocol)),
    independentOfOdds: true, bettingDecision: 'HOLD', liveApproved: false, executionEnabled: false };
}

/** Only server-calculated forecasts enter the log; client probabilities/timestamps are rejected. */
export function createReceivingForwardService(deps: {
  owner: string;
  store: ForwardStore;
  forecast: typeof receivingForecast;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  async function key(playerId: string, gameId: string) {
    return 'forecast_' + await forwardHash(canonicalJson([protocol.artifactSha256, playerId, gameId]));
  }
  async function verified(record: ForwardReceipt): Promise<ForwardReceipt> {
    if (!record || record.owner !== deps.owner) throw Error('FORECAST_OWNER_MISMATCH');
    const { receiptSha256, ...payload } = record;
    const f = record.forecast;
    const saved = Date.parse(record.savedAt), decision = Date.parse(f?.decisionAt), kickoff = Date.parse(f?.kickoffAt);
    if (record.protocolSha256 !== (await receivingForwardProtocol()).protocolSha256
      || !f || f.calculationStatus !== 'CALCULATED' || f.artifactSha256 !== protocol.artifactSha256
      || f.modelVersion !== protocol.modelVersion || !identity(f.playerId) || !identity(f.gameId)
      || f.bettingDecision !== 'HOLD' || f.liveApproved !== false || f.executionEnabled !== false
      || f.verifiedPositiveEv !== false || f.scope !== 'CONDITIONAL_RECORDED_PLAYER_RECEIVING_60_PLUS'
      || ![f.probability, f.rawProbability, f.calibratedProbability, record.baselineProbability].every(probability)
      || record.baselineProbability !== protocol.baselineProbability
      || ![saved, decision, kickoff].every(Number.isFinite)
      || saved < Date.parse(protocol.frozenAt) || decision < Date.parse(protocol.frozenAt) || decision > saved
      || !Number.isFinite(Date.parse(f.sourceReceipt?.retrievedAt))
      || Date.parse(f.sourceReceipt.retrievedAt) > decision
      || saved - decision > protocol.maximumCalculationAgeSeconds * 1000
      || kickoff - saved < protocol.minimumLeadSeconds * 1000
      || record.id !== await key(f.playerId, f.gameId)
      || !await matchesFrozenModel(f)
      || receiptSha256 !== await forwardHash(canonicalJson(payload))) throw Error('FORECAST_RECEIPT_INTEGRITY_FAILURE');
    return record;
  }
  async function save(body: unknown) {
    if (!deps.owner) throw Error('AUTHENTICATION_REQUIRED');
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join('|') !== 'gameId|playerId') throw Error('INVALID_FORECAST_ARCHIVE_REQUEST');
    const { playerId, gameId } = body as Record<string, unknown>;
    if (!identity(playerId) || !identity(gameId)) throw Error('INVALID_FORECAST_IDENTITY');
    const id = await key(playerId, gameId);
    const existing = await deps.store.get(id);
    if (existing) return { saveStatus: 'EXISTING' as const, item: await verified(existing) };
    const forecast = await deps.forecast({ playerId, gameId });
    if (forecast.calculationStatus !== 'CALCULATED') throw Error('FORECAST_UNAVAILABLE_NOT_SAVED');
    const savedAt = new Date(now()).toISOString();
    const payload = { id, owner: deps.owner, protocolSha256: (await receivingForwardProtocol()).protocolSha256,
      savedAt, forecast, baselineProbability: protocol.baselineProbability };
    const record = await verified({ ...payload, receiptSha256: await forwardHash(canonicalJson(payload)) });
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 48_000) throw Error('FORECAST_RECEIPT_TOO_LARGE');
    // Recheck after hashing/source work, immediately before submitting the chosen-ID add.
    if (Date.parse(forecast.kickoffAt) - now() < protocol.minimumLeadSeconds * 1000
      || now() < Date.parse(savedAt)) throw Error('TOO_CLOSE_TO_KICKOFF_NOT_SAVED');
    try {
      if (await deps.store.add(record)) return { saveStatus: 'SAVED' as const, item: record };
    } catch (failure) {
      if (!(failure instanceof ForwardWriteUnconfirmed)) throw failure;
    }
    // Duplicate/unknown write: one strong read; no new ID or blind write retry.
    const committed = await deps.store.get(id);
    if (!committed) throw Error('SAVE_UNCONFIRMED_RELOAD_HISTORY');
    return { saveStatus: 'EXISTING' as const, item: await verified(committed) };
  }
  async function history(token?: string) {
    if (!deps.owner) throw Error('AUTHENTICATION_REQUIRED');
    if (token !== undefined && (typeof token !== 'string' || token.length > 3000)) throw Error('INVALID_HISTORY_TOKEN');
    const page = await deps.store.list(token);
    return { items: await Promise.all(page.items.map(verified)), nextToken: page.nextToken };
  }
  return { save, history };
}
