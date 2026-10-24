import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '@appdeploy/client';
import {
  MARKET_LABELS,
  marketKey,
  type AccountLeg,
  type SlipContract,
} from '../shared/accountSlip';
import type { FreeLine } from '../backend/freeUnderdog';
import type { auditAccountSlip } from '../backend/accountSlipAudit';

const SPORTS = [
  ['basketball_nba', 'NBA'],
  ['icehockey_nhl', 'NHL'],
  ['americanfootball_nfl', 'NFL'],
  ['baseball_mlb', 'MLB'],
  ['americanfootball_ncaaf', 'College football'],
  ['basketball_wnba', 'WNBA'],
  ['tennis', 'Tennis'],
  ['mma', 'MMA'],
] as const;
const STORAGE_KEY = 'edgeboard.account-slip.v1';
type DraftLeg = Omit<AccountLeg, 'line'> & { line: string };
type PayoutDraft = {
  baseDecimal: string;
  displayedBoostedDecimal: string;
  boostPercent: string;
  boostKind: 'profit' | 'return';
  extraFunds: 'bonus' | 'cash';
  bonusValue: string;
  payoutIsMaximum: boolean;
  allOrNothingConfirmed: boolean;
  rulesConfirmed: boolean;
  minLegs: string;
  maxStake: string;
  expiresAt: string;
  bankroll: string;
  stake: string;
  dailyExposure: string;
  gameExposure: string;
};
type Draft = { legs: DraftLeg[]; payout: PayoutDraft };
type Audit = ReturnType<typeof auditAccountSlip>;
type PublicPage = {
  retrievedAt: string;
  lastCheckedAt: string;
  staleCacheUsed: boolean;
  totalMatchingLines: number;
  count: number;
  offset: number;
  nextOffset: number | null;
  snapshotId: string;
  lines: FreeLine[];
};

function emptyLeg(): DraftLeg {
  return {
    sport: 'basketball_nba',
    event: '',
    player: '',
    market: 'pts_rebs_asts',
    line: '',
    side: 'Higher',
    period: 'UNKNOWN',
    accountConfirmed: false,
  };
}
function emptyDraft(): Draft {
  return {
    legs: [emptyLeg(), emptyLeg()],
    payout: {
      baseDecimal: '',
      displayedBoostedDecimal: '',
      boostPercent: '25',
      boostKind: 'profit',
      extraFunds: 'bonus',
      bonusValue: '0',
      payoutIsMaximum: true,
      allOrNothingConfirmed: false,
      rulesConfirmed: false,
      minLegs: '2',
      maxStake: '',
      expiresAt: '',
      bankroll: '',
      stake: '',
      dailyExposure: '',
      gameExposure: '',
    },
  };
}
function initialDraft(): Draft {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Draft | null;
    if (
      saved &&
      Array.isArray(saved.legs) &&
      saved.legs.length >= 2 &&
      saved.legs.length <= 4 &&
      saved.legs.every(
        (leg) =>
          typeof leg.player === 'string' && typeof leg.event === 'string',
      ) &&
      saved.payout &&
      typeof saved.payout.baseDecimal === 'string'
    ) {
      // A new browser session must re-confirm the actual account selections.
      return {
        ...saved,
        payout: {
          ...emptyDraft().payout,
          ...saved.payout,
          rulesConfirmed: false,
          allOrNothingConfirmed: false,
        },
        legs: saved.legs.map((leg) => ({
          ...emptyLeg(),
          ...leg,
          accountConfirmed: false,
        })),
      };
    }
  } catch {
    /* A missing or invalid saved draft starts empty. */
  }
  return emptyDraft();
}
function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}
function time(value: string) {
  return new Date(value).toLocaleString();
}

