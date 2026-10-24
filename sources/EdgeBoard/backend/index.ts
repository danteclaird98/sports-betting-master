import { router, json, error, requireAuth, auth } from '@appdeploy/sdk';
import { getConfig, scanEdges } from './engine';
import { getNflResearchContext } from './context';
import { getBankrollPolicy } from './edgePolicy';
import { getCoverageMatrix } from './coverage';
import { getFreeUnderdogHealth, getFreeUnderdogLines } from './freeUnderdog';
import { thursdayUnderdogDeepDive } from './tnfUnderdogDeepDive';
import { getFreeGameOdds } from './freeGameOdds';
import {
  archivePrediction,
  listPredictionLedger,
  settlePrediction,
} from './predictionLedger';
import { getResearchPolicy } from './researchControls';
import { evaluateModel } from './modelLab';
import { loadPropReferences } from './propReferences';
import { loadCaesarsFeed } from './caesarsFeed';
import nflBaselineReport from './nflBaselineReport.json';
import mlbBaselineReport from './mlbBaselineReport.json';
import { buildAssistantReport } from './assistantReport';
import { getRecommendationReadiness } from './settlementSupport';
import { getWagerLedger, saveWagerLedger } from './wagerLedger';
import { testPrivateDatabase } from './integrationTests';
import { inspectHistoricalNfl } from './historicalNfl';
import { researchNflCalibration } from './nflCalibration';
import { saveQuoteBatch, listQuoteBatches } from './quoteArchive';
import { auditParlay } from './parlayAudit';
import { scanAllSports } from './allSportsReport';
import { nflPropReadiness } from './nflPropReadiness';
import { blockerAudit } from './blockerAudit';
import {
  getResearchPipeline,
  selfTestResearchPipeline,
} from './researchPipeline';
import {
  auditReceiverMatchup,
  fetchReceiverNews,
  receiverMatchupSelfTest,
} from './receiverMatchup';
import { nflPropBacktest, nflPropSourceHealth } from './nflPropBacktest';
import { nflLineAwareBacktest, lineAwareSelftest } from './lineAwareNfl';
import { calibrationFixture } from './nflPropCalibration';
import {
  validateHistoricalPropQuoteBatch,
  historicalQuoteFixture,
} from './nflHistoricalQuoteAudit';
import {
  readArchivedNflOdds,
  archivedNflOddsFixture,
} from './historicalNflOddsV4';
import { getNflInjuries } from './nflInjuryContext';
import { nhlShotsBacktest } from './nhlShotsBacktest';
import { nhlLeagueBacktest } from './nhlLeagueBacktest';
import {
  nhlOddsReadiness,
  nhlOddsSelftest,
  previewNhlPrice,
  auditNhlPrice,
  verifyNhlOddsConnection,
} from './nhlHistoricalOdds';
import { caesarsRuleReferences } from './caesarsRules';
import {
  saveExecutionEvidence,
  listExecutionEvidence,
} from './executionEvidence';
import {
  liveBoard,
  publicLiveResearch,
  enrichLiveQuotes,
} from './liveResearch';
import {
  liveProviderStatus,
  loadLiveProvider,
  cachedLiveQuotes,
} from './liveOdds';
import { independentModelStatus } from './independentReceptions';
import { analyzeLiveSlip } from './liveSlip';
import { saveLiveSnapshot, readLiveSnapshots } from './liveQuoteStorage';
import { halftimeOutlook } from './halftimeOutlook';
import { checkAccountSlip } from './accountSlipAudit';
import { verifyPublicProp } from './verifyProp';
import { correctedReceivingReadiness, correctedReceivingReport, correctedReceivingScore } from './correctedReceiving';

