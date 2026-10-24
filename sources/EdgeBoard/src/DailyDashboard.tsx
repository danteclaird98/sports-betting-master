import PropVerification from './PropVerification';
import type { PropObservation } from '../shared/propEvidence';
import { MARKET_LABELS, marketKey } from '../shared/accountSlip';
import { useState } from 'react';
import { api } from '@appdeploy/client';
import {
  Activity,
  ArrowRight,
  ClipboardCopy,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

type MarketSample = {
  sport: string;
  sportName: string;
  event: string;
  startTime: string;
  type: 'game' | 'prop';
  player: string | null;
  market: string;
  selection: string;
  line: number | null;
  source: string;
  americanOdds: number | null;
  publicDecimalPrice: number | null;
  retrievedAt: string | null;
  lineId?: string;
  period?: string;
  offeredOddsTimestampVerified: false;
  accountVerified: false;
  estimatedEv: null;
  researchStatus: 'WATCH_ONLY';
  reason: string;
};
type SportRow = {
  sport: string;
  name: string;
  status: string;
  eventCount: number;
  gamePrices: number;
  propSides: number;
  qualifyingCount: number;
};
type DailyReport = {
  generatedAt: string;
  requested: { date: string; timezone: string };
  paidProviderRequests: number;
  status: string;
  caution: string;
  sports: SportRow[];
  reviewQueue: MarketSample[];
  qualifyingOpportunities: unknown[];
};
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
  onResearchReceiver,
}: {
  onAdvanced: () => void;
  onLive: () => void;
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
  async function scan() {
    setBusy(true);
    setMessage('');
    setReport(null);
    try {
      const params = new URLSearchParams({ timezone: 'America/Los_Angeles' });
      const result = await api.get(
        '/api/all-sports-report?' + params.toString(),
      );
      setReport(result.data as DailyReport);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Research source unavailable. No bets approved.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setMessage(
        'Research report copied. It contains observed prices, sources and reasons to HOLD.',
      );
    } catch {
      setMessage(
        'Copy unavailable in this browser. Open Advanced Research to export an assistant report.',
      );
    }
  }
  const visible = (report?.reviewQueue ?? [])
    .filter((row) => selectedSport === 'all' || row.sport === selectedSport)
    .slice(0, 12);
  const relevantSports = (report?.sports ?? []).filter(
    (row) => selectedSport === 'all' || row.sport === selectedSport,
  );
  const sourceFailures = relevantSports.filter(
    (row) => row.status === 'UNAVAILABLE',
  ).length;
  const scanned = relevantSports.reduce(
    (sum, row) => sum + row.gamePrices + row.propSides,
    0,
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
              <h2>
                {report.qualifyingOpportunities.length > 0
                  ? 'Research requires additional verification'
                  : 'HOLD — no verified +EV bets'}
              </h2>
              <p>
                {report.qualifyingOpportunities.length > 0
                  ? 'Research candidates were returned, but account-specific prices, uncertainty and execution must be verified before wagering.'
                  : 'Prices are available for research, but no approved independent probability model has established a profitable wager.'}
              </p>
            </div>
            <strong className="simpleStake">Recommended stake: $0</strong>
          </section>
          <div className="simpleStats">
            <div>
              <span>Market sides screened</span>
              <strong>{scanned.toLocaleString()}</strong>
            </div>
            <div>
              <span>Research-qualified bets</span>
              <strong>{report.qualifyingOpportunities.length}</strong>
            </div>
            <div>
              <span>Sources unavailable</span>
              <strong>{sourceFailures}</strong>
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
            {visible.length === 0 ? (
              <p className="simpleEmpty">
                No usable upcoming public prices were returned for this filter.
                The correct action is HOLD.
              </p>
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
                    {row.sport === 'americanfootball_nfl' &&
                      row.type === 'prop' &&
                      row.player &&
                      /^(receptions?|receiving[_ -]?yards?|rec[_ -]?yards?)$/i.test(
                        row.market.trim(),
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
              Data obtained at {timeLabel(report.generatedAt)}. Source retrieval
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
