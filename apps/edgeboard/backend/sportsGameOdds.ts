import { secrets } from '../../../runtime/sdk.ts';
import { createLocalSgoStore } from './sportsGameOddsSqlite.ts';
import { createSgoService, SGO_FLAGS, SGO_INTERVAL, SGO_LEAGUES, type SgoLeague, type SgoMode } from './sportsGameOddsCore.ts';
export async function sportsGameOddsStatus() {
    const configured = (await secrets.listSecretNames()).includes('SPORTSGAMEODDS_KEY');
    return { ...SGO_FLAGS, configured, provider: 'SportsGameOdds', providerRequestsUsed: 0,
        minimumRefreshSeconds: SGO_INTERVAL / 1000, automaticTrackingDefault: false,
        action: configured ? 'Sign in and confirm one request. Manual refresh is recommended for free plans.' : 'Store SPORTSGAMEODDS_KEY using the secure setup form.',
        coverage: 'Entitlement and live coverage are not verified by a configuration check.' };
}
export async function refreshSportsGameOdds(body: unknown, userId: string) {
    const store = await createLocalSgoStore(userId);
    try { return await createSgoService({ store, fetch, key: async () => {
            if (!(await secrets.listSecretNames()).includes('SPORTSGAMEODDS_KEY'))
                return null;
            return (await secrets.readSecret('SPORTSGAMEODDS_KEY')).trim() || null;
        } }).refresh(body); } finally { store.close(); }
}
export async function sportsGameOddsHistory(userId: string, league: string, mode: string, token?: string) {
    if (!SGO_LEAGUES.includes(league as SgoLeague) || !['upcoming', 'live'].includes(mode) || (token && token.length > 3000))
        throw Error('INVALID_HISTORY_QUERY');
    const store=await createLocalSgoStore(userId);
    try { const page = await store.history(league as SgoLeague, mode as SgoMode, token);
      return { ...SGO_FLAGS, ...page, providerRequestsUsed: 0 };
    } finally { store.close(); }
}
