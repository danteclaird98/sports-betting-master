import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { RefreshCw, ShieldCheck } from 'lucide-react';

type GameLineEdge = {
  id: string;
  event: string;
  commenceTime: string;
  marketType: 'spread' | 'total';
  pick: string;
  baselineLine: number;
  consensusLine: number;
  lineAdvantage: number;
  consensusLow: number;
  consensusHigh: number;
  refs: string[];
  refCount: number;
  predictionConsensus: number | null;
  predictionRefs: string[];
  keyNumberCrossed: boolean;
  confidence: 'high' | 'medium' | 'low';
  action: 'PICK NOW' | 'WAIT';
  status: 'strong' | 'watch';
  modelVersion?: string;
  fairProbability?: number | null;
  fairProbabilityLow?: number | null;
  fairProbabilityHigh?: number | null;
  breakEvenProbability?: number | null;
  estimatedEvPct?: number | null;
  conservativeEvPct?: number | null;
  signalScore?: number | null;
  maxAcceptablePrice?: number | null;
  maxAcceptableLine?: string;
  stakeSuggestion?: string;
  expiresAt?: string | null;
  reverifyInstruction?: string;
  qualityWarnings?: string[];
  uncertaintyDiscountPct?: number | null;
};

type ProviderHealth = {
  id: string;
  name: string;
  status:
    'active' | 'unconfigured' | 'exhausted' | 'error' | 'partial' | 'public';
  detail: string;
  eventCount: number;
  bookCount: number;
};

type PredictionContext = {
  source: string;
  title: string;
  probability: number | null;
  closeTime: string | null;
};
type GameContext = {
  event: string;
  weather: string | null;
  injuries: string[];
};
type EdgeModel = { version: string; thresholds: string[] };
type RiskPolicy = {
  modelVersion: string;
  sizingMethod: string;
  noInferredBankroll: boolean;
  maxSingleMainPct: number;
  maxSinglePropPct: number;
  maxSlipPct: number;
  maxDailyRiskPct: number;
  stopAfterDrawdownPct: number;
  rules: string[];
};

type KymResponse = {
  mode: 'demo' | 'live';
  provider: string;
  generatedAt: string;
  eventCount: number;
  creditsUsed: number;
  creditsRemaining: number | null;
  partialBoard: boolean;
  referenceBookCount: number;
  baselineGamesMatched: number;
  baselineMarketsCompared: number;
  gameLineEdges: GameLineEdge[];
  providerHealth?: ProviderHealth[];
  gameContext?: GameContext[];
  predictionContext?: PredictionContext[];
  providerNotice?: string | null;
  providerUnavailable?: boolean;
  edgeModel?: EdgeModel;
  riskPolicy?: RiskPolicy;
  note: string;
};

type Props = { demo: boolean; minLineAdvantage: number };

const KICKOFF_LOCK_BUFFER_MS = 60 * 1000;

function line(value: number) {
  return `${value > 0 ? '+' : ''}${value}`;
}

function signedPercent(value?: number) {
  return typeof value === 'number'
    ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
    : '—';
}

function hasValidFutureKickoff(edge: GameLineEdge, nowMs: number) {
  const kickoff = Date.parse(edge.commenceTime);
  return Number.isFinite(kickoff) && kickoff > nowMs + KICKOFF_LOCK_BUFFER_MS;
}

