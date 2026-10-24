import { useEffect, useMemo, useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import { RefreshCw, Radio, ClipboardCopy } from 'lucide-react';
import type { liveBoard, publicLiveResearch } from '../backend/liveResearch';
import type { auditLiveSlip } from '../backend/liveSlip';
import type { halftimeOutlook } from '../backend/halftimeOutlook';

type Board = Awaited<ReturnType<typeof liveBoard>>;
type Research = Awaited<ReturnType<typeof publicLiveResearch>>;
type Quote = Research['quotes'][number];
type Audit = ReturnType<typeof auditLiveSlip>;
type Outlook = Awaited<ReturnType<typeof halftimeOutlook>>;
const percent = (value: number | null | undefined) =>
  value === null || value === undefined
    ? 'unavailable'
    : (value * 100).toFixed(1) + '%';
const price = (quote: Quote) =>
  quote.americanOdds === null
    ? quote.entryMultiplier === null
      ? 'No executable price'
      : 'Entry multiplier ' + quote.entryMultiplier + 'x'
    : (quote.americanOdds > 0 ? '+' : '') + quote.americanOdds;
const label = (quote: Quote) =>
  [quote.player, quote.side, quote.line, quote.market.replaceAll('_', ' ')]
    .filter((value) => value !== null && value !== '')
    .join(' ');
function quoteAge(quote: Quote) {
  return quote.oddsAt
    ? (Date.now() - Date.parse(quote.oddsAt)) / 1000
    : quote.ageSeconds === null
      ? null
      : quote.ageSeconds + (Date.now() - Date.parse(quote.retrievedAt)) / 1000;
}
export default function LiveResearchPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [outlookMessage, setOutlookMessage] = useState('');
  const [armedGame, setArmedGame] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [gameId, setGameId] = useState('');
  const [period, setPeriod] = useState('2H');
  const [book, setBook] = useState('caesars');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pricesBusy, setPricesBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [providerMessage, setProviderMessage] = useState('');
  const [audit, setAudit] = useState<Audit | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(auth.isSignedIn());
  const [combined, setCombined] = useState('');
  const [bankroll, setBankroll] = useState('');
  const [stake, setStake] = useState('');
  const [daily, setDaily] = useState('');
  const [gameExposure, setGameExposure] = useState('');
  const [boost, setBoost] = useState('');
  const [boostKind, setBoostKind] = useState('profit');
  const [maxStake, setMaxStake] = useState('');
  const [minLegs, setMinLegs] = useState('2');
  const [minimumOdds, setMinimumOdds] = useState('');
  const [expires, setExpires] = useState('');
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [tick, setTick] = useState(0);
  const generation = useRef(0),
    selectedGame = useRef('');
  const armed = useRef('');
  const paidRequest = useRef(false);
  const game = board?.context?.game;
  async function load(id = '', background = false) {
    const request = ++generation.current;
    if (!background) setBusy(true);
    setMessage('');
    try {
      const response = await api.get(
        '/api/live-board' + (id ? '?eventId=' + encodeURIComponent(id) : ''),
      );
      if (request !== generation.current) return;
      const next = response.data as Board;
      const nextId = next.context?.game.id ?? '';
      if (nextId !== selectedGame.current) {
        setQuotes([]);
        setResearch(null);
        setOutlook(null);
        setSelected([]);
        setAudit(null);
        setCombined('');
        armed.current = '';
        setArmedGame('');
      }
      selectedGame.current = nextId;
      setGameId(nextId);
      setBoard(next);
      setBusy(false);
      if (nextId) {
        void loadOutlook(nextId, request);
        if (
          armed.current === nextId &&
          next.context?.game.phase === 'halftime' &&
          document.visibilityState === 'visible'
        ) {
          armed.current = '';
          setArmedGame('');
          void providerPrices('props', nextId, true);
        } else if (
          armed.current === nextId &&
          ['second_half', 'final'].includes(next.context?.game.phase ?? '')
        ) {
          armed.current = '';
          setArmedGame('');
          setMessage(
            'The halftime window closed before the one-shot request ran. No automatic retry will spend credits.',
          );
        }
        if (paidRequest.current) return;
        setPricesBusy(true);
        try {
          const publicResult = await api.get(
            '/api/live-public-lines?eventId=' + encodeURIComponent(nextId),
          );
          if (request !== generation.current || paidRequest.current) return;
          const value = publicResult.data as Research;
          setResearch(value);
          setQuotes(value.quotes);
          setProviderMessage(
            'Public source: ' +
              value.publicSource.status +
              ' · ' +
              value.publicSource.matchedQuotes +
              ' observed sides. ' +
              (value.publicSource.truncated
                ? 'Source board is truncated.'
                : ''),
          );
        } catch (error) {
          if (request === generation.current)
            setProviderMessage(
              error instanceof Error
                ? error.message
                : 'Public prices unavailable; scoreboard remains available.',
            );
        } finally {
          if (request === generation.current && !paidRequest.current)
            setPricesBusy(false);
        }
      }
    } catch (error) {
      if (request === generation.current)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Live source unavailable. Retry without inventing a slip.',
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function loadOutlook(id: string, request = generation.current) {
    setOutlookMessage('Checking halftime model inputs…');
    try {
      const response = await api.get(
        '/api/halftime-outlook?eventId=' + encodeURIComponent(id),
      );
      if (request !== generation.current || selectedGame.current !== id) return;
      setOutlook(response.data as Outlook);
      setOutlookMessage('');
    } catch (error) {
      if (request === generation.current)
        setOutlookMessage(
          error instanceof Error
            ? error.message
            : 'Independent outlook unavailable. Game and quote checks continue separately.',
        );
    }
  }
  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible')
        void load(selectedGame.current, true);
    }, 30_000);
    const clock = window.setInterval(
      () => setTick((value) => value + 1),
      1_000,
    );
    return () => {
      generation.current++;
      armed.current = '';
      window.clearInterval(refresh);
      window.clearInterval(clock);
    };
  }, []);
  const visible = useMemo(
    () =>
      quotes.filter(
        (quote) =>
          quote.period === period && (book === 'all' || quote.book === book),
      ),
    [quotes, period, book],
  );
  const books = [...new Set(['caesars', ...quotes.map((quote) => quote.book)])];
  const selectedQuotes = quotes.filter((quote) => selected.includes(quote.id));
  async function signIn() {
    try {
      await auth.signIn();
      setSignedIn(auth.isSignedIn());
      setMessage(
        'Signed in. Loading provider prices remains an explicit choice.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Sign-in was cancelled or the popup was blocked.',
      );
    }
  }
  async function providerPrices(
    kind: 'periods' | 'props',
    target = selectedGame.current,
    requireHalftime = false,
  ) {
    if (!target || !auth.isSignedIn() || paidRequest.current) return;
    paidRequest.current = true;
    setPricesBusy(true);
    setMessage('');
    try {
      const response = await api.post('/api/live-prices', {
        eventId: target,
        kind,
        confirmCredits: kind === 'periods' ? 2 : 3,
        requireHalftime,
      });
      const data = response.data as Research & {
        provider: {
          health?: { status?: string; action?: string };
          creditsUsed?: number | null;
        };
      };
      if (selectedGame.current !== target) return;
      setQuotes(data.quotes);
      setResearch(data);
      setPeriod('2H');
      setBook('all');
      setBoard((current) =>
        current ? { ...current, context: data.context } : current,
      );
      const secondHalf = data.quotes.filter(
        (quote) => quote.period === '2H',
      ).length;
      setProviderMessage(
        'Provider: ' +
          (data.provider.health?.status ?? 'UNKNOWN') +
          '. ' +
          secondHalf +
          ' second-half sides returned. ' +
          (data.provider.health?.action ?? '') +
          ' Credits reported: ' +
          (data.provider.creditsUsed ?? 'unknown') +
          '.' +
          (secondHalf === 0
            ? ' No verified 2H offers returned; full-game lines were not substituted.'
            : ''),
      );
      setAudit(null);
      void loadOutlook(target);
    } catch (error) {
      if (selectedGame.current === target)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Provider request failed. No prices substituted.',
        );
    } finally {
      paidRequest.current = false;
      setPricesBusy(false);
    }
  }
  async function prepareSecondHalf() {
    const target = selectedGame.current;
    if (!target || preparing || paidRequest.current) return;
    setPreparing(true);
    setMessage('');
    try {
      if (!auth.isSignedIn()) await auth.signIn();
      setSignedIn(auth.isSignedIn());
      if (selectedGame.current !== target) return;
      const response = await api.get(
        '/api/live-board?eventId=' + encodeURIComponent(target),
      );
      if (selectedGame.current !== target) return;
      const current = response.data as Board;
      setBoard(current);
      const phase = current.context?.game.phase;
      if (phase === 'first_half') {
        armed.current = target;
        setArmedGame(target);
        setMessage(
          'Prepare 2H is armed for this game: one player-props request, up to 3 credits, when halftime is confirmed. Keep this page open and visible.',
        );
      } else if (phase === 'halftime') {
        armed.current = '';
        setArmedGame('');
        await providerPrices('props', target, true);
      } else {
        setMessage(
          'Prepare 2H is available during the first half or confirmed halftime. The app will not reuse halftime estimates after second-half play starts.',
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not prepare second-half research. No automatic retry is armed.',
      );
    } finally {
      setPreparing(false);
    }
  }
  async function checkConnection() {
    setMessage('');
    try {
      const response = await api.get('/api/live-provider-health');
      setProviderMessage(
        'Connection: ' +
          String(response.data.authentication) +
          ' · ' +
          String(response.data.action),
      );
    } catch (error) {
      setProviderMessage(
        error instanceof Error ? error.message : 'Connection check failed.',
      );
    }
  }
  function toggle(id: string) {
    setAudit(null);
    setSelected((values) =>
      values.includes(id)
        ? values.filter((value) => value !== id)
        : values.length < 4
          ? [...values, id]
          : values,
    );
  }
  function draft() {
    const used = new Set<string>();
    const candidates = visible.filter(
      (quote) =>
        quote.period === '2H' &&
        quote.estimate !== null &&
        quote.researchLowEv !== null &&
        quote.researchLowEv >= 0.03 &&
        quoteAge(quote) !== null &&
        quoteAge(quote)! >= 0 &&
        quoteAge(quote)! <= 90 &&
        quote.referenceBookCount >= 2,
    );
    const draftIds: string[] = [];
    for (const quote of candidates) {
      const key = [quote.player, quote.market, quote.period].join('|');
      if (used.has(key)) continue;
      used.add(key);
      draftIds.push(quote.id);
      if (draftIds.length === 2) break;
    }
    if (draftIds.length < 2) {
      setMessage(
        'HOLD: fewer than two modeled 2H candidates meet the +3% stress screen, fresh-price and two-reference requirements.',
      );
      return;
    }
    setSelected(draftIds);
    setAudit(null);
    setMessage(
      'Research draft selected. Joint probability and account payout are not verified; no wager is recommended.',
    );
  }
  async function analyze() {
    setAuditBusy(true);
    setMessage('');
    try {
      const expiry = expires ? new Date(expires) : null;
      const response = await api.post('/api/live-slip-audit', {
        eventId: gameId,
        quoteIds: selected,
        combinedAmericanOdds: combined === '' ? null : Number(combined),
        bankroll: bankroll === '' ? null : Number(bankroll),
        stake: stake === '' ? null : Number(stake),
        dailyExposure: daily === '' ? null : Number(daily),
        gameExposure: gameExposure === '' ? null : Number(gameExposure),
        boost: {
          percent: boost === '' ? 0 : Number(boost),
          kind: boostKind,
          maxStake: maxStake === '' ? null : Number(maxStake),
          minLegs: Number(minLegs),
          minimumAmericanOdds: minimumOdds === '' ? null : Number(minimumOdds),
          expiresAt:
            expiry && Number.isFinite(expiry.getTime())
              ? expiry.toISOString()
              : null,
          rulesConfirmed,
          book: book === 'all' ? '' : book,
        },
      });
      setAudit(response.data as Audit);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Slip could not be verified.',
      );
    } finally {
      setAuditBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          { board, research, outlook, selectedQuotes, audit },
          null,
          2,
        ),
      );
      setMessage(
        'Research copied with source times, model scope and HOLD reasons.',
      );
    } catch {
      setMessage('Clipboard unavailable; research remains visible here.');
    }
  }
  return (
    <div className="simpleHome liveWorkspace" data-clock-tick={tick}>
      <section className="simpleHero">
        <span className="simpleEyebrow">
          <Radio size={16} /> LIVE NFL & SECOND HALF
        </span>
        <h1>One game. Current evidence.</h1>
        <p>
          Score, clock, player usage, exact market periods, independent
          reception estimates and boost math in one place.
        </p>
        <div className="simpleButtons">
          <button
            type="button"
            className="simplePrimary"
            disabled={busy}
            onClick={() => void load(gameId)}
          >
            <RefreshCw size={17} />{' '}
            {busy ? 'Refreshing game…' : 'Refresh live game'}
          </button>
          <button type="button" className="simpleSecondary" onClick={copy}>
            <ClipboardCopy size={16} /> Copy live research
          </button>
        </div>
        <small>
          Free context and model readiness refresh every 30 seconds while
          visible. Prepare 2H authorizes one props request, up to 3 credits; no
          paid polling or automatic wagers.
        </small>
      </section>
      {message && (
        <p className="simpleFeedback" role="status">
          {message}
        </p>
      )}
      {board && (
        <>
          <section className="simplePanel">
            <label className="liveLabel">
              Game
              <select
                aria-label="Live game"
                value={gameId}
                onChange={(event) => void load(event.target.value)}
              >
                {board.scoreboard.games.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.event} · {item.status}
                  </option>
                ))}
              </select>
            </label>
            {!game && (
              <p>
                No game returned for this date. No matchup or price was
                fabricated.
              </p>
            )}
            {game && (
              <>
                <div className="liveScore">
                  <div>
                    <span>{game.away.name}</span>
                    <strong>{game.away.score ?? '—'}</strong>
                  </div>
                  <div>
                    <b>
                      {game.phase === 'halftime' ? 'HALFTIME' : game.status}
                    </b>
                    <span>
                      {game.period === null ? '' : `Period ${game.period}`} ·{' '}
                      {game.clock}
                    </span>
                  </div>
                  <div>
                    <span>{game.home.name}</span>
                    <strong>{game.home.score ?? '—'}</strong>
                  </div>
                </div>
                <p className="simpleCaution">
                  ESPN observation:{' '}
                  {new Date(board.context!.retrievedAt).toLocaleTimeString()}.
                  This is a retrieved scoreboard, not proof of zero feed latency
                  or a fresh sportsbook price.
                </p>
                <p>
                  {game.phase === 'halftime'
                    ? 'Completed first-half receiving stats can be used by the separately calibrated halftime reception model.'
                    : game.phase === 'second_half'
                      ? 'Second-half play has begun. The halftime-only model does not estimate remaining-game probabilities.'
                      : game.phase === 'first_half'
                        ? 'First half is still in progress. Halftime estimates stay locked until the first half is complete.'
                        : 'Pregame probabilities and second-half probabilities are separate models.'}
                </p>
                <details>
                  <summary>
                    Current receiving usage & availability notes
                  </summary>
                  <div className="liveUsage">
                    {board.context!.players.map((player) => (
                      <p key={player.espnId}>
                        <strong>{player.name}</strong> ·{' '}
                        {player.receptions ?? 'unknown'} REC /{' '}
                        {player.targets ?? 'unknown'} targets /{' '}
                        {player.receivingYards ?? 'unknown'} yards
                      </p>
                    ))}
                  </div>
                  <p>
                    Missing players are not assigned zero catches or healthy
                    status. Public injury observations do not confirm official
                    active status or halftime availability.
                  </p>
                </details>
              </>
            )}
          </section>
          <section className="simplePanel">
            <h2>Independent halftime outlook</h2>
            <p>
              Model probabilities are calculated separately from the sportsbook
              feed. The thresholds below are research questions, not offered
              lines or picks.
            </p>
            {outlookMessage && <p role="status">{outlookMessage}</p>}
            {outlook &&
              outlook.eventId === gameId &&
              outlook.phase === game?.phase && (
                <>
                  <p role="status">
                    <strong>{outlook.status.replaceAll('_', ' ')}</strong> ·{' '}
                    {outlook.reason}
                  </p>
                  <small>
                    Game observation:{' '}
                    {new Date(outlook.contextRetrievedAt).toLocaleTimeString()}.
                    Second half includes overtime. Historical research model; $0
                    recommended stake.
                  </small>
                  {outlook.players.map((player) => (
                    <details key={player.espnId}>
                      <summary>
                        {player.player} ·{' '}
                        {player.firstHalfReceptions ?? 'unknown'} first-half REC
                        ·{' '}
                        {player.status === 'ESTIMATED'
                          ? 'Probabilities available'
                          : 'Unavailable'}
                      </summary>
                      <p>{player.reason}</p>
                      {player.thresholds.length > 0 && (
                        <div className="liveUsage">
                          {player.thresholds.map((threshold) => (
                            <p key={threshold.line}>
                              <strong>2H receptions {threshold.line}</strong> ·
                              Over {percent(threshold.over)} / Under{' '}
                              {percent(threshold.under)} · Over stress range{' '}
                              {percent(threshold.overLow)}–
                              {percent(threshold.overHigh)}
                            </p>
                          ))}
                        </div>
                      )}
                    </details>
                  ))}
                </>
              )}
          </section>
          <section className="simplePanel">
            <div className="simpleHeading">
              <div>
                <h2>Live & 2H prices</h2>
                <p>
                  Second-half, full-game and unknown-period offers never share a
                  probability estimate.
                </p>
              </div>
            </div>
            <div className="simpleButtons">
              <button
                type="button"
                className="simplePrimary"
                disabled={
                  preparing ||
                  pricesBusy ||
                  !gameId ||
                  !board.provider.configured ||
                  armedGame === gameId ||
                  !['first_half', 'halftime'].includes(game?.phase ?? '')
                }
                onClick={() => void prepareSecondHalf()}
              >
                {preparing
                  ? 'Preparing…'
                  : 'Prepare 2H · once · up to 3 credits'}
              </button>
              {armedGame && (
                <button
                  type="button"
                  className="simpleSecondary"
                  onClick={() => {
                    armed.current = '';
                    setArmedGame('');
                    setMessage('Scheduled props request cancelled.');
                  }}
                >
                  Cancel halftime request
                </button>
              )}
              <button
                type="button"
                className="simpleSecondary"
                onClick={checkConnection}
              >
                Check connection · 0 credits
              </button>
              {!signedIn && (
                <button
                  type="button"
                  className="simpleSecondary"
                  onClick={signIn}
                >
                  Sign in for provider prices
                </button>
              )}
              <button
                type="button"
                className="simpleSecondary"
                disabled={
                  !signedIn ||
                  pricesBusy ||
                  !gameId ||
                  !board.provider.configured
                }
                onClick={() => void providerPrices('periods')}
              >
                Load 2H game markets · up to 2 credits
              </button>
              <button
                type="button"
                className="simpleSecondary"
                disabled={
                  !signedIn ||
                  pricesBusy ||
                  !gameId ||
                  !board.provider.configured
                }
                onClick={() => void providerPrices('props')}
              >
                Load player props · up to 3 credits
              </button>
            </div>
            <p>
              Prepare 2H signs you in if needed, checks the game phase and loads
              player props once at confirmed halftime while this page stays open
              and visible. It stops after that attempt. An empty provider
              response remains empty; no screenshot is needed.
            </p>
            {armedGame && (
              <p role="status">
                One props request armed for this game at halftime · maximum 3
                credits. Changing games or leaving this page cancels it.
              </p>
            )}
            {!board.provider.configured && (
              <p className="simpleFeedback">
                Live price provider is not connected. Add PARLAY_API_KEY using
                secure integration settings; the app cannot manufacture prices
                or credentials.
              </p>
            )}
            <p role="status">
              {pricesBusy ? 'Loading market evidence… ' : ''}
              {providerMessage}
            </p>
            <div className="liveFields">
              <label>
                Market period
                <select
                  aria-label="Market period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  <option value="2H">Second half only</option>
                  <option value="FULL">Full game</option>
                  <option value="UNKNOWN">Unknown segment · excluded</option>
                </select>
              </label>
              <label>
                Sportsbook
                <select
                  aria-label="Sportsbook filter"
                  value={book}
                  onChange={(event) => setBook(event.target.value)}
                >
                  <option value="all">All books · comparison only</option>
                  {books.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              {quotes.filter((quote) => quote.period === '2H').length} observed
              2H sides ·{' '}
              {quotes.filter((quote) => quote.period === 'FULL').length}{' '}
              full-game sides ·{' '}
              {quotes.filter((quote) => quote.period === 'UNKNOWN').length}{' '}
              unknown-period sides.
            </p>
            {visible.length === 0 ? (
              <p className="simpleEmpty">
                No exact prices returned for this period and book. Check the
                source connection or select another book; this is not a
                manufactured slip.
              </p>
            ) : (
              <div className="liveQuoteList">
                {visible.slice(0, 70).map((quote) => {
                  const age = quoteAge(quote),
                    fresh = age !== null && age >= 0 && age <= 90;
                  return (
                    <article className="simpleMarket" key={quote.id}>
                      <div className="simpleMarketTop">
                        <span>
                          {quote.book} · {quote.period}
                        </span>
                        <span className="simpleWatch">
                          {fresh
                            ? 'OBSERVATION · CHECK STATUS'
                            : 'EXPIRED / UNKNOWN AGE'}
                        </span>
                      </div>
                      <h3>{label(quote)}</h3>
                      <strong>{price(quote)}</strong>
                      <p>
                        {quote.estimate
                          ? 'Model estimate ' +
                            percent(quote.estimate.probability) +
                            ' · stress ' +
                            percent(quote.estimate.probabilityLow) +
                            ' to ' +
                            percent(quote.estimate.probabilityHigh)
                          : quote.modelReason}
                      </p>
                      {quote.estimate && (
                        <small>
                          {quote.estimate.researchContract}. Quote settlement
                          and injury compatibility still require verification.
                        </small>
                      )}
                      <p>
                        {quote.researchEv === null
                          ? 'EV unavailable'
                          : `Research EV ${percent(quote.researchEv)} · stress EV ${percent(quote.researchLowEv)}`}{' '}
                        · Break-even {percent(quote.breakEvenProbability)}
                      </p>
                      <p>
                        {quote.referenceBookCount} other two-sided books ·
                        Market benchmark{' '}
                        {percent(quote.marketBenchmarkProbability)}
                      </p>
                      <small>
                        {age === null
                          ? 'Source quote age unavailable'
                          : Math.round(age) + 's old'}{' '}
                        · {quote.status} · {quote.provider} ·{' '}
                        {quote.timestampBasis}
                      </small>
                      <button
                        type="button"
                        className="simpleSecondary"
                        disabled={
                          period !== '2H' ||
                          (!selected.includes(quote.id) &&
                            (!fresh || selected.length >= 4))
                        }
                        onClick={() => toggle(quote.id)}
                      >
                        {selected.includes(quote.id)
                          ? 'Remove from draft'
                          : 'Add to 2H draft'}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            <button type="button" className="simpleSecondary" onClick={draft}>
              Find 2H research draft
            </button>
          </section>
          <section className="simplePanel" onChange={() => setAudit(null)}>
            <h2>Slip & boost check</h2>
            <p>
              Selected: {selected.length}/4. Same-game leg probabilities are not
              multiplied into a joint win probability.
            </p>
            {selectedQuotes.map((quote) => (
              <p key={quote.id}>
                {label(quote)} · {quote.book} · {price(quote)}
              </p>
            ))}
            <div className="liveFields">
              <label>
                Actual combined American odds
                <input
                  aria-label="Actual combined odds"
                  placeholder="+250"
                  value={combined}
                  onChange={(event) => {
                    setCombined(event.target.value);
                    setAudit(null);
                  }}
                />
              </label>
              <label>
                Latest confirmed bankroll ($)
                <input
                  aria-label="Confirmed bankroll"
                  inputMode="decimal"
                  value={bankroll}
                  onChange={(event) => setBankroll(event.target.value)}
                  placeholder="No old balance assumed"
                />
              </label>
              <label>
                Requested stake ($)
                <input
                  inputMode="decimal"
                  value={stake}
                  onChange={(event) => setStake(event.target.value)}
                />
              </label>
              <label>
                Existing daily exposure ($)
                <input
                  inputMode="decimal"
                  value={daily}
                  onChange={(event) => setDaily(event.target.value)}
                />
              </label>
              <label>
                Existing game exposure ($)
                <input
                  inputMode="decimal"
                  value={gameExposure}
                  onChange={(event) => setGameExposure(event.target.value)}
                />
              </label>
            </div>
            <details>
              <summary>Promotion terms from your actual offer</summary>
              <p>
                Account-specific boosts cannot be inferred from a public price
                feed. Enter the actual terms; no screenshot is required.
              </p>
              <div
                className="liveFields"
                onChange={() => setRulesConfirmed(false)}
              >
                <label>
                  Boost (%)
                  <input
                    aria-label="Boost percentage"
                    inputMode="decimal"
                    value={boost}
                    onChange={(event) => setBoost(event.target.value)}
                  />
                </label>
                <label>
                  Boost applies to
                  <select
                    value={boostKind}
                    onChange={(event) => setBoostKind(event.target.value)}
                  >
                    <option value="profit">Profit only</option>
                    <option value="return">Total return</option>
                  </select>
                </label>
                <label>
                  Maximum promo stake ($)
                  <input
                    inputMode="decimal"
                    value={maxStake}
                    onChange={(event) => setMaxStake(event.target.value)}
                  />
                </label>
                <label>
                  Minimum legs
                  <input
                    inputMode="numeric"
                    value={minLegs}
                    onChange={(event) => setMinLegs(event.target.value)}
                  />
                </label>
                <label>
                  Minimum combined American odds, if any
                  <input
                    value={minimumOdds}
                    onChange={(event) => setMinimumOdds(event.target.value)}
                  />
                </label>
                <label>
                  Offer expires (your local time)
                  <input
                    type="datetime-local"
                    value={expires}
                    onChange={(event) => setExpires(event.target.value)}
                  />
                </label>
              </div>
              <label className="liveCheckbox">
                <input
                  type="checkbox"
                  checked={rulesConfirmed}
                  onChange={(event) => setRulesConfirmed(event.target.checked)}
                />{' '}
                I checked the offer's eligibility, cash payout and rules for the
                selected sportsbook.
              </label>
            </details>
            <button
              type="button"
              className="simplePrimary"
              disabled={auditBusy || selected.length < 2}
              onClick={analyze}
            >
              {auditBusy ? 'Checking draft…' : 'Evaluate selected 2H slip'}
            </button>
            {audit && (
              <div className="liveAudit" role="status">
                <h3>{audit.recommendation} · Recommended stake $0</h3>
                <p>
                  Boosted face-value return:{' '}
                  {audit.boostedDecimalPayout === null
                    ? 'unverified'
                    : audit.boostedDecimalPayout.toFixed(3) + 'x'}{' '}
                  · Binary payout threshold:{' '}
                  {percent(audit.headlineBreakEvenProbability)}
                </p>
                <p>
                  Joint win probability: unavailable · Joint EV: unavailable.
                  Push/void/DFS flex rules may change the payout threshold.
                </p>
                {audit.risk.maxParlayCapBeforeModelApproval !== null && (
                  <p>
                    Risk ceiling before model approval: $
                    {audit.risk.maxParlayCapBeforeModelApproval.toFixed(2)}.
                    This is a cap, not a recommended stake.
                  </p>
                )}
                <ul>
                  {audit.blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section className="simplePanel">
            <h2>Independent model coverage</h2>
            <p>
              Full-game receptions:{' '}
              {board.model.fullGame.testPlayerGames.toLocaleString()} held-out
              player-games · Brier {board.model.fullGame.brier.toFixed(4)} vs{' '}
              {board.model.fullGame.baselineBrier.toFixed(4)} baseline.
            </p>
            <p>
              Halftime receptions:{' '}
              {board.model.halftime.testPlayerGames.toLocaleString()} held-out
              player-games · Brier {board.model.halftime.brier.toFixed(4)} vs{' '}
              {board.model.halftime.baselineBrier.toFixed(4)} baseline. Lower is
              better; this is not betting ROI.
            </p>
            <p>
              Both are historical research models. Current-vintage data,
              unmodeled injury/role changes, actual offered prices and joint
              outcomes still limit betting use.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
