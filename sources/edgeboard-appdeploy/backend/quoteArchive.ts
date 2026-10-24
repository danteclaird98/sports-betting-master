import { db } from '@appdeploy/sdk';
type Quote = { eventId: string | null; market: string; selection: string; line: number | null; americanOdds: number; oddsAt: string | null; sportsbook: string; period: string; startTime: string | null; event: string | null; player: string | null };
const table = (userId: string) => 'odds_snapshots:' + userId;
export async function saveQuoteBatch(userId: string, payload: unknown) {
  const body = payload as { sport?: string; quotes?: Quote[] };
  if (!body || typeof body.sport !== 'string' || !Array.isArray(body.quotes) || body.quotes.length < 1 || body.quotes.length > 50) throw Error('Require 1–50 observations per save');
  const observedAt = new Date().toISOString();
  const valid = body.quotes.map(q => {
    if (!q || q.sportsbook !== 'Caesars' || typeof q.market !== 'string' || typeof q.selection !== 'string' || !Number.isFinite(q.americanOdds) || Math.abs(q.americanOdds) < 100) throw Error('Invalid quote');
    return { ...q, sport: body.sport, capturedAt: observedAt, provenance: 'user-initiated EdgeBoard ParlayAPI observation', independentValidation: false };
  });
  const [id] = await db.add(table(userId), [{ observedAt, sport: body.sport, observations: valid }]);
  if (!id) throw Error('Archive failed');
  return { archiveId: id, observations: valid.length, observedAt, researchOnly: true };
}
export async function listQuoteBatches(userId: string) {
  const result = await db.list<{ observedAt: string; sport: string; observations: Quote[] }>(table(userId), { limit: 30 });
  return { batches: result.items.map(item => ({ id: item.id, observedAt: item.observedAt, sport: item.sport, count: item.observations?.length ?? 0 })), nextToken: result.nextToken ?? null };
}
