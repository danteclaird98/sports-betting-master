import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ForwardWriteUnconfirmed, type ForwardReceipt, type ForwardStore } from './receivingForwardCore.ts';

const TABLE = 'eo_receiving_forward_receipts';

/** Dedicated append-only storage. Existing generic records and private exports are not migrated. */
export function createForwardSqliteStorage(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      id TEXT NOT NULL,
      body TEXT NOT NULL,
      UNIQUE(owner, id)
    );
    CREATE TRIGGER IF NOT EXISTS eo_receiving_forward_no_update
      BEFORE UPDATE ON ${TABLE} BEGIN SELECT RAISE(ABORT, 'append-only forward receipts'); END;
    CREATE TRIGGER IF NOT EXISTS eo_receiving_forward_no_delete
      BEFORE DELETE ON ${TABLE} BEGIN SELECT RAISE(ABORT, 'append-only forward receipts'); END;
  `);

  function forOwner(owner: string): ForwardStore {
    if (!owner) throw Error('AUTHENTICATION_REQUIRED');
    const ownerHash = createHash('sha256').update(owner).digest('hex');
    return {
      async get(id) {
        const row = database.prepare(`SELECT body FROM ${TABLE} WHERE owner=? AND id=?`).get(owner, id) as { body: string } | undefined;
        return row ? JSON.parse(row.body) as ForwardReceipt : null;
      },
      async add(record) {
        if (record.owner !== owner) throw Error('FORECAST_OWNER_MISMATCH');
        try {
          const result = database.prepare(`INSERT INTO ${TABLE}(owner,id,body) VALUES (?,?,?) ON CONFLICT(owner,id) DO NOTHING`)
            .run(owner, record.id, JSON.stringify(record));
          return Number(result.changes) === 1;
        } catch {
          // Do not interpret a failed response as proof no write committed; core performs one read.
          throw new ForwardWriteUnconfirmed('SAVE_UNCONFIRMED_RELOAD_HISTORY');
        }
      },
      async list(token) {
        let after = 0;
        if (token !== undefined) {
          try {
            const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
            if (decoded.ownerHash !== ownerHash || !Number.isSafeInteger(decoded.after) || decoded.after < 0) throw Error();
            after = decoded.after;
          } catch { throw Error('INVALID_HISTORY_TOKEN'); }
        }
        const rows = database.prepare(`SELECT seq,body FROM ${TABLE} WHERE owner=? AND seq>? ORDER BY seq LIMIT 11`)
          .all(owner, after) as Array<{ seq: number; body: string }>;
        return {
          items: rows.slice(0, 10).map(row => JSON.parse(row.body) as ForwardReceipt),
          nextToken: rows.length > 10 ? Buffer.from(JSON.stringify({ ownerHash, after: rows[9].seq })).toString('base64url') : null,
        };
      },
    };
  }
  return { forOwner, close: () => database.close() };
}
