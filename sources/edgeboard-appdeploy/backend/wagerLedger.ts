import { db } from '@appdeploy/sdk';

type Stored = { wagers: Record<string, unknown>[]; updatedAt: string };
const table = (userId: string) => 'wager_ledger:' + userId;
function validate(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input) || input.length > 1000) throw Error('Invalid wager collection');
  const ids = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Invalid wager');
    const w = item as Record<string, unknown>;
    if (typeof w.id !== 'string' || !w.id || ids.has(w.id) ||
        !['actual','paper'].includes(String(w.mode)) ||
        !['open','win','loss','push','void','cashout','partial'].includes(String(w.status)) ||
        !['single','parlay'].includes(String(w.betType)) ||
        !Number.isFinite(w.stake) || Number(w.stake) <= 0 ||
        !Number.isFinite(w.decimalOdds) || Number(w.decimalOdds) <= 1 ||
        !Number.isFinite(w.payout) || Number(w.payout) < 0 ||
        !Number.isFinite(w.fees) || Number(w.fees) < 0 ||
        typeof w.event !== 'string' || typeof w.sportsbook !== 'string' ||
        typeof w.selection !== 'string' || typeof w.placedAt !== 'string' ||
        !Array.isArray(w.history) || w.history.length > 500) throw Error('Invalid or duplicate wager');
    ids.add(w.id);
  }
  return input as Record<string, unknown>[];
}
export async function getWagerLedger(userId: string) {
  const records = await db.list<Stored>(table(userId), { limit: 10 });
  const current = records.items[0];
  return { wagers: current?.wagers ?? [], updatedAt: current?.updatedAt ?? null, authenticated: true };
}
export async function saveWagerLedger(userId: string, input: unknown) {
  const wagers = validate(input);
  const records = await db.list<Stored>(table(userId), { limit: 10 });
  const updatedAt = new Date().toISOString();
  const payload = { wagers, updatedAt };
  if (records.items[0]) {
    const [ok] = await db.update(table(userId), [{ id: records.items[0].id, record: payload }]);
    if (!ok) throw Error('Save failed');
  } else {
    const [id] = await db.add(table(userId), [payload]);
    if (!id) throw Error('Save failed');
  }
  return { count: wagers.length, updatedAt };
}
