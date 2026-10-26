import { db } from '../../../runtime/sdk.ts';
import { wagerLedgerPayload } from '../shared/ledgerInput';

type Stored = { wagers: Record<string, unknown>[]; updatedAt: string };
const table = (userId: string) => 'wager_ledger:' + userId;
export async function getWagerLedger(userId: string) {
  const records = await db.list<Stored>(table(userId), { limit: 10 });
  const current = records.items[0];
  return {
    wagers: current?.wagers ?? [],
    updatedAt: current?.updatedAt ?? null,
    authenticated: true,
  };
}
export async function saveWagerLedger(userId: string, input: unknown) {
  const updatedAt = new Date().toISOString();
  const payload = wagerLedgerPayload(input, updatedAt);
  const wagers = payload.wagers;
  const records = await db.list<Stored>(table(userId), { limit: 10 });
  if (records.items[0]) {
    const [ok] = await db.update(table(userId), [
      { id: records.items[0].id, record: payload },
    ]);
    if (!ok) throw Error('Save failed');
  } else {
    const [id] = await db.add(table(userId), [payload]);
    if (!id) throw Error('Save failed');
  }
  return { count: wagers.length, updatedAt };
}
