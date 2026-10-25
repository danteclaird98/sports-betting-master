export function ledgerNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: a finite number is required`);
  }
  return value;
}

export function ledgerTime(value: unknown): value is string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(value.slice(11, 13)) < 24;
}

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateWagers(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input) || input.length > 1000) throw Error('Invalid wager collection');
  const ids = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('Invalid wager');
    const w = item as Record<string, unknown>;
    if (!text(w.id) || ids.has(w.id) ||
        !['actual', 'paper'].includes(String(w.mode)) ||
        !['open', 'win', 'loss', 'push', 'void', 'cashout', 'partial'].includes(String(w.status)) ||
        !['single', 'parlay'].includes(String(w.betType)) ||
        ledgerNumber(w.stake, 'stake') <= 0 || ledgerNumber(w.decimalOdds, 'odds') <= 1 ||
        ledgerNumber(w.payout, 'payout') < 0 || ledgerNumber(w.fees, 'fees') < 0 ||
        !text(w.event) || !text(w.sportsbook) || !text(w.selection) ||
        !text(w.currency) || !ledgerTime(w.placedAt) ||
        typeof w.settlementConfirmed !== 'boolean' ||
        (w.status === 'open' && w.settlementConfirmed) ||
        !Array.isArray(w.history) || w.history.length > 500 ||
        w.history.some(h => !h || typeof h !== 'object' || Array.isArray(h) ||
          !ledgerTime(h.at) || !text(h.action) || typeof h.detail !== 'string')) {
      throw Error('Invalid or duplicate wager');
    }
    ids.add(w.id);
  }
  return input as Record<string, unknown>[];
}

export function wagerLedgerPayload(input: unknown, updatedAt: string) {
  const payload = { wagers: validateWagers(input), updatedAt };
  // The database stores this whole ledger in one item (256 KiB ceiling).
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 240_000) {
    throw Error('Wager ledger exceeds the storage size limit. No save was attempted.');
  }
  return payload;
}