export default function KymGameLines({ demo, minLineAdvantage }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scan, setScan] = useState<KymResponse | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setScan(null);
    setError('');
    setLoading(false);
  }, [demo]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredEdges = useMemo(
    () =>
      scan?.gameLineEdges.filter(
        (edge) => edge.lineAdvantage >= minLineAdvantage,
      ) ?? [],
    [scan, minLineAdvantage],
  );

  const actionableEdges = useMemo(
    () =>
      scan?.mode === 'live'
        ? filteredEdges.filter((edge) => hasValidFutureKickoff(edge, nowMs))
        : filteredEdges,
    [filteredEdges, nowMs, scan?.mode],
  );

  const lockedEdges = useMemo(
    () =>
      scan?.mode === 'live'
        ? filteredEdges.filter((edge) => !hasValidFutureKickoff(edge, nowMs))
        : [],
    [filteredEdges, nowMs, scan?.mode],
  );

  const actionableEvents = useMemo(
    () => new Set(actionableEdges.map((edge) => edge.event)),
    [actionableEdges],
  );
  const visibleContext = useMemo(
    () =>
      scan?.mode === 'demo'
        ? (scan.gameContext ?? [])
        : (scan?.gameContext ?? []).filter((item) =>
            actionableEvents.has(item.event),
          ),
    [scan, actionableEvents],
  );

  async function runScan() {
    const requestId = ++requestIdRef.current;
    const requestedMode: KymResponse['mode'] = demo ? 'demo' : 'live';
    setLoading(true);
    setError('');
    setScan(null);
    setNowMs(Date.now());
    try {
      const start = new Date(Date.now() - 5 * 60 * 1000);
      const end = new Date(Date.now() + 36 * 60 * 60 * 1000);
      const { data } = await api.post('/api/scan', {
        sport: 'americanfootball_nfl',
        scanType: 'kym',
        mode: requestedMode,
        marketTiming: 'pregame',
        commenceTimeFrom: start.toISOString(),
        commenceTimeTo: end.toISOString(),
      });
      if (requestId !== requestIdRef.current) return;
      const nextScan = data as KymResponse;
      if (nextScan.mode !== requestedMode)
        throw new Error(
          'Scan mode changed while data was loading. Run the scan again.',
        );
      setScan(nextScan);
      setNowMs(Date.now());
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'NFL KYM scan failed',
      );
      setScan(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  return (
    <>
      <button className="scanButton" onClick={runScan} disabled={loading}>
        <RefreshCw size={18} className={loading ? 'spin' : ''} />
        {loading ? 'Scanning NFL game lines…' : 'Scan NFL KYM game lines'}
      </button>
      <div className="hint">
        Uses your saved Sep 14 Keep Your Million NFL baselines and scans the
        next 36 hours of remaining pregame NFL markets. Cards automatically lock
        one minute before scheduled kickoff and are excluded after a game
        starts. EdgeBoard requires at least two fresh independent sportsbook
        books for market screening; independent model and exact contest terms
        are required for recommendations.
      </div>
      {error && <div className="errorBox">{error}</div>}

      {scan && (
        <section className="results">
          <div className="sectionHead">
            <div>
              <h2>NFL KYM line board</h2>
              <p>
                {scan.baselineGamesMatched} baseline games matched ·{' '}
                {scan.referenceBookCount} fresh sources · {scan.provider} ·
                updated{' '}
                {new Date(scan.generatedAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </p>
              <p className="sourceNote">{scan.note}</p>
            </div>
            {scan.creditsRemaining !== null && (
              <div className="quota">{scan.creditsRemaining} credits left</div>
            )}
          </div>

          {scan.mode === 'demo' && (
            <div className="errorBox">
              <strong>DEMO / SAMPLE DATA — NOT ACTIONABLE.</strong> No live
              sportsbook, injury, weather or prediction-market claim on this
              board should be used for a wager. Switch Data mode to Live and run
              a new scan for real market data.
            </div>
          )}

          {scan.providerNotice && (
            <div className={scan.providerUnavailable ? 'errorBox' : 'hint'}>
              {scan.providerNotice}
            </div>
          )}

          {scan.providerHealth && scan.providerHealth.length > 0 && (
            <div className="providerStack">
              {scan.providerHealth.map((source) => (
                <div className="providerCard" key={source.id}>
                  <div className="providerTop">
                    <strong>{source.name}</strong>
                    <span className={`sourceStatus ${source.status}`}>
                      {source.status}
                    </span>
                  </div>
                  <small>
                    {scan.mode === 'demo'
                      ? `DEMO SAMPLE · ${source.detail}`
                      : source.detail}
                  </small>
                  <div className="providerMeta">
                    {source.bookCount
                      ? `${source.bookCount} books`
                      : source.status === 'public'
                        ? 'public context'
                        : 'no verified books'}
                    {source.eventCount
                      ? ` · ${source.eventCount} rows/events`
                      : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="coverageGrid">
            <div>
              <span>Pregame events</span>
              <strong>{scan.eventCount}</strong>
            </div>
            <div>
              <span>KYM games matched</span>
              <strong>{scan.baselineGamesMatched}</strong>
            </div>
            <div>
              <span>Markets compared</span>
              <strong>{scan.baselineMarketsCompared}</strong>
            </div>
            <div>
              <span>Fresh sources</span>
              <strong>{scan.referenceBookCount}</strong>
            </div>
            <div>
              <span>Screened moves ≥ filter</span>
              <strong>{actionableEdges.length}</strong>
            </div>
            <div>
              <span>Locked at kickoff</span>
              <strong>{lockedEdges.length}</strong>
            </div>
          </div>

          {scan.edgeModel && scan.riskPolicy && (
            <div className="signalNotice">
              <div>
                <strong>Market screening · {scan.edgeModel.version}</strong>
                <span>
                  Line differences describe market comparisons. They do not
                  estimate win probability, EV or a stake.
                </span>
              </div>
              <div className="signalGrid">
                <span>
                  Main cap: {scan.riskPolicy.maxSingleMainPct}% bankroll
                </span>
                <span>Slip cap: {scan.riskPolicy.maxSlipPct}%</span>
                <span>Daily risk cap: {scan.riskPolicy.maxDailyRiskPct}%</span>
              </div>
              <small>{scan.edgeModel.thresholds.join(' · ')}</small>
            </div>
          )}

          {actionableEdges.length === 0 ? (
            <div className="empty">
              <ShieldCheck size={24} />
              <strong>
                {lockedEdges.length
                  ? 'The previous pregame edge is locked because kickoff has arrived.'
                  : scan.providerUnavailable
                    ? 'No verified two-book sportsbook consensus is available yet.'
                    : 'No meaningful NFL KYM move clears your filter.'}
              </strong>
              <span>
                {lockedEdges.length
                  ? 'It is archived below for reference only. Live in-game totals and spreads are different markets and are never compared against the pregame KYM baseline.'
                  : scan.providerUnavailable
                    ? 'Prediction and context feeds stay separate and cannot manufacture a sportsbook edge.'
                    : 'That is a valid result. The board will wait rather than manufacture an edge.'}
              </span>
            </div>
          ) : (
            <div className="cardGrid">
              {actionableEdges.map((edge) => (
                <article className="edgeCard" key={edge.id}>
                  <div className="eventLine">
                    {scan.mode === 'demo' ? 'SAMPLE · ' : ''}
                    {edge.event} · kickoff{' '}
                    {new Date(edge.commenceTime).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                  <h3>{edge.pick}</h3>
                  <div className="pickLine">
                    <strong>
                      {edge.lineAdvantage.toFixed(1)} pt advantage
                    </strong>
                    <span>
                      {edge.marketType === 'spread' ? 'spread' : 'game total'}
                    </span>
                  </div>
                  <div className="metrics">
                    <div>
                      <span>KYM baseline</span>
                      <strong>{line(edge.baselineLine)}</strong>
                    </div>
                    <div>
                      <span>
                        {scan.mode === 'demo'
                          ? 'Sample consensus'
                          : 'Sportsbook consensus'}
                      </span>
                      <strong>{line(edge.consensusLine)}</strong>
                    </div>
                    <div>
                      <span>Consensus range</span>
                      <strong>
                        {line(edge.consensusLow)} to {line(edge.consensusHigh)}
                      </strong>
                    </div>
                    <div>
                      <span>
                        {scan.mode === 'demo'
                          ? 'Sample refs'
                          : 'Fresh sportsbook refs'}
                      </span>
                      <strong>{edge.refCount}</strong>
                    </div>
                    <div>
                      <span>
                        {scan.mode === 'demo'
                          ? 'Sample prediction'
                          : 'Prediction consensus'}
                      </span>
                      <strong>
                        {edge.predictionConsensus === null
                          ? '—'
                          : line(edge.predictionConsensus)}
                      </strong>
                    </div>
                    <div>
                      <span>Reference quality</span>
                      <strong>{edge.confidence.toUpperCase()}</strong>
                    </div>
                    {typeof edge.estimatedEvPct === 'number' && (
                      <div>
                        <span>Estimated EV</span>
                        <strong
                          className={edge.estimatedEvPct > 0 ? 'positive' : ''}
                        >
                          {signedPercent(edge.estimatedEvPct)}
                        </strong>
                      </div>
                    )}
                    {typeof edge.signalScore === 'number' && (
                      <div>
                        <span>Signal score</span>
                        <strong>{edge.signalScore}/100</strong>
                      </div>
                    )}
                    {typeof edge.breakEvenProbability === 'number' && (
                      <div>
                        <span>Break-even @ -110</span>
                        <strong>
                          {(edge.breakEvenProbability * 100).toFixed(1)}%
                        </strong>
                      </div>
                    )}
                  </div>
                  <div className="tagRow">
                    {scan.mode === 'demo' ? (
                      <>
                        <span className="verifyTag warnTag">DEMO SAMPLE</span>
                        <span className="verifyTag">NOT ACTIONABLE</span>
                      </>
                    ) : (
                      <>
                        <span
                          className={
                            edge.status === 'strong'
                              ? 'verifyTag goodTag'
                              : 'verifyTag warnTag'
                          }
                        >
                          {edge.status === 'strong'
                            ? 'LINE DIFFERENCE'
                            : 'WATCH'}
                        </span>
                        <span
                          className={
                            edge.action === 'PICK NOW'
                              ? 'verifyTag goodTag'
                              : 'verifyTag'
                          }
                        >
                          {edge.action}
                        </span>
                        {edge.keyNumberCrossed && (
                          <span className="verifyTag goodTag">
                            KEY 3/7 CROSSED
                          </span>
                        )}
                        {typeof edge.maxAcceptablePrice === 'number' && (
                          <span className="verifyTag">
                            max price {edge.maxAcceptablePrice}
                          </span>
                        )}
                        {edge.expiresAt && (
                          <span className="verifyTag">
                            expires{' '}
                            {new Date(edge.expiresAt).toLocaleTimeString([], {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="refs">
                    {scan.mode === 'demo'
                      ? 'Illustrative sources'
                      : 'Sportsbooks'}
                    : {edge.refs.join(', ')}
                    {edge.predictionRefs.length
                      ? ` · ${scan.mode === 'demo' ? 'Illustrative market' : 'Prediction markets'}: ${edge.predictionRefs.join(', ')}`
                      : scan.mode === 'live'
                        ? ' · Prediction market exact line unavailable'
                        : ''}
                  </div>
                  {(edge.stakeSuggestion ||
                    edge.reverifyInstruction ||
                    edge.qualityWarnings?.length) && (
                    <div className="edgeWarnings">
                      {edge.stakeSuggestion && (
                        <strong>{edge.stakeSuggestion}</strong>
                      )}
                      {edge.reverifyInstruction && (
                        <span>{edge.reverifyInstruction}</span>
                      )}
                      {edge.qualityWarnings?.map((item) => (
                        <span key={item}>• {item}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {lockedEdges.length > 0 && (
            <div className="kalshiRefs">
              <h3>Locked pregame cards</h3>
              <p>
                Reference only. These cards were valid only before scheduled
                kickoff and can no longer be acted on or compared with live
                in-game lines.
              </p>
              {lockedEdges.map((edge) => (
                <div className="kalshiRow" key={`locked-${edge.id}`}>
                  <span>
                    <strong>{edge.event}</strong>
                    <br />
                    <small>
                      {edge.pick} · pregame consensus {line(edge.consensusLine)}{' '}
                      · kickoff{' '}
                      {new Date(edge.commenceTime).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </small>
                  </span>
                  <strong>LOCKED</strong>
                </div>
              ))}
            </div>
          )}

          {visibleContext.length > 0 && (
            <div className="kalshiRefs">
              <h3>
                {scan.mode === 'demo'
                  ? 'Sample game-day context'
                  : 'Game-day context'}
              </h3>
              <p>
                {scan.mode === 'demo'
                  ? 'Illustrative demo context only. No live injury or weather claim is being made.'
                  : 'Weather and injury context are attached only to upcoming pregame comparisons. Context never substitutes for sportsbook consensus.'}
              </p>
              {visibleContext.slice(0, 10).map((item) => (
                <div className="kalshiRow" key={item.event}>
                  <span>
                    <strong>
                      {scan.mode === 'demo' ? 'SAMPLE · ' : ''}
                      {item.event}
                    </strong>
                    <br />
                    <small>
                      {item.weather ?? 'Weather unavailable'}
                      {item.injuries.length
                        ? ` · Injuries: ${item.injuries.join(' | ')}`
                        : ' · No notable injury rows returned'}
                    </small>
                  </span>
                  <strong>{scan.mode === 'demo' ? 'SAMPLE' : 'CTX'}</strong>
                </div>
              ))}
            </div>
          )}

          {scan.predictionContext &&
            scan.predictionContext.length > 0 &&
            (scan.mode === 'demo' || actionableEdges.length > 0) && (
              <div className="kalshiRefs">
                <h3>
                  {scan.mode === 'demo'
                    ? 'Sample prediction-market context'
                    : 'Public prediction-market context'}
                </h3>
                <p>
                  {scan.mode === 'demo'
                    ? 'Illustrative sample only.'
                    : 'Context only. These prices are not converted into a KYM spread/total edge unless the exact settlement threshold can be matched to the saved baseline.'}
                </p>
                {scan.predictionContext.slice(0, 8).map((market, index) => (
                  <div
                    className="kalshiRow"
                    key={`${market.source}-${index}-${market.title}`}
                  >
                    <span>
                      {scan.mode === 'demo' ? 'SAMPLE · ' : ''}
                      {market.source} · {market.title}
                    </span>
                    <strong>
                      {market.probability === null
                        ? 'price unavailable'
                        : `${(market.probability * 100).toFixed(1)}%`}
                    </strong>
                  </div>
                ))}
              </div>
            )}

          {scan.providerHealth?.some(
            (source) =>
              ['sharpapi', 'theoddsapi', 'clearsports'].includes(source.id) &&
              source.status === 'unconfigured',
          ) && (
            <div className="hint sourceHelp">
              <strong>Optional redundancy:</strong> missing keyed sources can
              expand coverage, but ESPN, Kalshi and Open-Meteo remain no-key
              fallbacks.
            </div>
          )}
        </section>
      )}
    </>
  );
}