export const handler = router({
  'GET /api/corrected-receiving-readiness': [async () => json(await correctedReceivingReadiness())],
  'GET /api/corrected-receiving-report': [async () => json(await correctedReceivingReport())],
  'POST /api/corrected-receiving-score': [async ({ body }) => json(await correctedReceivingScore(body))],
  'POST /api/verify-prop': [
    async ({ body }) => {
      try {
        return json(await verifyPublicProp(body));
      } catch (failure) {
        return error(
          failure instanceof Error
            ? failure.message
            : 'Prop verification failed',
          400,
        );
      }
    },
  ],
  'POST /api/account-slip-check': [
    async ({ body }) => {
      try {
        return json(await checkAccountSlip(body));
      } catch (failure) {
        return error(
          failure instanceof Error
            ? failure.message
            : 'Account slip check failed',
          400,
        );
      }
    },
  ],
  'GET /api/halftime-outlook': [
    async ({ query }) => {
      try {
        return json(await halftimeOutlook(query.eventId ?? ''));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Halftime outlook unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/live-board': [
    async ({ query }) => {
      try {
        return json(await liveBoard(query.eventId, query.date));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Live scoreboard unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/live-public-lines': [
    async (ctx) => {
      try {
        const user = await auth.getUser(ctx.event);
        return json(
          await publicLiveResearch(ctx.query.eventId ?? '', user?.userId),
        );
      } catch (e) {
        return error(
          e instanceof Error
            ? e.message
            : 'Public live market source unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/independent-reception-model': [
    async () => json(independentModelStatus()),
  ],
  'GET /api/live-provider-health': [
    async () => {
      try {
        return json(await liveProviderStatus(true));
      } catch {
        return error(
          'Provider connection check unavailable; no paid price request made.',
          502,
        );
      }
    },
  ],
  'POST /api/live-prices': [
    requireAuth(),
    async (ctx) => {
      try {
        const provider = await loadLiveProvider(ctx.body, ctx.user!.userId);
        const eventId = String(
          (ctx.body as { eventId?: string })?.eventId ?? '',
        );
        const kind = String((ctx.body as { kind?: string })?.kind ?? '');
        const family = kind === 'periods' ? 'period|' : 'prop|';
        const current = cachedLiveQuotes(eventId).filter((quote) =>
          quote.id.startsWith(family),
        );
        const persisted = await saveLiveSnapshot(
          ctx.user!.userId,
          eventId,
          kind,
          current,
        );
        const quotes = await readLiveSnapshots(ctx.user!.userId, eventId);
        return json({
          ...(await enrichLiveQuotes(eventId, quotes)),
          provider,
          persisted,
        });
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Live price request failed',
          400,
        );
      }
    },
  ],
  'POST /api/live-slip-audit': [
    async (ctx) => {
      try {
        const user = await auth.getUser(ctx.event);
        return json(await analyzeLiveSlip(ctx.body, user?.userId));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Live slip validation failed',
          400,
        );
      }
    },
  ],
  'GET /api/nfl-historical-v4-selftest': [
    async () => json(archivedNflOddsFixture()),
  ],
  'POST /api/nfl-historical-v4-import': [
    async ({ body }) => {
      try {
        return json(readArchivedNflOdds(body));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Invalid historical NFL odds JSON',
          400,
        );
      }
    },
  ],
  'GET /api/nfl-receiver-injuries': [
    async ({ query }) => {
      try {
        return json(
          await getNflInjuries(query.receiver ?? '', query.opponent ?? ''),
        );
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'ESPN injury source unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/nfl-receiver-matchup-selftest': [
    async () => json(receiverMatchupSelfTest()),
  ],
  'POST /api/nfl-receiver-matchup-audit': [
    async ({ body }) => {
      try {
        return json(
          auditReceiverMatchup(
            body as Parameters<typeof auditReceiverMatchup>[0],
          ),
        );
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Invalid receiver matchup',
          400,
        );
      }
    },
  ],
  'GET /api/nfl-receiver-news': [
    async ({ query }) => {
      try {
        return json(
          await fetchReceiverNews(query.receiver ?? '', query.opponent ?? ''),
        );
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Matchup news unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/research-pipeline': [
    async ({ query }) => {
      try {
        return json(
          await getResearchPipeline(query.sport ?? 'americanfootball_nfl'),
        );
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Free research source unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/research-pipeline-selftest': [
    async () => json(selfTestResearchPipeline()),
  ],
  'GET /api/nhl-odds-readiness': [async () => json(await nhlOddsReadiness())],
  'GET /api/nhl-odds-connection-check': [
    async () => {
      try {
        return json(await verifyNhlOddsConnection());
      } catch (e) {
        return error(
          e instanceof Error
            ? e.message
            : 'PuckAPI zero-credit validation failed',
          502,
        );
      }
    },
  ],
  'GET /api/nhl-odds-selftest': [async () => json(nhlOddsSelftest())],
  'POST /api/nhl-odds-price-preview': [
    requireAuth(),
    async ({ body }) => {
      try {
        return json(
          await previewNhlPrice(
            String((body as { gameId?: string })?.gameId ?? ''),
          ),
        );
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Provider preview unavailable',
          400,
        );
      }
    },
  ],
  'POST /api/nhl-odds-market-audit': [
    requireAuth(),
    async ({ body }) => {
      try {
        const input = body as { gameId?: string; confirmCredits?: number };
        return json(
          await auditNhlPrice(
            String(input?.gameId ?? ''),
            input?.confirmCredits,
          ),
        );
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'No verified odds audit',
          400,
        );
      }
    },
  ],
  'GET /api/parlay-audit-selftest': [
    async () => {
      const result = auditParlay({
        kind: 'ordinary',
        combinedAmericanOdds: 248,
        bankroll: 130,
        existingExposure: 0,
        stake: 15,
        legs: [
          {
            event: 'Fixture MLB',
            market: 'Over 6.5 runs',
            selection: 'Over',
            americanOdds: -143,
            pushPossible: false,
          },
          {
            event: 'Fixture NHL',
            market: 'Under 6 goals',
            selection: 'Under',
            americanOdds: 105,
            pushPossible: true,
          },
        ],
      });
      const push = result.pushIllustrations.find(
        (item) => item.ifLegPushes === 2,
      );
      const checks = {
        headlineMath:
          Math.abs((result.headlinePayoutThreshold ?? 0) - 1 / 3.48) < 0.000001,
        pushDisablesNaiveBreakEven: result.offeredBreakEvenProbability === null,
        pushPaysRemainingLeg:
          Math.abs(
            (push?.ifAllOtherLegsWin?.grossReturnPerUnit ?? 0) -
              (1 + 100 / 143),
          ) < 0.000001,
        uncalibratedEvHidden:
          result.estimatedEv === null &&
          result.estimatedJointProbability === null,
        fifteenDollarRiskFlag: result.risk.exceedsOnePercentGuideline === true,
        doesNotPlaceBet: result.noBetPlaced,
      };
      return json({
        fixture: 'EXAMPLE_ONLY_NOT_A_VERIFIED_ACCOUNT_PRICE',
        status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
        checks,
      });
    },
  ],
  'GET /api/all-sports-report': [
    async ({ query }) => {
      try {
        return json(await scanAllSports(query.date, query.timezone));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'All-sports scan failed',
          400,
        );
      }
    },
  ],
  'GET /api/caesars-rules': [async () => json(caesarsRuleReferences())],
  'GET /api/execution-evidence': [
    requireAuth(),
    async (ctx) => json(await listExecutionEvidence(ctx.user!.userId)),
  ],
  'POST /api/execution-evidence': [
    requireAuth(),
    async (ctx) => {
      try {
        return json(await saveExecutionEvidence(ctx.user!.userId, ctx.body));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Invalid execution evidence',
          400,
        );
      }
    },
  ],
  'GET /api/nhl-league-backtest': [
    async () => {
      try {
        return json(await nhlLeagueBacktest());
      } catch (e) {
        console.error('nhl_league_backtest_failed', e);
        return error(
          e instanceof Error ? e.message : 'NHL league source failed',
          502,
        );
      }
    },
  ],
  'GET /api/nhl-shots-backtest': [
    async () => {
      try {
        return json(await nhlShotsBacktest());
      } catch (e) {
        console.error('nhl_shots_backtest_failed', e);
        return error(
          e instanceof Error ? e.message : 'NHL history unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/nfl-player-source-health': [
    async () => {
      try {
        return json(await nflPropSourceHealth());
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Historical download failed',
          502,
        );
      }
    },
  ],
  'GET /api/nfl-prop-calibration-selftest': [
    async () => json(calibrationFixture()),
  ],
  'GET /api/nfl-historical-quote-selftest': [
    async () => json(historicalQuoteFixture()),
  ],
  'POST /api/nfl-historical-quote-validate': [
    async ({ body }) => {
      try {
        return json(validateHistoricalPropQuoteBatch(body));
      } catch (e) {
        return error(
          e instanceof Error
            ? e.message
            : 'Invalid historical prop quote archive',
          400,
        );
      }
    },
  ],
  'GET /api/nfl-line-aware-selftest': [async () => json(lineAwareSelftest())],
  'GET /api/nfl-line-aware-backtest': [
    async ({ query }) => {
      try {
        return json(await nflLineAwareBacktest(query.market ?? 'receptions'));
      } catch (e) {
        return error(
          e instanceof Error
            ? e.message
            : 'Historical line-specific evaluation unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/nfl-prop-backtest': [
    async ({ query }) => {
      try {
        return json(await nflPropBacktest(query.market ?? 'receiving_yards'));
      } catch (e) {
        console.error('nfl_prop_backtest_failed', e);
        return error(
          e instanceof Error ? e.message : 'Historical backtest failed',
          502,
        );
      }
    },
  ],
  'GET /api/blocker-audit': [async () => json(blockerAudit())],
  'GET /api/nfl-prop-readiness': [async () => json(nflPropReadiness())],
  'POST /api/nfl-prop-readiness': [
    async ({ body }) => json(nflPropReadiness(body)),
  ],
  'POST /api/parlay-audit': [
    async ({ body }) => {
      try {
        return json(auditParlay(body));
      } catch (e) {
        return error(e instanceof Error ? e.message : 'Invalid parlay', 400);
      }
    },
  ],
  'GET /api/nfl-historical-calibration': [
    async () => {
      try {
        return json(await researchNflCalibration());
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Calibration unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/historical-nfl-health': [
    async () => {
      try {
        return json(await inspectHistoricalNfl());
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'History unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/quote-archive': [
    requireAuth(),
    async (ctx) => json(await listQuoteBatches(ctx.user!.userId)),
  ],
  'POST /api/quote-archive': [
    requireAuth(),
    async (ctx) => {
      try {
        return json(await saveQuoteBatch(ctx.user!.userId, ctx.body));
      } catch (e) {
        return error(e instanceof Error ? e.message : 'Archive rejected', 400);
      }
    },
  ],
  'POST /api/test-ledger-storage': [
    requireAuth(),
    async (ctx) => {
      try {
        return json(await testPrivateDatabase(ctx.user!.userId));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Storage verification failed',
          500,
        );
      }
    },
  ],
  'GET /api/wager-ledger': [
    requireAuth(),
    async (ctx) => json(await getWagerLedger(ctx.user!.userId)),
  ],
  'POST /api/wager-ledger': [
    requireAuth(),
    async (ctx) => {
      try {
        return json(
          await saveWagerLedger(
            ctx.user!.userId,
            (ctx.body as { wagers?: unknown })?.wagers,
          ),
        );
      } catch (e) {
        return error(e instanceof Error ? e.message : 'Save failed', 400);
      }
    },
  ],
  'GET /api/caesars-feed': [
    async ({ query }) => {
      try {
        return json(
          await loadCaesarsFeed(query.sport ?? 'americanfootball_nfl'),
        );
      } catch {
        return error(
          'Caesars provider request failed; no substitute quotes supplied.',
          502,
        );
      }
    },
  ],
  'GET /api/integration-readiness': [
    async () =>
      json({
        readOnly: true,
        providerCallsMade: 0,
        checkedAt: new Date().toISOString(),
        deploymentHealth: 'REQUIRES_SEPARATE_STATUS_CHECK',
        caesars: {
          configured: 'CHECK_SECRET_NAMES_SEPARATELY',
          liveVerified: false,
          reason:
            'A working endpoint is not evidence of current provider entitlement; provider request intentionally omitted to preserve credits.',
        },
        wagerLedger: {
          authenticatedEndpointsImplemented: true,
          signedInRoundTripVerified: false,
          reason:
            'Requires an authenticated user-driven create/read/update verification.',
        },
        model: {
          historicalCandidateEvaluatorImplemented: true,
          liveApproved: false,
          independentSourceLineageVerified: false,
          calibratedPerSelectionUncertainty: false,
        },
        recommendation: 'HOLD',
      }),
  ],
  'GET /api/recommendation-readiness': [
    async () => json(getRecommendationReadiness()),
  ],
  'GET /api/assistant-report': [
    async ({ query }) => {
      try {
        return json(
          await buildAssistantReport({
            sport: query.sport,
            date: query.date,
            timezone: query.timezone,
          }),
        );
      } catch {
        return error(
          'Assistant report failed. Check the date/timezone and retry.',
          400,
        );
      }
    },
  ],
  'POST /api/assistant-report': [
    requireAuth(),
    async ({ body }) => {
      try {
        return json(
          await buildAssistantReport(
            (body ?? {}) as {
              sport?: string;
              date?: string;
              timezone?: string;
              includeReferences?: boolean;
            },
          ),
        );
      } catch {
        return error(
          'Assistant report failed. Check the date/timezone and retry.',
          400,
        );
      }
    },
  ],
  'GET /api/nfl-baseline-report': [async () => json(nflBaselineReport)],
  'GET /api/mlb-baseline-report': [async () => json(mlbBaselineReport)],
  'POST /api/model-evaluate': [
    requireAuth(),
    async ({ body }) => {
      try {
        return json(evaluateModel(body));
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Invalid historical dataset',
          400,
        );
      }
    },
  ],
  'POST /api/reference-props': [
    requireAuth(),
    async ({ body }) => {
      try {
        return json(
          await loadPropReferences(
            (body ?? {}) as { sport?: string; offset?: number },
          ),
        );
      } catch {
        return error(
          'Reference request failed; no substitute quotes supplied.',
          502,
        );
      }
    },
  ],
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'GET /api/config': [async () => json(await getConfig())],
  'GET /api/bankroll-policy': [
    async () => json({ readOnly: true, policy: getBankrollPolicy() }),
  ],
  'GET /api/research-policy': [
    async () => json({ readOnly: true, policy: getResearchPolicy() }),
  ],
  'GET /api/coverage': [
    async () => {
      const config = await getConfig();
      return json({ readOnly: true, coverage: getCoverageMatrix(config) });
    },
  ],
  'GET /api/free-source-health': [
    async ({ query }) => {
      try {
        return json({
          readOnly: true,
          ...(await getFreeUnderdogHealth(query.sport ?? 'baseball_mlb')),
        });
      } catch (sourceError) {
        const message =
          sourceError instanceof Error
            ? sourceError.message
            : 'Free source health check failed';
        console.error('free_source_health_failed', message);
        return error(message, 502);
      }
    },
  ],
  'GET /api/tnf-underdog-lines': [
    async () => {
      try {
        return json(await thursdayUnderdogDeepDive());
      } catch (e) {
        return error(
          e instanceof Error ? e.message : 'Underdog board unavailable',
          502,
        );
      }
    },
  ],
  'GET /api/v1/underdog': [
    async ({ query }) => {
      try {
        const requestedLimit = Number(query.limit ?? '250');
        const limit = Number.isFinite(requestedLimit) ? requestedLimit : 250;
        return json(
          await getFreeUnderdogLines({
            sport: query.sport ?? 'all',
            limit,
            includeSeasonMarkets: query.includeSeasonMarkets === 'true',
            player: query.player,
            market: query.market,
            offset: Number(query.offset ?? '0'),
            snapshotId: query.snapshotId,
            pregameOnly: query.pregameOnly === 'true',
            forceRefresh: query.refresh === 'true',
          }),
        );
      } catch (sourceError) {
        const message =
          sourceError instanceof Error
            ? sourceError.message
            : 'Free Underdog API failed';
        console.error('free_underdog_api_failed', message);
        return error(
          message,
          message.startsWith('SNAPSHOT_CHANGED:') ? 409 : 502,
        );
      }
    },
  ],
  'GET /api/v1/game-odds': [
    async ({ query }) => {
      try {
        const requestedHours = Number(query.hours ?? '48');
        const hours = Number.isFinite(requestedHours) ? requestedHours : 48;
        return json(
          await getFreeGameOdds(query.sport ?? 'baseball_mlb', hours),
        );
      } catch (sourceError) {
        const message =
          sourceError instanceof Error
            ? sourceError.message
            : 'Free game-odds API failed';
        console.error('free_game_odds_failed', message);
        return error(message, 502);
      }
    },
  ],
  'GET /api/research-ledger': [
    requireAuth(),
    async (ctx) => {
      try {
        return json(await listPredictionLedger(ctx.user!.userId, 100));
      } catch (ledgerError) {
        const message =
          ledgerError instanceof Error
            ? ledgerError.message
            : 'Research ledger failed';
        console.error('research_ledger_list_failed', message);
        return error(message, 500);
      }
    },
  ],
  'POST /api/research-ledger': [
    requireAuth(),
    async (ctx) => {
      try {
        const body = (ctx.body ?? {}) as { action?: string };
        if (body.action === 'settle')
          return json(await settlePrediction(ctx.user!.userId, ctx.body));
        if (body.action === 'archive')
          return json(await archivePrediction(ctx.user!.userId, ctx.body));
        return error('unsupported research-ledger action', 400);
      } catch (ledgerError) {
        const message =
          ledgerError instanceof Error
            ? ledgerError.message
            : 'Research ledger failed';
        console.error('research_ledger_write_failed', message);
        return error(message, 400);
      }
    },
  ],
  'GET /api/assistant-scan': [
    async ({ query }) => {
      try {
        const scanType = query.scan === 'kym' ? 'kym' : 'props';
        const marketTiming =
          query.timing === 'live'
            ? 'live'
            : query.timing === 'pregame'
              ? 'pregame'
              : 'auto';
        const requestedHours = Number(query.hours ?? '36');
        const hours = Number.isFinite(requestedHours)
          ? Math.min(72, Math.max(1, requestedHours))
          : 36;
        const from = new Date(Date.now() - 60 * 1000);
        const to = new Date(Date.now() + hours * 60 * 60 * 1000);
        const scan = await scanEdges({
          sport: query.sport ?? 'americanfootball_nfl',
          mode: 'live',
          scanType,
          marketTiming: scanType === 'kym' ? 'pregame' : marketTiming,
          commenceTimeFrom: from.toISOString(),
          commenceTimeTo: to.toISOString(),
          offset: Number(query.offset ?? 0),
          limit: Number(query.limit ?? 150),
        });
        return json({
          readOnly: true,
          purpose: 'assistant-readable EdgeBoard snapshot',
          requested: {
            sport: query.sport ?? 'americanfootball_nfl',
            scanType,
            marketTiming: scanType === 'kym' ? 'pregame' : marketTiming,
            hours,
          },
          generatedAt: new Date().toISOString(),
          scan,
        });
      } catch (scanError) {
        const message =
          scanError instanceof Error
            ? scanError.message
            : 'Assistant scan failed';
        console.error('assistant_scan_failed', message);
        return error(message, 500);
      }
    },
  ],
  'POST /api/nfl-context': [
    async ({ body }) => {
      try {
        return json(
          await getNflResearchContext(
            (body ?? {}) as {
              mode?: string;
              events?: Array<{ event?: string; commenceTime?: string }>;
            },
          ),
        );
      } catch (contextError) {
        const message =
          contextError instanceof Error
            ? contextError.message
            : 'NFL context failed';
        console.error('nfl_context_failed', message);
        return error(message, 500);
      }
    },
  ],
  'POST /api/scan': [
    async ({ body }) => {
      try {
        return json(
          await scanEdges(
            (body ?? {}) as {
              sport?: string;
              mode?: string;
              scanType?: 'props' | 'kym';
              marketTiming?: 'auto' | 'pregame' | 'live';
              commenceTimeFrom?: string;
              commenceTimeTo?: string;
              offset?: number;
              limit?: number;
            },
          ),
        );
      } catch (scanError) {
        const message =
          scanError instanceof Error ? scanError.message : 'Scan failed';
        console.error('scan_failed', message);
        return error(message, 500);
      }
    },
  ],
});
