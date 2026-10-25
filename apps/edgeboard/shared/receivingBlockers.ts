export type ReceivingGuidance = {
  code: string;
  category: 'ready' | 'methodology' | 'participation' | 'market' | 'source' | 'integrity' | 'selection' | 'unknown';
  title: string;
  explanation: string;
  nextStep: string;
  retryable: boolean;
};

type Guidance = Omit<ReceivingGuidance, 'code'>;

const known: Record<string, Guidance> = {
  FORWARD_VALIDATION_REQUIRED: {
    category: 'methodology',
    title: 'Forward validation is still required',
    explanation: 'Historical results do not establish how this frozen model performs on predictions recorded before future games.',
    nextStep: 'Record eligible forecasts before kickoff in the forward log, then evaluate the completed cohort under the frozen protocol. Reloading data cannot complete this validation.',
    retryable: false,
  },
  ROSTER_PARTICIPATION_UNVERIFIED: {
    category: 'participation',
    title: 'Current player participation is unverified',
    explanation: 'The forecast is conditional on recorded participation. The latest observed team does not confirm the current roster, game-day availability or playing time.',
    nextStep: 'Check current roster and game-day availability evidence. Keep the forecast conditional while participation remains unverified.',
    retryable: false,
  },
  NO_EXECUTABLE_MARKET_PRICE_OR_EV: {
    category: 'market',
    title: 'An executable price edge has not been established',
    explanation: 'A probability estimate alone does not establish betting value. The exact account offer, original price time, uncertainty and settlement rules are not verified here.',
    nextStep: 'Review the exact account selection and its rules separately. Do not treat a public price or this research probability as a verified profitable wager.',
    retryable: false,
  },
  HISTORICAL_PUBLICATION_CLOCKS_UNPROVEN: {
    category: 'methodology',
    title: 'Historical data availability times are unproven',
    explanation: 'The time a file was retrieved does not prove when each historical result or feature first became available.',
    nextStep: 'Preserve source timestamps and before-kickoff forecast receipts in the forward log. Keep retrospective timing limitations in the audit.',
    retryable: false,
  },
  SOURCE_BACKED_RESEARCH_AVAILABLE: {
    category: 'ready',
    title: 'Source-backed research selections are available',
    explanation: 'The loaded data supports selecting a real player and their next scheduled fixture for a conditional research calculation.',
    nextStep: 'Choose a player and the displayed upcoming game, then calculate the forecast. Betting approval remains separate.',
    retryable: false,
  },
  SOURCE_BACKED_CONDITIONAL_RESEARCH_FORECAST: {
    category: 'ready',
    title: 'Conditional research forecast calculated',
    explanation: 'The calculation used the loaded prior-game history. It does not establish current participation, betting approval or an executable edge.',
    nextStep: 'Inspect the source receipt and remaining blockers. Save eligible future forecasts to the forward log when signed in.',
    retryable: false,
  },
  NO_ELIGIBLE_CURRENT_PLAYERS_OR_FUTURE_GAMES: {
    category: 'selection',
    title: 'No eligible player and future fixture were found',
    explanation: 'The current search and published schedule did not yield an eligible selection. This does not mean the model found no betting opportunities.',
    nextStep: 'Broaden the player search or check the future schedule. Reload after new source data is published; the frozen model audit remains available.',
    retryable: true,
  },
  INSUFFICIENT_HISTORY: {
    category: 'selection',
    title: 'The player has insufficient usable history',
    explanation: 'This calculation needs at least three valid prior games. Missing history is not replaced with invented statistics.',
    nextStep: 'Choose a player with sufficient documented prior games, or wait for additional completed games to become available.',
    retryable: false,
  },
};

