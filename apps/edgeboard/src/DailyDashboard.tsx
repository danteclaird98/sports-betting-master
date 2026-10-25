import PropVerification from './PropVerification';
import { dailyScanStatus } from '../shared/dailyScanStatus';
import { dailyReportView, parseDailyReport, type DailyReport, type MarketSample } from '../shared/dailyReport';
import type { PropObservation } from '../shared/propEvidence';
import { MARKET_LABELS, marketKey } from '../shared/accountSlip';
import { useEffect, useState } from 'react';
import { api } from '../../../runtime/client.ts';
import {
  Activity,
  ArrowRight,
  ClipboardCopy,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

const filters = [
  ['all', 'All sports'],
  ['americanfootball_nfl', 'NFL'],
  ['basketball_nba', 'NBA'],
  ['icehockey_nhl', 'NHL'],
  ['baseball_mlb', 'MLB'],
  ['americanfootball_ncaaf', 'College FB'],
  ['basketball_wnba', 'WNBA'],
  ['tennis', 'Tennis'],
  ['mma', 'MMA'],
] as const;

function timeLabel(iso: string) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Start time unavailable';
}
function priceLabel(sample: MarketSample) {
  if (sample.type === 'game' && sample.americanOdds !== null) {
    return sample.americanOdds > 0
      ? '+' + sample.americanOdds
      : String(sample.americanOdds);
  }
  return sample.publicDecimalPrice !== null
    ? sample.publicDecimalPrice.toFixed(2) + ' decimal (public)'
    : 'Price not available';
}
function selectionLabel(sample: MarketSample) {
  const prefix = sample.player ? sample.player + ' · ' : '';
  const line = sample.line !== null ? ' ' + sample.line : '';
  return (
    prefix +
    sample.selection +
    line +
    ' ' +
    (MARKET_LABELS[marketKey(sample.market) ?? ''] ??
      sample.market.replaceAll('_', ' '))
  );
}

