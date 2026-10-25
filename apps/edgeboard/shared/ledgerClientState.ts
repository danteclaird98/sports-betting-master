import { ledgerTime, validateWagers } from './ledgerInput';

export const LEDGER_PROTOCOL = 'revision-receipt-v1' as const;
export type PendingLedgerWrite = {
  protocol: typeof LEDGER_PROTOCOL;
  owner: string;
  requestId: string;
  expectedRevision: number;
  wagers: Record<string, unknown>[];
  draft?: Record<string, string>;
};

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const ledgerRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ownerPrefix = (owner: string) => {
  if (!owner || !owner.trim() || owner.length > 200) throw Error('Authenticated ledger owner is required.');
  return `edgeboard:ledger-pending:v1:${encodeURIComponent(owner)}:`;
};
const keyFor = (owner: string, requestId: string) => ownerPrefix(owner) + requestId;
const requestIdValid = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

function readPending(value: unknown, owner: string): PendingLedgerWrite {
  if (!object(value) || value.protocol !== LEDGER_PROTOCOL || value.owner !== owner ||
      !requestIdValid(value.requestId) || !ledgerRevision(value.expectedRevision) ||
      value.expectedRevision === Number.MAX_SAFE_INTEGER ||
      (value.draft !== undefined && (!object(value.draft) ||
        Object.values(value.draft).some(v => typeof v !== 'string')))) {
    throw Error('Stored pending ledger update is invalid. Preserve it for recovery; no update will be submitted.');
  }
  validateWagers(value.wagers);
  return freeze(value as PendingLedgerWrite);
}

export function createPendingLedgerWrite(
  owner: string,
  requestId: string,
  expectedRevision: number,
  wagers: unknown,
  draft?: Record<string, string>,
): PendingLedgerWrite {
  ownerPrefix(owner);
  // Detach the submitted data before any asynchronous request can observe edits.
  return readPending(JSON.parse(JSON.stringify({
    protocol: LEDGER_PROTOCOL, owner, requestId, expectedRevision, wagers, draft,
  })), owner);
}

export function pendingLedgerWrites(owner: string, storage: PendingStorage = localStorage): PendingLedgerWrite[] {
  const prefix = ownerPrefix(owner);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys.sort().map(key => {
    const pending = readPending(JSON.parse(storage.getItem(key) ?? 'null'), owner);
    if (key !== keyFor(owner, pending.requestId)) throw Error('Stored pending ledger identity does not match.');
    return pending;
  });
}

export function persistPendingLedgerWrite(pending: PendingLedgerWrite, storage: PendingStorage = localStorage) {
  const key = keyFor(pending.owner, pending.requestId);
  const serialized = JSON.stringify(pending);
  const previous = storage.getItem(key);
  if (previous !== null && previous !== serialized) throw Error('Pending request identity is already in use.');
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw Error('The pending update could not be retained. No save was attempted.');
}

export function forgetPendingLedgerWrite(pending: PendingLedgerWrite, storage: PendingStorage = localStorage) {
  // Delete only the confirmed request; another tab may have a separate pending update.
  const key = keyFor(pending.owner, pending.requestId);
  const previous = storage.getItem(key);
  if (previous !== null) {
    const stored = readPending(JSON.parse(previous), pending.owner);
    if (JSON.stringify(stored) !== JSON.stringify(pending)) throw Error('Pending update changed during recovery.');
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw Error('Confirmed pending update could not be cleared.');
  }
}

export function ledgerSaveResponse(value: unknown, pending: PendingLedgerWrite):
  'saved' | 'conflict' | 'unknown' | 'migration_required' {
  if (!object(value)) throw Error('Unverified ledger response.');
  if (value.status === 'saved') {
    const r = value.receipt;
    if (!object(r) || r.owner !== pending.owner || r.requestId !== pending.requestId ||
        r.expectedRevision !== pending.expectedRevision || r.revision !== pending.expectedRevision + 1 ||
        r.count !== pending.wagers.length || typeof r.payloadHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(r.payloadHash) || !ledgerTime(r.updatedAt)) throw Error('Unverified ledger receipt.');
    return 'saved';
  }
  if (value.status === 'conflict' && ledgerRevision(value.currentRevision)) return 'conflict';
  if (value.status === 'unknown' && value.requestId === pending.requestId) return 'unknown';
  if (value.status === 'migration_required') return 'migration_required';
  throw Error('Unverified ledger response.');
}