const integrityCodes = new Set([
  'ARTIFACT_INTEGRITY_FAILURE', 'FROZEN_HISTORICAL_SOURCE_HASH_MISMATCH',
  'FROZEN_SOURCE_HASH_MISSING', 'HISTORICAL_SEED_INTEGRITY_FAILURE',
  'HISTORICAL_SEED_SCHEMA_INVALID', 'HISTORICAL_SEED_SCHEDULE_MISMATCH',
  'NONFINITE_FORECAST',
]);
const selectionCodes = new Set([
  'INVALID_PLAYER_QUERY', 'INVALID_REQUEST_SCHEMA', 'INVALID_REQUEST_IDENTITY',
  'CURRENT_SEASON_PLAYER_UNAVAILABLE', 'PLAYER_TEAM_TARGET_MISMATCH',
  'TARGET_NOT_NEXT_TEAM_GAME', 'TARGET_NOT_FUTURE_REGULAR_SEASON_GAME',
]);
const clockCodes = new Set([
  'INVALID_SERVER_CLOCK', 'MODEL_NOT_AVAILABLE_AT_SERVER_CLOCK', 'SOURCE_OBSERVED_AFTER_SERVER_CLOCK',
]);
const currentSeasonCodes = new Set([
  'CURRENT_SEASON_PLAYER_ROWS_UNAVAILABLE', 'CURRENT_SEASON_COMPLETED_PLAYER_ROWS_UNAVAILABLE',
]);
const schemaCodes = new Set([
  'PUBLIC_SOURCE_SCHEMA_MISMATCH', 'PUBLIC_SOURCE_ROW_WIDTH_MISMATCH',
  'SCHEDULE_IDENTITY_INVALID', 'SCHEDULE_KICKOFF_UNVERIFIED', 'SCHEDULE_WEEK_INVALID',
  'PLAYER_ROW_IDENTITY_INVALID', 'DUPLICATE_PLAYER_GAME_OR_WEEK',
  'INVALID_RECEIVING_YARDS', 'HISTORICAL_GAME_NOT_JOINABLE', 'PLAYER_TEAM_SCHEDULE_MISMATCH',
]);

/** Presentation only. Never changes the backend receipt, HOLD or approval flags. */
export function receivingGuidance(code: string): ReceivingGuidance {
  let guidance: Guidance | undefined = Object.prototype.hasOwnProperty.call(known, code) ? known[code] : undefined;
  if (!guidance && integrityCodes.has(code)) guidance = {
    category: 'integrity',
    title: 'Model or history integrity could not be verified',
    explanation: 'The installed artifact or its supporting history failed an integrity or calculation check. A probability must not be used from this result.',
    nextStep: 'Inspect the frozen model audit and have the installed artifact/history checked against its recorded hashes. Do not bypass the integrity check or approve the model to proceed.',
    retryable: false,
  };
  if (!guidance && clockCodes.has(code)) guidance = {
    category: 'integrity',
    title: 'The calculation timeline could not be verified',
    explanation: 'The server clock, model availability time or source observation time is inconsistent with a valid decision timeline.',
    nextStep: 'Inspect the clock and receipt timestamps before recalculating. Do not substitute a guessed availability time.',
    retryable: false,
  };
  if (!guidance && selectionCodes.has(code)) guidance = {
    category: 'selection',
    title: 'The selected player or fixture is not eligible',
    explanation: 'The current request does not identify an eligible player and their next future team fixture.',
    nextStep: 'Load the source-backed selectors again and choose a listed player and their displayed next game. Do not substitute another game or a guessed player identity.',
    retryable: true,
  };
  if (!guidance && currentSeasonCodes.has(code)) guidance = {
    category: 'source',
    title: 'Current-season player history is not available',
    explanation: 'The source has not supplied usable completed player rows for the required season. Older-season data is not silently substituted.',
    nextStep: 'Check whether the current-season file has been published, then reload sources. The frozen model audit can still be inspected while calculation is unavailable.',
    retryable: true,
  };
  if (!guidance && schemaCodes.has(code)) guidance = {
    category: 'source',
    title: 'Published source data could not be reconciled',
    explanation: 'A source format, player/game identity or schedule check failed. That failure is not evidence about model performance.',
    nextStep: 'Inspect the source receipt and reported code, then correct or review the source adapter before retrying. Do not bypass identity or schedule checks.',
    retryable: false,
  };
  if (!guidance && (/^PUBLIC_SOURCE_HTTP_\d{3}$/.test(code) || ['PUBLIC_SOURCE_UNAVAILABLE', 'PUBLIC_SOURCE_EMPTY_BODY', 'PUBLIC_SOURCE_TOO_LARGE'].includes(code))) guidance = {
    category: 'source',
    title: 'The public data source could not be loaded',
    explanation: 'The request did not return a usable public history or schedule file. No probability can be inferred from this data failure.',
    nextStep: 'Check public source availability and retry Load source-backed players & games when the service is accessible. No model approval change is needed to retry data retrieval.',
    retryable: true,
  };
  const fallback: Guidance = {
      category: 'unknown',
      title: 'The result needs further review',
      explanation: 'This evidence code is not recognized by the presentation layer. No conclusion about model performance or betting value follows from it.',
      nextStep: 'Inspect the original receipt and model audit before acting. Keep HOLD and do not assume that repeated reloads or an approval override will resolve it.',
      retryable: false,
  };
  return { code, ...(guidance ?? fallback) };
}
