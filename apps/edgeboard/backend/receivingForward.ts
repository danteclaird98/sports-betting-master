import { receivingForecast } from './receivingForecast.ts';
import { createReceivingForwardService, receivingForwardProtocol } from './receivingForwardCore.ts';
import { createForwardSqliteStorage } from './receivingForwardSqlite.ts';

let persistence: ReturnType<typeof createForwardSqliteStorage> | undefined;
function service(owner: string) {
  persistence ??= createForwardSqliteStorage(process.env.EDGEBOARD_DB || 'data/edgeboard.sqlite3');
  return createReceivingForwardService({ owner, store: persistence.forOwner(owner), forecast: receivingForecast });
}

export async function saveReceivingForward(owner: string, body: unknown) {
  return { ...(await receivingForwardProtocol()), ...(await service(owner).save(body)), owner };
}
export async function receivingForwardHistory(owner: string, token?: string) {
  return { ...(await receivingForwardProtocol()), ...(await service(owner).history(token)), owner };
}
