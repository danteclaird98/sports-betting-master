import { db } from '@appdeploy/sdk';
import { scoreProbabilities } from './researchControls';

export type PredictionSnapshot = {
  sourceDecisionId: string;
  eventId: string;
  event: string;
  sport: string;
  market: string;
  selection: string;
  line: number | null;
  sportsbook: string;
  decimalOdds: number;
  oddsAt: string;
  decisionAt: string;
  featureAvailableAt: string;
  modelTrainedThrough: string;
  modelVersion: string;
  probability: number;
  probabilityLow: number;
  probabilityHigh: number;
  researchStatus: 'ABSTAIN' | 'PASSES_RESEARCH';
  reasonsToAbstain: string[];
  supportingEvidence: string[];
  sources: Array<{ source: string; observedAt: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
  outcome: 'win' | 'loss' | 'push' | 'void' | null;
  settledAt: string | null;
  correctionHistory: Array<{ at: string; action: string; detail: string }>;
};

type PredictionWithId = PredictionSnapshot & { id: string };

function table(userId: string) {
  return `research_predictions:${userId}`;
}

function cleanText(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanTime(value: unknown, fallback?: string) {
  const text = cleanText(value, 80);
  if (text && Number.isFinite(Date.parse(text)) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return text;
  if (fallback) return fallback;
  throw new Error('timestamp with timezone required');
}

function probability(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`invalid ${label}`);
  return parsed;
}

function finite(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid ${label}`);
  return parsed;
}

function stringArray(value: unknown, limit = 20) {
  return Array.isArray(value)
    ? value.map(item => cleanText(item, 500)).filter(Boolean).slice(0, limit)
    : [];
}

function sourceArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const source = cleanText(row.source, 120);
    const observedAt = cleanText(row.observedAt, 80);
    if (!source || !observedAt || !Number.isFinite(Date.parse(observedAt))) return [];
    return [{
      source,
      observedAt,
      detail: cleanText(row.detail, 300) || undefined,
    }];
  });
}

function normalizeSnapshot(body: Record<string, unknown>): PredictionSnapshot {
  const now = new Date().toISOString();
  const p = probability(body.probability, 'probability');
  const low = probability(body.probabilityLow, 'probability low');
  const high = probability(body.probabilityHigh, 'probability high');
  if (!(low <= p && p <= high)) throw new Error('invalid uncertainty ordering');
  const decimalOdds = finite(body.decimalOdds, 'decimal odds');
  if (decimalOdds <= 1) throw new Error('decimal odds must exceed 1');
  const event = cleanText(body.event, 300);
  const market = cleanText(body.market, 200);
  const selection = cleanText(body.selection, 200);
  const sourceDecisionId = cleanText(body.sourceDecisionId, 300);
  if (!event || !market || !selection || !sourceDecisionId) {
    throw new Error('event, market, selection and sourceDecisionId are required');
  }
  const decisionAt = cleanTime(body.decisionAt);
  const oddsAt = cleanTime(body.oddsAt);
  const featureAvailableAt = cleanTime(body.featureAvailableAt, decisionAt);
  const modelTrainedThrough = cleanTime(body.modelTrainedThrough, '1970-01-01T00:00:00Z');
  return {
    sourceDecisionId,
    eventId: cleanText(body.eventId, 200) || sourceDecisionId,
    event,
    sport: cleanText(body.sport, 80),
    market,
    selection,
    line: body.line === null || body.line === undefined || body.line === '' ? null : finite(body.line, 'line'),
    sportsbook: cleanText(body.sportsbook, 120),
    decimalOdds,
    oddsAt,
    decisionAt,
    featureAvailableAt,
    modelTrainedThrough,
    modelVersion: cleanText(body.modelVersion, 120) || 'unknown',
    probability: p,
    probabilityLow: low,
    probabilityHigh: high,
    researchStatus: body.researchStatus === 'PASSES_RESEARCH' ? 'PASSES_RESEARCH' : 'ABSTAIN',
    reasonsToAbstain: stringArray(body.reasonsToAbstain),
    supportingEvidence: stringArray(body.supportingEvidence),
    sources: sourceArray(body.sources),
    createdAt: now,
    updatedAt: now,
    outcome: null,
    settledAt: null,
    correctionHistory: [{ at: now, action: 'archived', detail: 'Research snapshot saved before outcome entry.' }],
  };
}

export async function listPredictionLedger(userId: string, limit = 100) {
  const bounded = Math.min(200, Math.max(1, limit));
  const { items, nextToken } = await db.list<PredictionSnapshot>(table(userId), { limit: bounded });
  const ordered = [...items].sort((a, b) => Date.parse(b.decisionAt) - Date.parse(a.decisionAt));
  const settled = ordered.filter(
    row => (row.outcome === 'win' || row.outcome === 'loss') && row.settledAt
  );
  const metrics = settled.length
    ? scoreProbabilities(
        settled.map(row => row.probability),
        settled.map(row => row.outcome === 'win' ? 1 : 0)
      )
    : null;
  return {
    items: ordered,
    nextToken: nextToken ?? null,
    diagnostics: {
      label: 'observational ledger diagnostics — not a held-out test',
      settledBinaryCount: settled.length,
      metrics,
      warning: 'These scores mix archived decisions unless you separately freeze chronological train/validation/test boundaries. They do not establish profitability.',
    },
  };
}

export async function archivePrediction(userId: string, rawBody: unknown) {
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : {};
  const snapshot = normalizeSnapshot(body);
  const existing = await db.list<PredictionSnapshot>(table(userId), { limit: 150 });
  const duplicate = existing.items.find(item =>
    item.sourceDecisionId === snapshot.sourceDecisionId &&
    item.oddsAt === snapshot.oddsAt
  );
  if (duplicate) return { duplicate: true, item: duplicate };

  const [id] = await db.add(table(userId), [snapshot]);
  if (!id) throw new Error('failed to archive research snapshot');
  return { duplicate: false, item: { ...snapshot, id } };
}

export async function settlePrediction(userId: string, rawBody: unknown) {
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : {};
  const id = cleanText(body.id, 200);
  if (!id) throw new Error('prediction id required');
  const outcome = body.outcome;
  if (!['win', 'loss', 'push', 'void'].includes(String(outcome))) {
    throw new Error('unsupported outcome');
  }
  const [existing] = await db.get<PredictionSnapshot>(table(userId), [id]);
  if (!existing) throw new Error('prediction not found');
  const settledAt = cleanTime(body.settledAt, new Date().toISOString());
  const now = new Date().toISOString();
  const updated: PredictionSnapshot = {
    ...existing,
    outcome: outcome as PredictionSnapshot['outcome'],
    settledAt,
    updatedAt: now,
    correctionHistory: [
      ...(existing.correctionHistory ?? []).slice(-49),
      {
        at: now,
        action: existing.outcome ? 'settlement corrected' : 'settlement recorded',
        detail: `${existing.outcome ?? 'pending'} -> ${String(outcome)} at ${settledAt}`,
      },
    ],
  };
  const [ok] = await db.update(table(userId), [{ id, record: updated }]);
  if (!ok) throw new Error('failed to update prediction');
  return { item: { ...updated, id } };
}