export default function AccountSlipWorkspace() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [sport, setSport] = useState('basketball_nba');
  const [player, setPlayer] = useState('');
  const [market, setMarket] = useState('');
  const [page, setPage] = useState<PublicPage | null>(null);
  const [loadedSearch, setLoadedSearch] = useState<{
    sport: string;
    player: string;
    market: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [audit, setAudit] = useState<Audit | null>(null);
  const [auditError, setAuditError] = useState('');
  const [storageNotice, setStorageNotice] = useState(
    'Draft selections stay in this browser until you run a check.',
  );
  const revision = useRef(0);
  const searchRequest = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      setStorageNotice(
        'Browser draft saving is unavailable. Copy the checked report before leaving.',
      );
    }
  }, [draft]);
  useEffect(
    () => () => {
      searchRequest.current += 1;
      revision.current += 1;
    },
    [],
  );

  function changeDraft(update: (previous: Draft) => Draft) {
    revision.current += 1;
    setDraft(update);
    setAudit(null);
    setAuditError('');
  }
  function changeLeg(
    index: number,
    field: keyof Omit<DraftLeg, 'reference'>,
    value: string | boolean,
  ) {
    changeDraft((previous) => ({
      ...previous,
      legs: previous.legs.map((leg, at) =>
        at === index
          ? {
              ...leg,
              [field]: value,
              accountConfirmed:
                field === 'accountConfirmed' ? value === true : false,
            }
          : leg,
      ),
    }));
  }
  function changePayout(field: keyof PayoutDraft, value: string | boolean) {
    changeDraft((previous) => ({
      ...previous,
      payout: { ...previous.payout, [field]: value },
    }));
  }
  function changeSearch(update: () => void) {
    searchRequest.current += 1;
    update();
    setPage(null);
    setLoadedSearch(null);
    setMessage('');
    setBusy(false);
  }
  async function search(next = false, refresh = false) {
    const request = ++searchRequest.current;
    const filters =
      next && loadedSearch ? loadedSearch : { sport, player, market };
    const params = new URLSearchParams({
      ...filters,
      limit: '40',
      pregameOnly: 'true',
    });
    if (next && page?.nextOffset !== null && page?.nextOffset !== undefined) {
      params.set('offset', String(page.nextOffset));
      params.set('snapshotId', page.snapshotId);
    }
    if (refresh) params.set('refresh', 'true');
    setBusy(true);
    setMessage('');
    try {
      const response = await api.get(`/api/v1/underdog?${params}`);
      if (request === searchRequest.current) {
        setPage(response.data as PublicPage);
        setLoadedSearch(filters);
      }
    } catch (failure) {
      if (request === searchRequest.current) {
        setPage(null);
        setMessage(
          failure instanceof Error
            ? failure.message
            : 'Public quotes unavailable. Your account draft was kept.',
        );
      }
    } finally {
      if (request === searchRequest.current) setBusy(false);
    }
  }
  function useReference(
    quote: FreeLine,
    side: 'Higher' | 'Lower',
    slot: number,
  ) {
    const key = marketKey(quote.market);
    if (!key) return;
    const period: SlipContract['period'] = ['FULL_GAME', '1H', '2H'].includes(
      quote.period,
    )
      ? (quote.period as SlipContract['period'])
      : 'UNKNOWN';
    const reference: SlipContract = {
      sport,
      event: quote.event,
      player: quote.player,
      market: key,
      side,
      line: quote.line,
      period,
    };
    changeDraft((previous) => ({
      ...previous,
      legs: previous.legs.map((leg, index) =>
        index === slot
          ? {
              ...reference,
              line: String(quote.line),
              accountConfirmed: false,
              reference,
            }
          : leg,
      ),
    }));
    document
      .getElementById('account-entry-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function check(event: FormEvent) {
    event.preventDefault();
    const request = revision.current;
    setChecking(true);
    setAuditError('');
    setAudit(null);
    try {
      const response = await api.post('/api/account-slip-check', draft);
      if (request === revision.current) setAudit(response.data as Audit);
    } catch (failure) {
      if (request === revision.current)
        setAuditError(
          failure instanceof Error
            ? failure.message
            : 'Slip check unavailable. No bet was approved.',
        );
    } finally {
      setChecking(false);
    }
  }
  async function copyAudit() {
    if (!audit) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(audit, null, 2));
      setAuditError('Checked report copied.');
    } catch {
      setAuditError(
        'Copy is unavailable in this browser. Your checked result remains below.',
      );
    }
  }

  return (
    <div className="accountWorkspace">
      <header className="advancedIntro">
        <span className="simpleEyebrow">EXACT ACCOUNT ENTRY</span>
        <h1>Check my slip</h1>
        <p>
          Match the player, market, threshold and period to your app. Public
          quotes are a comparison source; your account entry stays
          authoritative.
        </p>
      </header>
      <section className="accountPanel" id="account-entry-form">
        <h2>Your Underdog selections</h2>
        <p>
          Copy the full market name. Points + Rebounds is different from Points
          + Rebounds + Assists. Rebounds and Assists are different markets.
        </p>
        <small>{storageNotice} A saved draft is never a placed wager.</small>
        <form onSubmit={check}>
          {draft.legs.map((leg, index) => (
            <fieldset key={index} className="accountLeg">
              <legend>Selection {index + 1}</legend>
              <div className="accountFields">
                <label>
                  Sport
                  <select
                    value={leg.sport}
                    onChange={(event) =>
                      changeLeg(index, 'sport', event.target.value)
                    }
                  >
                    {SPORTS.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Player
                  <input
                    required
                    maxLength={200}
                    value={leg.player}
                    onChange={(event) =>
                      changeLeg(index, 'player', event.target.value)
                    }
                  />
                </label>
                <label className="accountWide">
                  Event
                  <input
                    required
                    maxLength={200}
                    value={leg.event}
                    placeholder="Use the public browser below to fill the exact matchup"
                    onChange={(event) =>
                      changeLeg(index, 'event', event.target.value)
                    }
                  />
                </label>
                <label>
                  Account market
                  <select
                    value={leg.market}
                    onChange={(event) =>
                      changeLeg(index, 'market', event.target.value)
                    }
                  >
                    {Object.entries(MARKET_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Account threshold
                  <input
                    required
                    inputMode="decimal"
                    value={leg.line}
                    onChange={(event) =>
                      changeLeg(index, 'line', event.target.value)
                    }
                  />
                </label>
                <label>
                  Side
                  <select
                    value={leg.side}
                    onChange={(event) =>
                      changeLeg(index, 'side', event.target.value)
                    }
                  >
                    <option>Higher</option>
                    <option>Lower</option>
                  </select>
                </label>
                <label>
                  Account period
                  <select
                    value={leg.period}
                    onChange={(event) =>
                      changeLeg(index, 'period', event.target.value)
                    }
                  >
                    <option value="UNKNOWN">Not confirmed</option>
                    <option value="FULL_GAME">Full game</option>
                    <option value="1H">First half</option>
                    <option value="2H">Second half</option>
                  </select>
                </label>
              </div>
              {leg.reference && (
                <p className="accountReference">
                  Earlier public reference: {leg.reference.side}{' '}
                  {leg.reference.line} {MARKET_LABELS[leg.reference.market]} ·
                  period {leg.reference.period}. Editing your account fields
                  does not change this reference.
                </p>
              )}
              <label className="accountCheckbox">
                <input
                  type="checkbox"
                  checked={leg.accountConfirmed}
                  onChange={(event) =>
                    changeLeg(index, 'accountConfirmed', event.target.checked)
                  }
                />
                I checked this exact selection against my account entry.
              </label>
              {draft.legs.length > 2 && (
                <button
                  type="button"
                  onClick={() =>
                    changeDraft((previous) => ({
                      ...previous,
                      legs: previous.legs.filter((_, at) => at !== index),
                    }))
                  }
                >
                  Remove selection {index + 1}
                </button>
              )}
            </fieldset>
          ))}
          {draft.legs.length < 4 && (
            <button
              type="button"
              onClick={() =>
                changeDraft((previous) => ({
                  ...previous,
                  legs: [...previous.legs, emptyLeg()],
                }))
              }
            >
              Add selection
            </button>
          )}
          <h2>Actual combined payout</h2>
          <p>
            Enter the entry's total return including stake. Do not multiply
            individual prices or add the boost a second time.
          </p>
          <div className="accountFields">
            <label>
              Unboosted combined return (×)
              <input
                required
                inputMode="decimal"
                value={draft.payout.baseDecimal}
                onChange={(event) =>
                  changePayout('baseDecimal', event.target.value)
                }
              />
            </label>
            <label>
              Displayed boosted return (×)
              <input
                inputMode="decimal"
                value={draft.payout.displayedBoostedDecimal}
                onChange={(event) =>
                  changePayout('displayedBoostedDecimal', event.target.value)
                }
              />
            </label>
            <label>
              Boost (%)
              <input
                required
                inputMode="decimal"
                value={draft.payout.boostPercent}
                onChange={(event) =>
                  changePayout('boostPercent', event.target.value)
                }
              />
            </label>
            <label>
              Boost applies to
              <select
                value={draft.payout.boostKind}
                onChange={(event) =>
                  changePayout('boostKind', event.target.value)
                }
              >
                <option value="profit">Profit</option>
                <option value="return">Total return</option>
              </select>
            </label>
            <label>
              Extra winnings paid as
              <select
                value={draft.payout.extraFunds}
                onChange={(event) =>
                  changePayout('extraFunds', event.target.value)
                }
              >
                <option value="bonus">Bonus funds</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label>
              Bonus value assumption (0–1)
              <input
                required
                inputMode="decimal"
                value={draft.payout.bonusValue}
                onChange={(event) =>
                  changePayout('bonusValue', event.target.value)
                }
              />
            </label>
          </div>
          <p className="accountReference">
            0 gives bonus funds no immediate cash value; 1 uses full face value.
            This is your sensitivity assumption, not a measured conversion rate.
          </p>
          <label className="accountCheckbox">
            <input
              type="checkbox"
              checked={draft.payout.payoutIsMaximum}
              onChange={(event) =>
                changePayout('payoutIsMaximum', event.target.checked)
              }
            />
            My app labels this payout as a maximum.
          </label>
          <label className="accountCheckbox">
            <input
              type="checkbox"
              checked={draft.payout.allOrNothingConfirmed}
              onChange={(event) =>
                changePayout('allOrNothingConfirmed', event.target.checked)
              }
            />
            I confirmed all-win/all-loss payout rules; flex payouts, ties and
            voids need separate treatment.
          </label>
          <details>
            <summary>Promotion eligibility and bankroll limits</summary>
            <div className="accountFields">
              {(
                [
                  ['minLegs', 'Minimum selections'],
                  ['maxStake', 'Promotion stake limit ($)'],
                  ['bankroll', 'Current confirmed bankroll ($)'],
                  ['stake', 'Requested stake ($)'],
                  ['dailyExposure', 'Current daily exposure ($)'],
                  [
                    'gameExposure',
                    'Largest current exposure to a game on this slip ($)',
                  ],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    inputMode="decimal"
                    value={draft.payout[key]}
                    onChange={(event) => changePayout(key, event.target.value)}
                  />
                </label>
              ))}
              <label className="accountWide">
                Promotion expiry with timezone
                <input
                  value={draft.payout.expiresAt}
                  placeholder="YYYY-MM-DDTHH:mm:ss-07:00"
                  onChange={(event) =>
                    changePayout('expiresAt', event.target.value)
                  }
                />
              </label>
            </div>
            <label className="accountCheckbox">
              <input
                type="checkbox"
                checked={draft.payout.rulesConfirmed}
                onChange={(event) =>
                  changePayout('rulesConfirmed', event.target.checked)
                }
              />
              I confirmed account eligibility, minimum picks, stake cap, expiry
              and bonus playthrough rules.
            </label>
          </details>
          <button className="simplePrimary" disabled={checking} type="submit">
            {checking ? 'Checking entry…' : 'Check exact entry'}
          </button>
        </form>
        {auditError && (
          <p role="status" className="accountNotice">
            {auditError}
          </p>
        )}
        {audit && (
          <section
            className="accountResult"
            aria-live="polite"
            aria-label="Exact entry result"
          >
            <h2>HOLD · recommended stake $0</h2>
            <p>
              Joint win probability and EV are unverified. The requirements
              below are payout math, not predicted hit rates.
            </p>
            <div className="accountMetrics">
              <div>
                <span>Cash return per $1 if all win</span>
                <strong>${audit.payout.cashReturnPerUnit.toFixed(3)}</strong>
              </div>
              <div>
                <span>Bonus return per $1 if all win</span>
                <strong>${audit.payout.bonusReturnPerUnit.toFixed(3)}</strong>
              </div>
              <div>
                <span>Break-even joint win requirement</span>
                <strong>{percent(audit.payout.breakEvenProbability)}</strong>
              </div>
              <div>
                <span>Joint requirement for +3% EV</span>
                <strong>
                  {percent(
                    audit.payout.requiredJointProbabilityForThreePercentEv,
                  )}
                </strong>
              </div>
            </div>
            <p>
              {audit.payout.thresholdBasis === 'MAXIMUM_RETURN_OPTIMISTIC_ONLY'
                ? 'Maximum-payout scenario only: actual settlement-weighted requirements may be higher.'
                : 'Binary payout scenario only; grading rules must match.'}
            </p>
            {audit.comparisons.map((comparison, index) => (
              <div className="accountComparison" key={index}>
                <strong>
                  {comparison.account.player} · {comparison.account.side}{' '}
                  {comparison.account.line}{' '}
                  {MARKET_LABELS[comparison.account.market]}
                </strong>
                <p>
                  {comparison.status.replaceAll('_', ' ')}
                  {comparison.referenceChanges.length
                    ? ` · Earlier research changed: ${comparison.referenceChanges.join(', ')}`
                    : ''}
                </p>
                {!!comparison.nearbyPublicLines.length && (
                  <small>
                    Current public thresholds:{' '}
                    {[
                      ...new Set(
                        comparison.nearbyPublicLines.map((quote) =>
                          String(quote.line),
                        ),
                      ),
                    ].join(', ')}
                    . Account selection kept as entered.
                  </small>
                )}
              </div>
            ))}
            <ul>
              {audit.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <button type="button" onClick={copyAudit}>
              Copy checked report
            </button>
          </section>
        )}
      </section>
      <section className="accountPanel">
        <h2>Browse all public props</h2>
        <p>
          Search the complete source board before paging. These observations are
          not recommendations or confirmed account prices. No paid provider
          requests.
        </p>
        <div className="accountFields">
          <label>
            Browse sport
            <select
              value={sport}
              onChange={(event) =>
                changeSearch(() => setSport(event.target.value))
              }
            >
              {SPORTS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search player
            <input
              maxLength={200}
              value={player}
              onChange={(event) =>
                changeSearch(() => setPlayer(event.target.value))
              }
            />
          </label>
          <label>
            Filter exact market
            <select
              value={market}
              onChange={(event) =>
                changeSearch(() => setMarket(event.target.value))
              }
            >
              <option value="">All markets</option>
              {Object.entries(MARKET_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="accountActions">
          <button type="button" disabled={busy} onClick={() => search()}>
            Search public props
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => search(false, true)}
          >
            Refresh public source
          </button>
        </div>
        {busy && <p role="status">Loading public observations…</p>}
        {message && (
          <p role="alert" className="accountNotice">
            {message} Search again to retry.
          </p>
        )}
        {page && (
          <>
            <p role="status">
              {page.count
                ? `${page.offset + 1}–${page.offset + page.count}`
                : '0'}{' '}
              of {page.totalMatchingLines} matching public lines. Source
              received {time(page.retrievedAt)}; last checked{' '}
              {time(page.lastCheckedAt)}.
            </p>
            {page.staleCacheUsed && (
              <p role="alert" className="accountNotice">
                Public refresh failed. Cached observations are stale and cannot
                verify current prices.
              </p>
            )}
            {page.count === 0 && (
              <p>
                No matching upcoming public lines. Your account may offer
                different selections.
              </p>
            )}
            <div className="accountQuoteList">
              {page.lines.map((quote) => (
                <article key={quote.lineId}>
                  <h3>
                    {quote.player} ·{' '}
                    {MARKET_LABELS[marketKey(quote.market) ?? ''] ??
                      quote.marketLabel}{' '}
                    {quote.line}
                  </h3>
                  <p>
                    {quote.event} ·{' '}
                    {quote.commenceTime
                      ? time(quote.commenceTime)
                      : 'Start unknown'}
                  </p>
                  <p>
                    Period: {quote.period} · {quote.lineType} · Account
                    availability unverified
                  </p>
                  <small>
                    Source line last changed:{' '}
                    {quote.lineUpdatedAt
                      ? time(quote.lineUpdatedAt)
                      : 'unknown'}
                    . This is not a verified price timestamp.
                  </small>
                  {(['Higher', 'Lower'] as const).map((side) => {
                    const offered =
                      side === 'Higher' ? quote.higher : quote.lower;
                    return (
                      offered && (
                        <div className="accountQuoteSide" key={side}>
                          <strong>
                            {side} ·{' '}
                            {offered.decimalPrice?.toFixed(2) ??
                              'No decimal price'}
                          </strong>
                          {draft.legs.map((_, slot) => (
                            <button
                              key={slot}
                              disabled={!marketKey(quote.market)}
                              type="button"
                              onClick={() => useReference(quote, side, slot)}
                            >
                              Reference for selection {slot + 1}
                            </button>
                          ))}
                        </div>
                      )
                    );
                  })}
                </article>
              ))}
            </div>
            {page.nextOffset !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => search(true)}
              >
                Next public page
              </button>
            )}
            {page.offset > 0 && (
              <button type="button" disabled={busy} onClick={() => search()}>
                Back to first page
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
