import { db } from '../../../runtime/sdk.ts';
import type { LiveQuote } from './liveTypes';
import { quoteSnapshotItems } from './quoteSnapshotPayload';

const tableFor = (userId: string) => {
  if (!userId || userId.length > 48)
    throw Error('Authenticated quote owner is required.');
  return (
    'live_quotes_' +
    Array.from(userId)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
};
type Index = {
  owner: string;
  eventId: string;
  version: string;
  chunks: string[];
};
type Chunk = {
  owner: string;
  eventId: string;
  version: string;
  quotes: LiveQuote[];
};
export async function saveLiveSnapshot(
  userId: string,
  eventId: string,
  kind: string,
  quotes: LiveQuote[]
) {
  if (!/^\d{6,12}$/.test(eventId) || !['periods', 'props'].includes(kind))
    throw Error('Invalid quote snapshot identity.');
  const table = tableFor(userId),
    version = new Date().toISOString();
  const items = quoteSnapshotItems(userId, eventId, kind, version, quotes);
  // One atomic update keeps the index and all bounded chunks together. Never
  // retry an unknown write outcome or trigger another provider request here.
  const result = await db.transact(
    items.map(item => db.tx.update(table, [item]))
  );
  if (result.some(group => group.some(value => !value)))
    throw Error('Quote snapshot was not fully saved.');
  return { stored: true, version, quoteCount: quotes.length };
}
export async function readLiveSnapshots(userId: string, eventId: string) {
  if (!/^\d{6,12}$/.test(eventId)) throw Error('Invalid event identity.');
  const table = tableFor(userId),
    ids = ['periods', 'props'].map(kind => eventId + '_' + kind + '_index');
  const indices = await db.get<Index>(table, ids, { consistent: true });
  const out: LiveQuote[] = [];
  for (const index of indices) {
    if (!index) continue;
    if (
      index.owner !== userId ||
      index.eventId !== eventId ||
      !Array.isArray(index.chunks) ||
      index.chunks.length > 12
    )
      throw Error('Quote archive ownership or scope mismatch.');
    if (!index.chunks.length) continue;
    const chunks = await db.get<Chunk>(table, index.chunks, {
      consistent: true,
    });
    for (const chunk of chunks) {
      if (
        !chunk ||
        chunk.owner !== userId ||
        chunk.eventId !== eventId ||
        chunk.version !== index.version
      )
        throw Error(
          'Quote snapshot changed or was incomplete; refresh instead of using mixed observations.'
        );
      out.push(...chunk.quotes);
    }
  }
  return [...new Map(out.map(quote => [quote.id, quote])).values()];
}
