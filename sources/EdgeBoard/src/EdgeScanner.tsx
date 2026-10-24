import { useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import KymGameLines from './KymGameLines';
import DataHealthPanel from './DataHealthPanel';
import GameMarketBoard from './GameMarketBoard';
import ResearchLedger from './ResearchLedger';
import WagerTracker from './WagerTracker';
import {
  Activity,
  Calculator,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';

type Edge = {
  id: string;
  event: string;
  commenceTime: string;
  timing: 'pregame' | 'live';
  player: string;
  market: string;
  marketLabel: string;
  side: 'Higher' | 'Lower';
  line: number;
  underdogMultiplier: number | null;
  fairProbability: number;
  fairMultiplier: number;
  edgePct: number | null;
  roiPct: number | null;
  refs: string[];
  refCount: number;
  underdogAgeSeconds: number | null;
  breakEvenProbability: number | null;
  fairProbabilityLow: number;
  fairProbabilityHigh: number;
  consensusSpreadPct: number;
  lineMovement: 'strengthening' | 'weakening' | 'stable' | 'unknown';
  verification: 'verified' | 'thin' | 'pending';
  research?: {
    status: 'ABSTAIN' | 'PASSES_RESEARCH';
    reasonsToAbstain: string[];
    estimatedEv: number | null;
    lowerBoundEv: number | null;
    marketImpliedProbability: number;
    deViggedComparator: number | null;
    modelVersion: string;
    uncertainty: [number, number];
    uncertaintyValidated: boolean;
    independentProbabilityValidated: boolean;
    sportsbook: string;
    oddsAt: string;
    decisionAt: string;
    featureAvailableAt: string;
    modelTrainedThrough: string;
    decimalOdds: number;
    supportingEvidence: string[];
    sources: Array<{ source: string; observedAt: string; detail?: string }>;
  };
};

type KalshiReference = {
  ticker: string;
  title: string;
  yesProbability: number | null;
  closeTime: string | null;
};

type ScanResponse = {
  mode: 'demo' | 'live' | 'kalshi-fallback';
  provider: string;
  underdogStatus: 'fresh' | 'stale' | 'unavailable' | 'sample';
  sport: string;
  marketTiming: 'auto' | 'pregame' | 'live';
  maxQuoteAgeSeconds: number;
  generatedAt: string;
  eventCount: number;
  creditsUsed: number;
  creditsRemaining: number | null;
  partialBoard: boolean;
  underdogPropsLoaded: number;
  liveUnderdogPropsLoaded: number;
  pregameUnderdogPropsLoaded: number;
  referencePropsLoaded: number;
  referenceBookCount: number;
  consensusAvailable: boolean;
  rawPriceStatus: 'verified' | 'pending' | 'unavailable';
  candidatesScreened: number;
  candidateScopeCount: number;
  candidatesWithoutEventIds?: number;
  candidatesWithTwoReferences?: number;
  rawEligibleGameCount?: number;
  paginationStatus?: string;
  rawCoverageStatus?: string;
  rawEventChecks: number;
  rawEventCap: number;
  rawVerifiedCount: number;
  rawSeriesTruncated: boolean;
  researchPassCount?: number;
  researchAbstainCount?: number;
  sourceMode?: string;
  dataCostLabel?: string;
  edges: Edge[];
  kalshiMarkets: KalshiReference[];
  note: string;
};

type Config = {
  freeUnderdogPublic: boolean;
  researchGate: string;
  parlayConfigured: boolean;
  sharpConfigured: boolean;
  oddsApiConfigured: boolean;
  clearSportsConfigured: boolean;
  sportsbookFeedCount: number;
  contextFeedCount: number;
  kalshiPublic: boolean;
  weatherPublic: boolean;
  primary: string;
  fallback: string;
};

const sports = [
  ['baseball_mlb', 'MLB'],
  ['americanfootball_nfl', 'NFL'],
  ['americanfootball_ncaaf', 'NCAAF'],
  ['basketball_nba', 'NBA'],
  ['basketball_wnba', 'WNBA'],
  ['icehockey_nhl', 'NHL'],
  ['tennis', 'Tennis'],
  ['mma', 'MMA'],
  ['soccer', 'Soccer'],
  ['golf_pga', 'PGA'],
  ['baseball_kbo', 'KBO'],
  ['baseball_npb', 'NPB'],
  ['esports_cs2', 'CS2'],
  ['esports_lol', 'LoL'],
  ['esports_valorant', 'Valorant'],
  ['motorsport_f1', 'F1'],
] as const;

function percent(value: number | null) {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function ageLabel(seconds: number | null) {
  if (seconds === null) return 'freshness unavailable';
  if (seconds < 60) return `${seconds}s old`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m old`;
  return `${(seconds / 3600).toFixed(1)}h old`;
}

function EdgeScanner() {
  const [config, setConfig] = useState<Config>({
    freeUnderdogPublic: true,
    researchGate: 'strict',
    parlayConfigured: false,
    sharpConfigured: false,
    oddsApiConfigured: false,
    clearSportsConfigured: false,
    sportsbookFeedCount: 0,
    contextFeedCount: 2,
    kalshiPublic: true,
    weatherPublic: true,
    primary: 'Multi-source sportsbook consensus',
    fallback: 'Kalshi public market data',
  });
  const [sport, setSport] = useState('baseball_mlb');
  const [footballMode, setFootballMode] = useState<'kym' | 'props'>('kym');
  const [demo, setDemo] = useState(false);
  const [marketTiming, setMarketTiming] = useState<'auto' | 'pregame' | 'live'>('auto');
  const [minEdge, setMinEdge] = useState(2);
  const [minLineAdvantage, setMinLineAdvantage] = useState(1);
  const isKym = sport === 'americanfootball_nfl' && footballMode === 'kym';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [entryType, setEntryType] = useState<'cash' | 'bonus'>('cash');
  const [displayedMultiplier, setDisplayedMultiplier] = useState('2.00');
  const [bonusPayout, setBonusPayout] = useState('20.50');
  const [stake, setStake] = useState('25');

  useEffect(() => {
    api
      .get('/api/config')
      .then(({ data }) => setConfig(data as Config))
      .catch(() =>
        setConfig({
          freeUnderdogPublic: true,
          researchGate: 'strict',
          parlayConfigured: false,
          sharpConfigured: false,
          oddsApiConfigured: false,
          clearSportsConfigured: false,
          sportsbookFeedCount: 0,
          contextFeedCount: 2,
          kalshiPublic: true,
          weatherPublic: true,
          primary: 'EdgeBoard Free API · public Underdog pregame feed',
          fallback: 'Kalshi public market data',
        })
      );
  }, []);

  const visibleEdges = useMemo(() => {
    if (!scan) return [];
    return scan.edges.filter(
      item =>
        item.verification !== 'pending' &&
        item.edgePct !== null &&
        item.edgePct >= minEdge &&
        item.research?.status === 'PASSES_RESEARCH'
    );
  }, [scan, minEdge]);

  const pendingWatchlist = useMemo(() => {
    if (!scan) return [];
    return scan.edges
      .filter(item => item.verification === 'pending' && !item.research)
      .slice(0, 6);
  }, [scan]);

  const researchAbstentions = useMemo(() => {
    if (!scan) return [];
    return scan.edges.filter(item => item.research?.status === 'ABSTAIN').slice(0, 10);
  }, [scan]);
  const chosen = useMemo(
    () => scan?.edges.filter(item => selected.includes(item.id)) ?? [],
    [scan, selected]
  );
  const singleProbability = chosen.length === 1 && chosen[0].research?.status === 'PASSES_RESEARCH' ? chosen[0].fairProbability : 0;
  const ledgerSelection = chosen.length === 1 && chosen[0].research && chosen[0].underdogMultiplier
    ? {
        id: chosen[0].id,
        event: chosen[0].event,
        sport,
        market: chosen[0].market,
        selection: `${chosen[0].side} ${chosen[0].marketLabel}`,
        line: chosen[0].line,
        sportsbook: chosen[0].research.sportsbook,
        decimalOdds: chosen[0].research.decimalOdds,
        oddsAt: chosen[0].research.oddsAt,
        decisionAt: chosen[0].research.decisionAt,
        featureAvailableAt: chosen[0].research.featureAvailableAt,
        modelTrainedThrough: chosen[0].research.modelTrainedThrough,
        modelVersion: chosen[0].research.modelVersion,
        probability: chosen[0].fairProbability,
        probabilityLow: chosen[0].fairProbabilityLow,
        probabilityHigh: chosen[0].fairProbabilityHigh,
        researchStatus: chosen[0].research.status,
        reasonsToAbstain: chosen[0].research.reasonsToAbstain,
        supportingEvidence: chosen[0].research.supportingEvidence,
        sources: chosen[0].research.sources,
      }
    : null;
  const cashMultiplier = Number(displayedMultiplier) || 0;
  const cashBreakEven = cashMultiplier > 0 ? 1 / cashMultiplier : null;
  const cashEv =
    singleProbability > 0 && cashMultiplier > 0
      ? singleProbability * cashMultiplier - 1
      : null;
  const payout = Number(bonusPayout) || 0;
  const bonusExpectedCash =
    singleProbability > 0 ? singleProbability * payout : null;

  function toggleEdge(id: string) {
    setSelected(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current.slice(-1), id]
    );
  }

  async function runScan() {
    setLoading(true);
    setError('');
    setSelected([]);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const { data } = await api.post('/api/scan', {
        sport,
        mode: demo ? 'demo' : 'live',
        marketTiming,
        commenceTimeFrom: start.toISOString(),
        commenceTimeTo: end.toISOString(),
      });
      setScan(data as ScanResponse);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Scan failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">
            <Activity size={16} /> LIVE EDGE ENGINE
          </div>
          <h1>EdgeBoard</h1>
          <p>
            Multi-source betting research: compare Underdog baselines and props against sportsbook consensus, track stale lines and key numbers, and keep public prediction markets separate as independent context. EdgeBoard never invents an edge when a source is unavailable.
          </p>
        </div>
        <div className={`status ${config.sportsbookFeedCount > 0 ? 'good' : 'warn'}`}>
          {config.sportsbookFeedCount > 0 ? <Wifi size={17} /> : <WifiOff size={17} />}
          {config.sportsbookFeedCount > 0
            ? `${config.sportsbookFeedCount} configured sportsbook route${config.sportsbookFeedCount === 1 ? '' : 's'} · public ESPN fallback checked on each scan · ${config.clearSportsConfigured ? 'injury key saved' : 'injury key optional'}`
            : `No keyed sportsbook route configured · public ESPN fallback checked on each scan · ${config.clearSportsConfigured ? 'injury key saved' : 'injury key optional'}`}
        </div>
      </header>

      <section className="panel controls">
        <div className="controlGroup">
          <label>Sport</label>
          <div className="sportRow">
            {sports.map(([key, label]) => (
              <button
                key={key}
                className={sport === key ? 'chip active' : 'chip'}
                onClick={() => {
                  setSport(key);
                  setScan(null);
                  setSelected([]);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {sport === 'americanfootball_nfl' && (
            <div className="sportRow">
              <button type="button" className={footballMode === 'kym' ? 'chip active' : 'chip'} onClick={() => { setFootballMode('kym'); setScan(null); setSelected([]); }}>
                KYM game lines
              </button>
              <button type="button" className={footballMode === 'props' ? 'chip active' : 'chip'} onClick={() => { setFootballMode('props'); setScan(null); setSelected([]); }}>
                Player props
              </button>
            </div>
          )}
        </div>
        <div className="controlGrid">
          <label className="field">
            {isKym ? 'Minimum line advantage' : 'Minimum edge'}
            <div className="inputSuffix">
              <input
                type="number"
                value={isKym ? minLineAdvantage : minEdge}
                min="0"
                step="0.5"
                onChange={event => isKym ? setMinLineAdvantage(Number(event.target.value)) : setMinEdge(Number(event.target.value))}
              />
              <span>{isKym ? 'pts' : '%'}</span>
            </div>
          </label>
          <label className="toggleField">
            Data mode
            <button
              className={demo ? 'mode demo' : 'mode live'}
              onClick={() => {
                setDemo(value => !value);
                setScan(null);
                setSelected([]);
                setError('');
              }}
            >
              {demo ? 'Demo' : 'Live'}
            </button>
          </label>
          {!isKym && (
            <label className="toggleField">
              Market timing
              <div className="sportRow">
                {([['auto', 'Auto'], ['pregame', 'Pregame'], ['live', 'Live Props']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={marketTiming === value ? 'chip active' : 'chip'}
                    onClick={() => setMarketTiming(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>
          )}
        </div>
        {!isKym && (
          <button
            className="scanButton"
            onClick={runScan}
            disabled={loading}
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />{' '}
            {loading
              ? 'Scanning…'
              : `Scan ${sports.find(([key]) => key === sport)?.[1] ?? 'sport'} ${marketTiming === 'auto' ? 'automatically' : marketTiming === 'live' ? 'live props' : 'pregame'}`}
          </button>
        )}
        {!demo && !isKym && (
          <div className="hint">
            Free-first mode uses EdgeBoard’s normalized public Underdog pregame API at $0. Live in-play still needs an optional authorized live source. A verified price alone is not a research pass: independent probability and validated uncertainty are required.
          </div>
        )}
        {sport === 'baseball_mlb' && (
          <div className="hint">
            Underdog availability guardrail: 0.5 Hits and 0.5 Stolen Bases are Higher-only. EdgeBoard excludes Lower on those props.
          </div>
        )}
        {error && <div className="errorBox">{error}</div>}
      </section>

      {isKym && <KymGameLines demo={demo} minLineAdvantage={minLineAdvantage} />}

      {scan && !isKym && (
        <section className="results">
          <div className="sectionHead">
            <div>
              <h2>{scan.sourceMode === 'free-public' ? 'Public prop research — no approved EV' : 'Ranked edges'}</h2>
              <p>
                {scan.eventCount} games loaded · {scan.provider} ·{' '}
                {scan.sourceMode === 'free-public' ? 'FREE PREGAME' : scan.marketTiming === 'auto' ? 'AUTO' : scan.marketTiming === 'live' ? 'LIVE PROPS' : 'PREGAME'} ·{' '}
                {scan.dataCostLabel ?? (scan.mode === 'demo' ? 'sample data' : `${scan.creditsUsed} Parlay credits used`)} · updated{' '}
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

          {scan.mode === 'live' && (
            <div className="coverageGrid">
              <div><span>Underdog props loaded</span><strong>{scan.underdogPropsLoaded}</strong></div>
              <div><span>Underdog live / pregame</span><strong>{scan.liveUnderdogPropsLoaded} / {scan.pregameUnderdogPropsLoaded}</strong></div>
              <div><span>Sportsbook prop rows</span><strong>{scan.referencePropsLoaded}</strong></div>
              <div><span>Consensus books</span><strong>{scan.referenceBookCount}</strong></div>
              <div><span>Consensus candidates</span><strong>{scan.candidatesScreened}</strong></div>
              <div><span>Raw games checked</span><strong>{scan.rawEventChecks}/{scan.rawEventCap}</strong></div>
              <div><span>{scan.sourceMode === 'free-public' ? 'Fresh public price rows (page)' : 'Raw prices verified'}</span><strong>{scan.rawVerifiedCount}</strong></div>
              <div><span>{scan.sourceMode === 'free-public' ? 'Authenticated raw checks' : 'Raw verification'}</span><strong>{scan.sourceMode === 'free-public' ? 'NOT RUN' : scan.rawVerifiedCount > 0 && scan.rawVerifiedCount < scan.candidatesScreened ? 'PARTIAL VERIFIED' : scan.rawPriceStatus.toUpperCase()}</strong></div>
              <div><span>Board status</span><strong>{scan.underdogStatus === 'stale' ? 'STALE SOURCE' : scan.partialBoard ? 'PARTIAL' : 'FULL RESPONSE'}</strong></div>
              <div><span>Research passes</span><strong>{scan.researchPassCount ?? 0}</strong></div>
              <div><span>Research abstentions</span><strong>{scan.researchAbstainCount ?? 0}</strong></div>
            </div>
          )}

          {visibleEdges.length === 0 ? (
            <div className="empty">
              <ShieldCheck size={24} />
              <strong>
                {scan.mode === 'kalshi-fallback'
                  ? 'Kalshi reference mode — no verified Underdog edge.'
                  : scan.mode === 'live' && scan.underdogPropsLoaded === 0
                    ? 'Sportsbook consensus loaded · Underdog board unavailable.'
                    : scan.mode === 'live' && (scan.researchAbstainCount ?? 0) > 0
                      ? `No research-qualified opportunity; ${scan.researchAbstainCount} candidates were deliberately abstained.`
                      : scan.mode === 'live'
                        ? `No qualifying edge among ${scan.rawVerifiedCount} raw-price-verified candidates.`
                        : 'No qualifying edge.'}
              </strong>
              <span>
                {scan.mode === 'kalshi-fallback'
                  ? 'Kalshi is general market context only. It is not used to confirm a player prop unless the exact contract can be matched.'
                  : scan.mode === 'live' && scan.underdogPropsLoaded === 0
                    ? `${scan.referencePropsLoaded} sportsbook prop rows from ${scan.referenceBookCount} reference books were loaded. Exact Underdog lines were not available, so EV remains disabled.`
                    : scan.mode === 'live'
                      ? `${scan.candidatesScreened} provisional candidates screened; ${scan.rawEventChecks} of ${scan.rawEligibleGameCount ?? 0} eligible games checked; ${scan.candidateScopeCount} candidates in checked games; ${scan.candidatesWithoutEventIds ?? 0} missing event IDs; ${scan.candidatesWithTwoReferences ?? 0} have two or more reference books.${scan.partialBoard ? ' Upstream props pagination incomplete.' : ''}${scan.rawEventChecks === 0 ? scan.sourceMode === 'free-public' ? ' Free public scans do not request authenticated sportsbook references or raw price verification. Signed-in reference research is a separate opt-in action; no independent model is approved.' : ' No authenticated raw quote checks ran: this is a coverage/identity blocker, not a failed betting model.' : ''}`
                      : 'That is a valid result. Wait rather than force a play.'}
              </span>
            </div>
          ) : (
            <div className="cardGrid">
              {visibleEdges.map(edge => (
                <article
                  key={edge.id}
                  className={
                    selected.includes(edge.id)
                      ? 'edgeCard selected'
                      : 'edgeCard'
                  }
                >
                  <button
                    className="selectButton"
                    onClick={() => toggleEdge(edge.id)}
                  >
                    {selected.includes(edge.id) ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      'Add'
                    )}
                  </button>
                  <div className="eventLine">
                    {edge.event} ·{' '}
                    {new Date(edge.commenceTime).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                  <h3>{edge.player}</h3>
                  <div className="pickLine">
                    <strong>
                      {edge.side} {edge.line}
                    </strong>
                    <span>{edge.marketLabel}</span>
                  </div>
                  <div className="metrics">
                    <div>
                      <span>{edge.verification === 'pending' ? 'Underdog line' : 'Underdog raw'}</span>
                      <strong>{edge.underdogMultiplier ? `${edge.underdogMultiplier.toFixed(2)}x` : edge.verification === 'pending' ? 'found · price pending' : 'unverified'}</strong>
                    </div>
                    <div>
                      <span>Fair probability</span>
                      <strong>{(edge.fairProbability * 100).toFixed(1)}%</strong>
                    </div>
                    <div>
                      <span>Break-even</span>
                      <strong>{edge.breakEvenProbability === null ? '—' : `${(edge.breakEvenProbability * 100).toFixed(1)}%`}</strong>
                    </div>
                    <div>
                      <span>Probability edge</span>
                      <strong className={edge.edgePct !== null && edge.edgePct > 0 ? 'positive' : ''}>{percent(edge.edgePct)}</strong>
                    </div>
                    <div>
                      <span>Estimated ROI</span>
                      <strong className={edge.roiPct !== null && edge.roiPct > 0 ? 'positive' : ''}>{percent(edge.roiPct)}</strong>
                    </div>
                    <div>
                      <span>Consensus range</span>
                      <strong>{(edge.fairProbabilityLow * 100).toFixed(1)}–{(edge.fairProbabilityHigh * 100).toFixed(1)}%</strong>
                    </div>
                  </div>
                  <div className="tagRow">
                    {edge.research && <span className={edge.research.status === 'PASSES_RESEARCH' ? 'verifyTag goodTag' : 'verifyTag warnTag'}>{edge.research.status === 'PASSES_RESEARCH' ? 'RESEARCH PASS' : 'RESEARCH ABSTAIN'}</span>}
                    <span className={edge.verification === 'verified' ? 'verifyTag goodTag' : 'verifyTag warnTag'}>{edge.verification === 'verified' ? 'RAW PRICE VERIFIED' : edge.verification === 'pending' ? 'PRICE FOUND · RESEARCH PENDING' : 'RAW PRICE · THIN CONSENSUS'}</span>
                    <span className="verifyTag">{edge.timing === 'live' ? 'LIVE' : 'PREGAME'}</span>
                    <span className="verifyTag">{ageLabel(edge.underdogAgeSeconds)}</span>
                    <span className="verifyTag">movement: {edge.lineMovement}</span>
                  </div>
                  <div className="refs">
                    Consensus: {edge.refs.join(', ') || 'insufficient exact pairs'} · {edge.refCount} sources · disagreement {edge.consensusSpreadPct.toFixed(1)} pts
                    {edge.research?.reasonsToAbstain.length ? ` · Abstain: ${edge.research.reasonsToAbstain.join('; ')}` : ''}
                  </div>
                </article>
              ))}
            </div>
          )}
          {researchAbstentions.length > 0 && (
            <div className="kalshiRefs">
              <h3>Research abstentions</h3>
              <p>These rows are not positive-EV recommendations. A quote or a published probability is insufficient: current player injury/lineup status, changed usage, model conflicts and validated uncertainty must all be resolved. Missing evidence means ABSTAIN.</p>
              {researchAbstentions.map(edge => (
                <div className="kalshiRow" key={`abstain-${edge.id}`}>
                  <span>{edge.player} · {edge.side} {edge.line} {edge.marketLabel} · {edge.event}</span>
                  <strong>{edge.research?.reasonsToAbstain.slice(0, 6).join(' · ') || 'research gate not cleared'}</strong>
                </div>
              ))}
            </div>
          )}
          {pendingWatchlist.length > 0 && (
            <div className="kalshiRefs">
              <h3>Price-pending watchlist</h3>
              <p>Not ranked edges and no EV is claimed. These are exact Underdog lines with at least two sportsbook consensus sources and timing-appropriate freshness ({scan.marketTiming === 'auto' ? '90 seconds live / 15 minutes pregame' : scan.marketTiming === 'live' ? '90 seconds live' : '15 minutes pregame'}).</p>
              {pendingWatchlist.map(edge => (
                <div className="kalshiRow" key={`pending-${edge.id}`}>
                  <span>{edge.player} · {edge.side} {edge.line} {edge.marketLabel} · {edge.event}</span>
                  <strong>{(edge.fairProbability * 100).toFixed(1)}% market benchmark only · {ageLabel(edge.underdogAgeSeconds)}</strong>
                </div>
              ))}
            </div>
          )}
          {scan.kalshiMarkets.length > 0 && (
            <div className="kalshiRefs">
              <h3>Kalshi general market context</h3>
              <p>Reference-only. These markets are not used in player-prop EV unless an exact player, threshold and settlement contract can be matched.</p>
              {scan.kalshiMarkets.slice(0, 8).map(market => (
                <div className="kalshiRow" key={market.ticker}>
                  <span>{market.title}</span>
                  <strong>
                    {market.yesProbability === null
                      ? 'price unavailable'
                      : `${(market.yesProbability * 100).toFixed(1)}% YES`}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <GameMarketBoard sport={sport} />

      <DataHealthPanel sport={sport} />

      {!isKym && <section className="panel lab">
        <div className="sectionHead">
          <div>
            <h2>
              <Calculator size={20} /> Slip Lab
            </h2>
            <p>
              Single-market payout math only. Multi-leg EV is withheld unless a validated joint probability model exists; EdgeBoard never multiplies marginal probabilities to manufacture a parlay edge.
            </p>
          </div>
        </div>
        <div className="selectedLegs">
          {chosen.length ? (
            chosen.map(edge => (
              <span key={edge.id}>
                {edge.player} {edge.side} {edge.line}
              </span>
            ))
          ) : (
            <span className="muted">No legs selected</span>
          )}
        </div>
        {chosen.length > 0 && (
          <div className="joint">
            {chosen.length === 1 ? (
              <>
                Estimated single-market probability <strong>{(singleProbability * 100).toFixed(1)}%</strong>
                <small>Use only when the market’s research gate is cleared; screening estimates are not automatically actionable.</small>
              </>
            ) : (
              <>
                <strong>Joint probability withheld</strong>
                <small>A validated joint model is required for every multi-leg entry, including different games. Marginal multiplication is prohibited.</small>
              </>
            )}
          </div>
        )}
        <div className="entryTabs">
          <button
            className={entryType === 'cash' ? 'active' : ''}
            onClick={() => setEntryType('cash')}
          >
            Cash entry
          </button>
          <button
            className={entryType === 'bonus' ? 'active' : ''}
            onClick={() => setEntryType('bonus')}
          >
            Free bonus entry
          </button>
        </div>
        {entryType === 'cash' ? (
          <div className="calcGrid">
            <label className="field">
              Displayed multiplier
              <input
                value={displayedMultiplier}
                inputMode="decimal"
                onChange={event => setDisplayedMultiplier(event.target.value)}
              />
            </label>
            <div className="calcOutput">
              <span>Displayed break-even</span>
              <strong>{cashBreakEven === null ? '—' : `${(cashBreakEven * 100).toFixed(1)}%`}</strong>
            </div>
            <div className="calcOutput wide">
              <span>Standard payout EV</span>
              <strong
                className={cashEv !== null && cashEv > 0 ? 'positive' : ''}
              >
                {cashEv === null
                  ? '—'
                  : `${cashEv >= 0 ? '+' : ''}${(cashEv * 100).toFixed(1)}%`}
              </strong>
            </div>
          </div>
        ) : (
          <div className="calcGrid">
            <label className="field">
              Bonus stake
              <input
                value={stake}
                inputMode="decimal"
                onChange={event => setStake(event.target.value)}
              />
            </label>
            <label className="field">
              Cash paid if it wins
              <input
                value={bonusPayout}
                inputMode="decimal"
                onChange={event => setBonusPayout(event.target.value)}
              />
            </label>
            <div className="calcOutput wide">
              <span>Expected cash from free entry</span>
              <strong>
                {bonusExpectedCash === null
                  ? '—'
                  : `$${bonusExpectedCash.toFixed(2)}`}
              </strong>
              <small>
                Free stake is not returned, so expected cash—not normal ROI—is
                the useful metric.
              </small>
            </div>
          </div>
        )}
      </section>}

      <ResearchLedger selected={ledgerSelection} />

      <WagerTracker />

      <footer>
        Read-only analytics. EdgeBoard never logs into Underdog and never places
        entries.
      </footer>
    </main>
  );
}

export default EdgeScanner;