export default function DailyDashboard({
  onAdvanced,
  onLive,
  onModel,
  onResearchReceiver,
}: {
  onAdvanced: () => void;
  onLive: () => void;
  onModel: () => void;
  onResearchReceiver: (pick: {
    player: string;
    event: string;
    market: string;
    line: number | null;
    startTime: string;
  }) => void;
}) {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [selectedSport, setSelectedSport] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!report) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [report]);
  async function scan() {
    setBusy(true);
    setMessage('');
    setReport(null);
    try {
      const params = new URLSearchParams({ timezone: 'America/Los_Angeles' });
      const result = await api.get(
        '/api/all-sports-report?' + params.toString()
      );
      const checked = parseDailyReport(result.data);
      setNow(Date.now());
      setReport(checked);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Research source unavailable. No bets approved.'
      );
    } finally {
      setBusy(false);
    }
  }
  async function copyReport() {
    if (!report) return;
    if (dailyReportView(report, selectedSport, Date.now()).expired) {
      setMessage('This scan has expired. Refresh before copying research.');
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setMessage(
        'Original all-sports scan snapshot copied. It reflects report-generation time, not the current filtered board; events may have since started. No bets approved.'
      );
    } catch {
      setMessage(
        'Copy unavailable in this browser. Open Advanced Research to export an assistant report.'
      );
    }
  }
  const view = report ? dailyReportView(report, selectedSport, now) : null;
  const selectedPrices = view?.prices ?? [];
  const visible = selectedPrices.slice(0, 12);
  const relevantSports = view?.sports ?? [];
  const candidateCount = view?.candidateCount ?? 0;
  const availability = dailyScanStatus(relevantSports, selectedPrices.length, candidateCount);
  const scanState = view?.expired ? {
    ...availability,
    title: 'HOLD — scan needs refresh',
    description: 'This scan is past its refresh time (at most 60 seconds) or its time cannot be verified. Refresh the scan to load upcoming observations. Quote freshness and betting value remain unverified.',
  } : availability;
  const scanned = relevantSports.reduce(
    (sum, row) => sum + row.gamePrices + row.propSides,
    0
  );
  return (
    <div className="simpleHome">
      <section className="simpleHero">
        <span className="simpleEyebrow">
          <Activity size={16} /> TODAY'S BETTING RESEARCH
        </span>
        <h1>Find a worthwhile bet — or pass.</h1>
        <p>
          Scan eight sports in one tap. EdgeBoard will separate actual research
          evidence from prices that only look interesting. It will never invent
          an edge to fill the board.
        </p>
        <div className="simpleButtons">
          <button type="button" className="simpleSecondary" onClick={onLive}>
            Open live game & 2H research <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="simplePrimary"
            disabled={busy}
            onClick={scan}
          >
            <RefreshCw size={18} className={busy ? 'spin' : ''} />{' '}
            {busy ? 'Checking eight sports…' : 'Scan today’s games'}
          </button>
          <button
            type="button"
            className="simpleSecondary"
            onClick={onAdvanced}
          >
            Advanced research <ArrowRight size={16} />
          </button>
        </div>
        <small>
          No provider credits spent by this scan. No wagers placed. Caesars
          account availability must be verified separately.
        </small>
      </section>
      {message && (
        <p className="simpleFeedback" role="status">
          {message}
        </p>
      )}
      {!report && !busy && (
        <section className="simpleWelcome">
          <ShieldCheck size={24} />
          <div>
            <h2>What you need to do</h2>
            <p>
              Press <strong>Scan today’s games</strong>. That’s it. The rest of
              the app’s technical tools are in Advanced Research, not deleted.
            </p>
          </div>
        </section>
      )}
      {report && (
        <>
          <section
            className="simpleDecision"
            aria-label="Betting recommendation"
          >
            <div>
              <span className="simpleEyebrow">TODAY'S DECISION</span>
              <h2>{scanState.title}</h2>
              <p>{scanState.description}</p>
              <p>
                {scanState.unavailableSources > 0 &&
                  'Coverage is incomplete: some sources failed. Review their status below. '}
                {scanState.unknownSources > 0 &&
                  'Some source diagnostics are missing or unrecognized. '}
                Independent research forecasts are available separately; they do
                not approve wagers.
              </p>
              <button type="button" className="simpleSecondary" onClick={onModel}>
                Inspect receiving probability model <ArrowRight size={16} />
              </button>
            </div>
            <strong className="simpleStake">Recommended stake: $0</strong>
          </section>
          <div className="simpleStats">
            <div>
              <span>Market sides observed</span>
              <strong>{scanned.toLocaleString()}</strong>
            </div>
            <div>
              <span>Research candidates</span>
              <strong>{candidateCount}</strong>
            </div>
            <div>
              <span>Sources unavailable</span>
              <strong>{scanState.unavailableSources}</strong>
            </div>
            <div>
              <span>Provider credits used</span>
              <strong>{report.paidProviderRequests}</strong>
            </div>
          </div>
          <section className="simplePanel">
            <div className="simpleHeading">
              <div>
                <h2>Public price examples</h2>
                <p>
                  WATCH means there is a public price to investigate —{' '}
                  <strong>not</strong> a recommended bet. Visible props are
                  automatically checked against public sources. These are
                  unranked examples organized by upcoming start time, not
                  predicted win probability.
                </p>
              </div>
              <button
                className="simpleSecondary"
                type="button"
                onClick={copyReport}
                title="Copies the original all-sports scan snapshot, not the current filtered board"
                disabled={view?.expired ?? true}
              >
                <ClipboardCopy size={16} /> Copy research
              </button>
            </div>
            <div
              className="simpleFilters"
              role="group"
              aria-label="Filter sport"
            >
              {filters.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selectedSport === key}
                  className={
                    selectedSport === key
                      ? 'simpleFilter selected'
                      : 'simpleFilter'
                  }
                  onClick={() => setSelectedSport(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <details className="simpleCaution">
              <summary>View scan blockers and source status</summary>
              {relevantSports.map(row => (
                <div key={row.sport}>
                  <strong>{row.name}</strong>
                  {(row.sourceHealth ?? []).map(source => (
                    <p key={source.source}>
                      {source.source}: {source.status.replaceAll('_', ' ')}
                      {' · '}Retrieved: {source.retrievedAt ? timeLabel(source.retrievedAt) : 'Unavailable'}
                    </p>
                  ))}
                  {!row.sourceHealth?.length && (
                    <p>Detailed source status was not returned. Retry the scan.</p>
                  )}
                  <p>
                    Model: {row.model?.status ?? 'Approval not established'} ·
                    Betting approval: {row.model?.liveApproved === true
                      ? 'Additional market and execution checks required'
                      : 'Not approved'}
                  </p>
                  {(row.decisionReasons ?? []).map((reason, index) => (
                    <p key={index}>{reason}</p>
                  ))}
                </div>
              ))}
            </details>
            {visible.length === 0 ? (
              <p className="simpleEmpty">{scanState.description}</p>
            ) : (
              <div className="simpleMarketList">
                {visible.map((row, index) => (
                  <article
                    className="simpleMarket"
                    key={[
                      row.sport,
                      row.event,
                      row.player,
                      row.market,
                      row.selection,
                      row.line,
                      index,
                    ].join('|')}
                  >
                    <div className="simpleMarketTop">
                      <span className="simpleSport">
                        {row.sportName} · {timeLabel(row.startTime)}
                      </span>
                      <span className="simpleWatch">WATCH · NOT VERIFIED</span>
                    </div>
                    <h3>{selectionLabel(row)}</h3>
                    <p>{row.event}</p>
                    <p>{row.reason}</p>
                    {row.sport === 'americanfootball_nfl' &&
                      row.type === 'prop' &&
                      row.player &&
                      /^(receptions?|receiving[_ -]?yards?|rec[_ -]?yards?)$/i.test(
                        row.market.trim()
                      ) && (
                        <button
                          type="button"
                          className="simpleSecondary receiverOpen"
                          onClick={() =>
                            onResearchReceiver({
                              player: row.player!,
                              event: row.event,
                              market: row.market,
                              line: row.line,
                              startTime: row.startTime,
                            })
                          }
                        >
                          Review cornerback & coach reports
                        </button>
                      )}
                    <div className="simpleMarketBottom">
                      <span>
                        {row.source} · {priceLabel(row)}
                        {' · '}Retrieved: {row.retrievedAt ? timeLabel(row.retrievedAt) : 'Unavailable'}
                      </span>
                      <span>EV not established</span>
                    </div>
                    {row.type === 'prop' &&
                      row.player &&
                      row.line !== null &&
                      row.publicDecimalPrice !== null &&
                      (row.selection === 'Higher' ||
                        row.selection === 'Lower') && (
                        <PropVerification
                          observation={row as PropObservation}
                        />
                      )}
                  </article>
                ))}
              </div>
            )}
            <p className="simpleCaution">
              Report generated at {timeLabel(report.generatedAt)}. Scan expires at {timeLabel(new Date(view!.expiresAt).toISOString())}.
              This 60-second display limit does not verify quote freshness. Source retrieval
              time is not the sportsbook's live odds timestamp. Always recheck
              the exact line, price, player availability and rules before a
              wager.
            </p>
          </section>
          <section className="simpleNext">
            <div>
              <h2>Want a closer look?</h2>
              <p>
                Use Advanced Research for exact props, Caesars comparisons,
                historical models, parlays and source diagnostics. No technical
                setup is needed just to scan.
              </p>
            </div>
            <button
              type="button"
              className="simpleSecondary"
              onClick={onAdvanced}
            >
              Open Advanced Research <ArrowRight size={16} />
            </button>
          </section>
        </>
      )}
    </div>
  );
}
