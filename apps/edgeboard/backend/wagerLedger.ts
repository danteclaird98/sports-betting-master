/** Revision-bound wager ledger writes over the existing Master SQLite store.
 * Legacy records are read in place and upgraded on their first revision-bound save.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { wagerLedgerPayload, validateWagers } from '../shared/ledgerInput';

const protocol = 'revision-receipt-v1' as const;
const collection = (owner: string) => 'wager_ledger:' + owner;
const validRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

function database(owner: string) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 200) {
    throw Error('Authenticated ledger owner required');
  }
  // This is the same file and records schema used by runtime/sdk.ts.
  const path = process.env.EDGEBOARD_DB || 'data/edgeboard.sqlite3';
  mkdirSync(dirname(path), { recursive: true });
  const sql = new DatabaseSync(path);
  try {
    sql.exec(
      "PRAGMA busy_timeout=10000;" +
      "CREATE TABLE IF NOT EXISTS records (" +
      "seq INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, " +
      "id TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(collection,id));" +
      "CREATE TABLE IF NOT EXISTS wager_write_receipts (" +
      "owner TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, " +
      "receipt TEXT NOT NULL, PRIMARY KEY(owner,request_id));" +
      "CREATE TRIGGER IF NOT EXISTS wager_write_receipts_no_update " +
      "BEFORE UPDATE ON wager_write_receipts BEGIN " +
      "SELECT RAISE(ABORT,'Wager write receipts are append-only'); END;" +
      "CREATE TRIGGER IF NOT EXISTS wager_write_receipts_no_delete " +
      "BEFORE DELETE ON wager_write_receipts BEGIN " +
      "SELECT RAISE(ABORT,'Wager write receipts are append-only'); END;"
    );
    return sql;
  } catch (failure) {
    sql.close();
    throw failure;
  }
}

function readCurrent(sql: DatabaseSync, owner: string) {
  const rows = sql.prepare(
    'SELECT id,body FROM records WHERE collection=? ORDER BY seq DESC LIMIT 2',
  ).all(collection(owner)) as Array<{ id: string; body: string }>;
  if (rows.length > 1) {
    throw Error('Multiple legacy ledgers require review; no records were merged or removed');
  }
  if (!rows.length) {
    return {
      id: null as string | null,
      wagers: [] as Record<string, unknown>[],
      revision: 0,
      updatedAt: null as string | null,
    };
  }
  const stored = JSON.parse(rows[0].body) as Record<string, unknown>;
  const revision = stored.revision === undefined ? 0 : stored.revision;
  if (!validRevision(revision)) throw Error('Stored ledger revision invalid; recovery required');
  if (stored.revision === undefined && !Array.isArray(stored.wagers)) {
    throw Error('Legacy ledger is malformed; no records were changed');
  }
  return {
    id: rows[0].id,
    wagers: validateWagers(stored.wagers),
    revision,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value as Record<string, unknown>).sort()
      .map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key]))
      .join(',') + '}';
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw Error('Unsupported ledger request value');
  return encoded;
}

function buildRequest(owner: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Reload the ledger before saving: a revision-bound request is required');
  }
  const body = value as Record<string, unknown>;
  const allowed = ['action', 'owner', 'requestId', 'expectedRevision', 'wagers'];
  if (
    Object.keys(body).some(key => !allowed.includes(key)) ||
    !['save', 'reconcile'].includes(body.action as string) ||
    body.owner !== owner ||
    typeof body.requestId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.requestId) ||
    !validRevision(body.expectedRevision) ||
    body.expectedRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw Error('Invalid revision-bound ledger request');
  }
  const payload = wagerLedgerPayload(body.wagers, new Date().toISOString());
  const hash = createHash('sha256')
    .update(canonical({ expectedRevision: body.expectedRevision, wagers: payload.wagers }))
    .digest('hex');
  return {
    action: body.action as 'save' | 'reconcile',
    requestId: body.requestId,
    expectedRevision: body.expectedRevision,
    payload,
    hash,
  };
}

export async function getWagerLedger(owner: string) {
  const sql = database(owner);
  try {
    const current = readCurrent(sql, owner);
    return {
      wagers: current.wagers,
      updatedAt: current.updatedAt,
      authenticated: true,
      owner,
      protocol,
      revision: current.revision,
    };
  } finally {
    sql.close();
  }
}

export async function saveWagerLedger(owner: string, input: unknown) {
  const write = buildRequest(owner, input);
  const sql = database(owner);
  try {
    sql.exec('BEGIN IMMEDIATE');
    try {
      const saved = sql.prepare(
        'SELECT payload_hash,receipt FROM wager_write_receipts WHERE owner=? AND request_id=?',
      ).get(owner, write.requestId) as { payload_hash: string; receipt: string } | undefined;
      if (saved) {
        if (saved.payload_hash !== write.hash) {
          throw Error('Request ID already belongs to a different ledger update');
        }
        const receipt = JSON.parse(saved.receipt);
        sql.exec('COMMIT');
        return { status: 'saved', receipt };
      }

      // Reconciliation is read-only. A missing receipt never authorizes a retry.
      if (write.action === 'reconcile') {
        sql.exec('COMMIT');
        return { status: 'unknown', requestId: write.requestId };
      }

      const current = readCurrent(sql, owner);
      if (current.revision !== write.expectedRevision) {
        sql.exec('COMMIT');
        return { status: 'conflict', currentRevision: current.revision };
      }

      const revision = current.revision + 1;
      const body = { ...write.payload, revision };
      const receipt = {
        owner,
        requestId: write.requestId,
        expectedRevision: write.expectedRevision,
        revision,
        count: write.payload.wagers.length,
        payloadHash: write.hash,
        updatedAt: write.payload.updatedAt,
      };
      if (current.id) {
        const result = sql.prepare(
          'UPDATE records SET body=? WHERE collection=? AND id=?',
        ).run(JSON.stringify(body), collection(owner), current.id);
        if (Number(result.changes) !== 1) throw Error('Ledger update failed');
      } else {
        sql.prepare(
          'INSERT INTO records(collection,id,body) VALUES (?,?,?)',
        ).run(collection(owner), randomUUID(), JSON.stringify(body));
      }
      sql.prepare(
        'INSERT INTO wager_write_receipts(owner,request_id,payload_hash,receipt) VALUES (?,?,?,?)',
      ).run(owner, write.requestId, write.hash, JSON.stringify(receipt));

      sql.exec('COMMIT');
      return { status: 'saved', receipt };
    } catch (failure) {
      try { sql.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw failure;
    }
  } finally {
    sql.close();
  }
}
