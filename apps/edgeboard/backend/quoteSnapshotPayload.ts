import type { LiveQuote } from './liveTypes';

// Leave room for the SDK's request envelope beneath its 1 MiB input limit.
const REQUEST_BUDGET = 900_000;
const CHUNK_BUDGET = 180_000;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

export function quoteSnapshotItems(
  owner: string,
  eventId: string,
  kind: string,
  version: string,
  quotes: LiveQuote[],
) {
  const prefix = eventId + '_' + kind;
  const groups: LiveQuote[][] = [];
  let group: LiveQuote[] = [];
  let size = 2; // Array brackets.
  for (const quote of quotes) {
    if (quote.eventId !== eventId) throw Error('Quote belongs to another event.');
    const quoteBytes = bytes(quote);
    if (quoteBytes + 2 > CHUNK_BUDGET) throw Error('Individual quote exceeds archive limit.');
    if (size + quoteBytes + (group.length ? 1 : 0) > CHUNK_BUDGET) {
      groups.push(group);
      group = [];
      size = 2;
    }
    size += quoteBytes + (group.length ? 1 : 0);
    group.push(quote);
  }
  if (group.length) groups.push(group);
  if (groups.length > 12) throw Error('Quote snapshot exceeds the bounded archive limit.');
  const chunks = groups.map((_, i) => prefix + '_part_' + i);
  const items: Array<{ id: string; record: Record<string, unknown> }> = groups.map(
    (quotes, i) => ({ id: chunks[i], record: { owner, eventId, version, quotes } }),
  );
  items.push({ id: prefix + '_index', record: { owner, eventId, version, chunks } });
  if (bytes(items) > REQUEST_BUDGET) {
    throw Error('Quote snapshot exceeds the database request byte limit. No snapshot was written.');
  }
  return items;
}
