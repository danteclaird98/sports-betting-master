import { liveGame } from './liveGames';
import { receptionFeatures } from './receptionFeatures';
import { receptionEstimate } from './independentReceptions';
import type { LivePlayer } from './liveTypes';

type Context = Awaited<ReturnType<typeof liveGame>>;
type History = Awaited<ReturnType<typeof receptionFeatures>>;
type Features = (game: Context['game'], player: LivePlayer) => Promise<History>;

// Thresholds are model questions, never invented sportsbook offers.
export async function buildHalftimeOutlook(context: Context, features: Features = receptionFeatures) {
  const confirmed = context.game.phase === 'halftime' && context.playerStatsScope === 'completed_first_half';
  const phaseReason = context.game.phase === 'first_half'
    ? 'Waiting for the source to confirm halftime. The app checks automatically; no screenshot is needed.'
    : context.game.phase === 'second_half' || context.game.phase === 'final'
      ? 'The halftime forecast window has closed. No remaining-game model is available.'
      : 'Waiting for confirmed halftime and completed first-half receiving stats.';
  const players = confirmed ? await Promise.all(context.players.map(async player => {
    try {
      if (player.receptions === null || !Number.isInteger(player.receptions) || player.receptions < 0) {
        throw Error('Completed first-half catches are missing; missing does not mean zero.');
      }
      const history = await features(context.game, player);
      const thresholds = Array.from({ length: 10 }, (_, index) => {
        const line = index + 0.5;
        const over = receptionEstimate(history.features, line, 'over', '2H', player.receptions);
        const under = receptionEstimate(history.features, line, 'under', '2H', player.receptions);
        return { line, over: over.probability, under: under.probability,
          overLow: over.probabilityLow, overHigh: over.probabilityHigh };
      });
      return { player: player.name, espnId: player.espnId, team: player.team, firstHalfReceptions: player.receptions,
        status: 'ESTIMATED', reason: 'Independent halftime estimate; these thresholds are not offered lines.',
        thresholds, inputCutoff: history.inputCutoff };
    } catch (error) {
      return { player: player.name, espnId: player.espnId, team: player.team, firstHalfReceptions: player.receptions,
        status: 'UNAVAILABLE', reason: error instanceof Error ? error.message : 'Player history unavailable.',
        thresholds: [], inputCutoff: null };
    }
  })) : [];
  const count = players.filter(player => player.status === 'ESTIMATED').length;
  const closed = ['second_half', 'final'].includes(context.game.phase);
  return {
    eventId: context.game.id, phase: context.game.phase, halftimeConfirmed: confirmed,
    contextRetrievedAt: context.retrievedAt, players, modeledPlayers: count,
    status: closed ? 'HALFTIME_WINDOW_CLOSED' : !confirmed ? 'WAITING_FOR_HALFTIME' : count ? 'OUTLOOK_READY' : 'PLAYER_DATA_UNAVAILABLE',
    reason: !confirmed ? phaseReason : count
      ? 'Independent reception probabilities are available without sportsbook lines. Actual prices are still required to assess value.'
      : 'Halftime is confirmed, but player history or model support is unavailable. See each player reason.',
    thresholdsAreOfferedLines: false, includesOvertime: true, providerCreditsUsed: 0,
    researchOnly: true, recommendation: 'HOLD', recommendedStake: 0,
  };
}

export async function halftimeOutlook(eventId: string) {
  return buildHalftimeOutlook(await liveGame(eventId));
}
