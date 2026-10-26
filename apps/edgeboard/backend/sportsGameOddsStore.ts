import { SGO_INTERVAL, type SgoInput, type SgoLeague, type SgoMode, type SgoReceipt, type SgoSnapshot, type SgoStore } from './sportsGameOddsCore.ts';

/** Narrow adapter port, implemented by sportsGameOddsSqlite in this runtime.
 * Generic runtime.db does not promise these conditional transaction semantics.
 */
export type SgoDatabase = {
    get<T>(table: string, ids: string[], options?: { consistent: boolean }): Promise<Array<(T & { id: string }) | null>>;
    list<T>(table: string, options: { limit: number; nextToken?: string }): Promise<{ items: Array<T & { id: string }>; nextToken?: string | null }>;
    tx: {
        add(table: string, items: Array<Record<string, unknown>>): unknown;
        update(table: string, items: Array<{ id: string; record: Record<string, unknown>; if?: Record<string, unknown> }>, options?: { patch: boolean }): unknown;
    };
    transact(operations: unknown[]): Promise<unknown>;
};
async function hash(text: string) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
type Gate = {
    owner: string;
    requestId: string;
    nextAt: number;
    pending: boolean;
    leaseUntil: number;
};
type Latest = {
    owner: string;
    receiptId: string;
};
export async function createSgoStore(userId: string, db: SgoDatabase, isAppDatabaseError: (failure: unknown) => failure is { code: string }): Promise<SgoStore> {
    const ownerKey = (await hash(userId)).slice(0, 32), gateTable = 'sgo_gate_' + ownerKey;
    const table = (league: SgoLeague, mode: SgoMode) => `sgo_${ownerKey}_${league}_${mode}`;
    const receiptId = (input: SgoInput) => 'req_' + input.requestId;
    const latestId = async (input: SgoInput) => 'latest_' + (await hash(input.cursor ?? 'first')).slice(0, 32);
    const owned = <T extends {
        owner: string;
    }>(row: T | null): T | null => {
        if (row && row.owner !== userId)
            throw Error('PRIVATE_SNAPSHOT_OWNER_MISMATCH');
        return row;
    };
    return {
        async find(input) {
            const [row] = await db.get<SgoReceipt>(table(input.league, input.mode), [receiptId(input)], { consistent: true });
            return owned(row);
        },
        async reserve(input, fingerprint, now) {
            const [raw] = await db.get<Gate>(gateTable, ['gate'], { consistent: true });
            const gate = owned(raw);
            if (gate && (now < gate.nextAt || (gate.pending && now < gate.leaseUntil)))
                throw Error('REFRESH_COOLDOWN_OR_PENDING_REQUEST');
            const record = { id: 'gate', owner: userId, requestId: input.requestId, pending: true, nextAt: now + SGO_INTERVAL, leaseUntil: now + 120000 };
            const receipt: SgoReceipt = { id: receiptId(input), owner: userId, fingerprint, status: 'PENDING', createdAt: new Date(now).toISOString() };
            try {
                const gateWrite = gate ? db.tx.update(gateTable, [{ id: 'gate', record,
                        if: { requestId: gate.requestId, nextAt: gate.nextAt, pending: gate.pending } }]) : db.tx.add(gateTable, [record]);
                await db.transact([gateWrite, db.tx.add(table(input.league, input.mode), [{ ...receipt }])]);
            }
            catch (failure) {
                if (isAppDatabaseError(failure) && ['AppDatabaseConflict', 'AppDatabaseConditionFailed', 'AppDatabaseDuplicateId'].includes(failure.code)) {
                    throw Error('REFRESH_COOLDOWN_OR_PENDING_REQUEST');
                }
                throw Error('RESERVATION_UNCONFIRMED_REVIEW_HISTORY');
            }
        },
        async previous(input) {
            const [pointer] = await db.get<Latest>(table(input.league, input.mode), [await latestId(input)], { consistent: true });
            if (!owned(pointer))
                return null;
            const [row] = await db.get<SgoReceipt>(table(input.league, input.mode), [pointer!.receiptId], { consistent: true });
            return owned(row)?.status === 'COMPLETE' ? row!.snapshot ?? null : null;
        },
        async finish(input, result) {
            const t = table(input.league, input.mode), id = receiptId(input);
            const [raw] = await db.get<SgoReceipt>(t, [id], { consistent: true });
            const receipt = owned(raw);
            if (!receipt || receipt.status !== 'PENDING')
                throw Error('SAVE_OUTCOME_REQUIRES_RECONCILIATION');
            const complete = db.tx.update(t, [{ id, record: { ...receipt, status: result.snapshot ? 'COMPLETE' : 'FAILED',
                        ...(result.snapshot ? { snapshot: result.snapshot } : { reason: result.reason ?? 'REQUEST_OR_SAVE_UNCONFIRMED' }) }, if: { status: 'PENDING', owner: userId } }]);
            const release = db.tx.update(gateTable, [{ id: 'gate', record: { pending: false },
                    if: { requestId: input.requestId, pending: true, owner: userId } }], { patch: true });
            if (result.snapshot) {
                const pointer = db.tx.update(t, [{ id: await latestId(input), record: { owner: userId, receiptId: id } }]);
                await db.transact([complete, release, pointer]);
            }
            else
                await db.transact([complete, release]);
        },
        async history(league, mode, token) {
            const page = await db.list<SgoReceipt>(table(league, mode), { limit: 3, ...(token ? { nextToken: token } : {}) });
            // Table also contains bounded latest pointers. Preserve the token even for an empty receipt page.
            return { items: page.items.filter(row => row.id.startsWith('req_')).map(row => owned(row)!), nextToken: page.nextToken ?? null };
        },
    };
}
