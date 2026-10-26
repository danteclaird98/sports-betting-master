/** Shared provider-account admission ledger. All consumers of an API account must
 * use this same durable SQLite file/account. Out-of-band usage is not preventable;
 * configure its month-start usage and reconcile provider headers conservatively.
 * Reservations survive failures/unknown outcomes and are never refunded/retried.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const MONTHLY_CREDITS = 500;
export const LIVE_REQUEST_CREDITS = 1; // one region × h2h; historical unsupported
export const utcMonth = (now = new Date()) => now.toISOString().slice(0, 7);
export type Reservation = { id: string; month: string };

export class OddsApiQuota {
  private db: DatabaseSync;
  private account: string;
  constructor(path: string, account: string, month: string, initialUsed: number) {
    if (!isAbsolute(path) || path === ':memory:' || !account.trim() || !/^\d{4}-\d{2}$/.test(month)
      || !Number.isSafeInteger(initialUsed) || initialUsed < 0 || initialUsed > MONTHLY_CREDITS)
      throw Error('ODDS_API_BUDGET_NOT_CONFIGURED');
    this.account = account;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=10000;
      CREATE TABLE IF NOT EXISTS odds_api_budget(account TEXT NOT NULL, month TEXT NOT NULL,
        spent INTEGER NOT NULL CHECK(spent BETWEEN 0 AND 500), PRIMARY KEY(account,month));
      CREATE TABLE IF NOT EXISTS odds_api_reservations(id TEXT PRIMARY KEY, account TEXT NOT NULL,
        month TEXT NOT NULL, reconciled INTEGER NOT NULL DEFAULT 0);`);
    // Reconfiguration may raise usage, never lower an existing ledger.
    this.db.prepare(`INSERT INTO odds_api_budget VALUES(?,?,?) ON CONFLICT(account,month)
      DO UPDATE SET spent=MAX(spent,excluded.spent)`).run(account, month, initialUsed);
  }
  reserve(now = new Date()): Reservation {
    const month = utcMonth(now), id = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(`UPDATE odds_api_budget SET spent=spent+1
        WHERE account=? AND month=? AND spent<500`).run(this.account, month);
      if (Number(result.changes) !== 1) throw Error('ODDS_API_BUDGET_EXHAUSTED_OR_MONTH_UNCONFIGURED');
      this.db.prepare('INSERT INTO odds_api_reservations(id,account,month) VALUES(?,?,?)').run(id,this.account,month);
      this.db.exec('COMMIT');
      return {id,month};
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  reconcile(receipt: Reservation, headers: Headers): void {
    const read = (name: string) => {
      const value = headers.get(name);
      if (value === null) return null;
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error('INVALID_QUOTA_HEADER');
      return Number(value);
    };
    let used: number | null, remaining: number | null, last: number | null;
    try { used=read('x-requests-used'); remaining=read('x-requests-remaining'); last=read('x-requests-last'); }
    catch { used=MONTHLY_CREDITS; remaining=0; last=null; }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const changed=this.db.prepare(`UPDATE odds_api_reservations SET reconciled=1
        WHERE id=? AND account=? AND month=? AND reconciled=0`).run(receipt.id,this.account,receipt.month);
      if (Number(changed.changes) === 1) {
        const pending = Number((this.db.prepare('SELECT COUNT(*) n FROM odds_api_reservations WHERE account=? AND month=? AND reconciled=0').get(this.account,receipt.month) as {n:number}).n);
        this.db.prepare(`UPDATE odds_api_budget SET spent=MIN(500,MAX(spent+?, ?, ?)) WHERE account=? AND month=?`)
          .run(Math.max(0,(last ?? 1)-1),used === null ? 0 : used+pending,remaining === null ? 0 : Math.max(0,MONTHLY_CREDITS-remaining)+pending,this.account,receipt.month);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  spent(month = utcMonth()): number | null {
    const row=this.db.prepare('SELECT spent FROM odds_api_budget WHERE account=? AND month=?').get(this.account,month) as {spent:number}|undefined;
    return row?.spent ?? null;
  }
  close() { this.db.close(); }
}

export function configuredOddsApiQuota(): OddsApiQuota {
  if (process.env.ODDS_API_ENABLED !== 'true' || process.env.ODDS_API_BUDGET_MONTH !== utcMonth()
      || !/^\d+$/.test(process.env.ODDS_API_MONTH_START_USED ?? '')) throw Error('ODDS_API_BUDGET_NOT_CONFIGURED');
  return new OddsApiQuota(process.env.EDGEBOARD_DB ?? '',process.env.ODDS_API_BUDGET_ACCOUNT ?? '',
    process.env.ODDS_API_BUDGET_MONTH,Number(process.env.ODDS_API_MONTH_START_USED));
}

/** Startup hook: no scheduler is enabled; explicit calls cost one credit each. */
export function logOddsApiProjection(log: (message: string) => void = console.info) {
  log(JSON.stringify({provider:'The Odds API',monthlyBudget:500,projectedScheduledMonthlyCredits:0,
    creditsPerExplicitCall:1,markets:['h2h'],regions:['us'],enabled:process.env.ODDS_API_ENABLED==='true',
    scope:'shared SQLite/account; external usage requires baseline and header reconciliation; no poller'}));
}
