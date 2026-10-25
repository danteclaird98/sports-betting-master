import { useEffect, useMemo, useRef, useState } from 'react';
import { api, auth } from '../../../runtime/client.ts';
import { ClipboardList, ShieldCheck } from 'lucide-react';
import {
  LEDGER_PROTOCOL, createPendingLedgerWrite, forgetPendingLedgerWrite,
  ledgerRevision, ledgerSaveResponse, pendingLedgerWrites, persistPendingLedgerWrite,
  type PendingLedgerWrite,
} from '../shared/ledgerClientState';

type WagerStatus =
  | 'open'
  | 'win'
  | 'loss'
  | 'push'
  | 'void'
  | 'cashout'
  | 'partial';
type WagerMode = 'actual' | 'paper';
type BetType = 'single' | 'parlay';

type AuditItem = {
  at: string;
  action: string;
  detail: string;
};

type Wager = {
  id: string;
  mode: WagerMode;
  betType: BetType;
  sport: string;
  league: string;
  event: string;
  sportsbook: string;
  market: string;
  selection: string;
  line: string;
  decimalOdds: number;
  stake: number;
  currency: string;
  placedAt: string;
  externalId: string;
  researchId: string;
  modelVersion: string;
  legsText: string;
  notes: string;
  status: WagerStatus;
  payout: number;
  fees: number;
  settlementConfirmed: boolean;
  history: AuditItem[];
};

type Limits = {
  dailyStake: number;
  openExposure: number;
};

const WAGER_KEY = 'edgeboard:wagers:v1';
const LIMIT_KEY = 'edgeboard:risk-limits:v1';

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored<T>(key: string, value: T) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
}

function netProfit(wager: Wager) {
  if (!wager.settlementConfirmed || wager.status === 'open') return null;
  if (wager.status === 'loss') return -wager.stake - wager.fees;
  if (wager.status === 'push' || wager.status === 'void') return -wager.fees;
  return wager.payout - wager.stake - wager.fees;
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wager-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyWagerForm() {
  return {
    mode: 'actual' as WagerMode,
    betType: 'single' as BetType,
    sport: 'MLB',
    league: 'MLB',
    event: '',
    sportsbook: 'Underdog',
    market: '',
    selection: '',
    line: '',
    decimalOdds: '2.00',
    stake: '10',
    currency: 'USD',
    placedAt: new Date().toISOString().slice(0, 16),
    externalId: '',
    researchId: '',
    modelVersion: '',
    legsText: '',
    notes: '',
  };
}

function WagerTracker() {
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncMessage, setSyncMessage] = useState(
    'Sign in to load your private cross-device wager ledger.'
  );
  const ownerRef = useRef<string | null>(null);
  const protocolRef = useRef<typeof LEDGER_PROTOCOL | null>(null);
  const revisionRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const loadGeneration = useRef(0);
  const [pending, setPending] = useState<PendingLedgerWrite | null>(null);
  const legacyWagers = readStored<Wager[]>(WAGER_KEY, []);

  function clearOwnerState(signedIn: boolean, message: string, invalidateLoads = true) {
    if (invalidateLoads) loadGeneration.current++;
    ownerRef.current = null;
    protocolRef.current = null;
    revisionRef.current = null;
    setLoaded(false);
    setSignedIn(signedIn);
    setWagers([]);
    setPending(null);
    setForm(emptyWagerForm());
    setErrorText('');
    setSyncMessage(message);
  }

  function restorePendingDraft(write: PendingLedgerWrite) {
    if (!write.draft) return;
    const draft = write.draft;
    setForm(current => ['event', 'market', 'selection', 'line', 'externalId', 'researchId', 'modelVersion', 'legsText', 'notes']
      .every(key => current[key as keyof typeof current] === '') &&
      Object.keys(current).every(key => typeof draft[key] === 'string') &&
      ['actual', 'paper'].includes(draft.mode) && ['single', 'parlay'].includes(draft.betType)
      ? { ...current, ...draft } as typeof current : current);
  }

  function clearConfirmedDraft(write: PendingLedgerWrite) {
    if (!write.draft) return;
    const draft = write.draft;
    setForm(current => Object.keys(current).every(key => current[key as keyof typeof current] === draft[key])
      ? { ...current, event: '', market: '', selection: '', line: '', externalId: '',
          researchId: '', modelVersion: '', legsText: '', notes: '' } : current);
  }

  async function loadRemote(confirmed?: PendingLedgerWrite): Promise<boolean> {
    const generation = ++loadGeneration.current;
    setLoaded(false);
    try {
      const user = await auth.getUser();
      if (generation !== loadGeneration.current) return false;
      if (!user?.userId) {
        clearOwnerState(false, 'Sign in to load your private ledger.', false);
        return false;
      }
      const owner = user.userId;
      if (confirmed && confirmed.owner !== owner) {
        clearOwnerState(true, 'Account changed. Reload your private ledger before continuing.', false);
        return false;
      }
      if (ownerRef.current !== null && ownerRef.current !== owner) {
        clearOwnerState(true, 'Account changed. Loading your private ledger.', false);
      }
      ownerRef.current = owner;
      setSignedIn(true);
      const { data } = await api.get('/api/wager-ledger');
      const currentUser = await auth.getUser();
      if (generation !== loadGeneration.current) return false;
      if (ownerRef.current !== owner || currentUser?.userId !== owner) {
        clearOwnerState(Boolean(currentUser), 'Account changed. Reload your private ledger before continuing.');
        return false;
      }
      const payload = data as { wagers?: Wager[]; owner?: unknown; protocol?: unknown; revision?: unknown };
      if (!payload || !Array.isArray(payload.wagers)) throw Error('Ledger response could not be verified.');
      if ((payload.protocol === LEDGER_PROTOCOL || payload.owner !== undefined) && payload.owner !== owner) {
        clearOwnerState(true, 'The ledger owner could not be verified. Reload your private ledger before continuing.');
        return false;
      }
      if (payload.protocol === LEDGER_PROTOCOL && !ledgerRevision(payload.revision)) {
        throw Error('Ledger revision could not be verified.');
      }
      if (payload.protocol !== undefined && payload.protocol !== LEDGER_PROTOCOL) {
        throw Error('Ledger protocol is unavailable.');
      }
      if (confirmed && payload.protocol === LEDGER_PROTOCOL &&
          (payload.revision as number) < confirmed.expectedRevision + 1) {
        throw Error('The current ledger does not include the confirmed revision.');
      }
      protocolRef.current = payload.protocol === LEDGER_PROTOCOL ? LEDGER_PROTOCOL : null;
      revisionRef.current = protocolRef.current ? payload.revision as number : null;
      setWagers(payload.wagers);
      let writes = pendingLedgerWrites(owner);
      if (confirmed && confirmed.owner === owner && protocolRef.current === LEDGER_PROTOCOL) {
        forgetPendingLedgerWrite(confirmed);
        clearConfirmedDraft(confirmed);
        writes = pendingLedgerWrites(owner);
      }
      const unresolved = writes[0] ?? null;
      setPending(unresolved);
      if (unresolved) {
        if (!confirmed) restorePendingDraft(unresolved);
        setSyncMessage(protocolRef.current === LEDGER_PROTOCOL
          ? 'An earlier ledger save needs reconciliation. Your draft is retained; edits stay disabled.'
          : 'An earlier ledger save is unresolved and the recovery protocol is unavailable. Edits stay disabled.');
        return false;
      }
      setLoaded(true);
      setSyncMessage('Private ledger loaded. Changes save to your account.');
      return true;
    } catch {
      setSyncMessage('Cannot load or verify the private ledger. Edits are disabled until the connection works.');
      return false;
    }
  }
  useEffect(() => {
    if (!auth.isSignedIn()) return;
    auth
      .getUser()
      .then(user => {
        if (user) {
          setSignedIn(true);
          void loadRemote();
        }
      })
      .catch(() => setSyncMessage('Could not verify sign-in.'));
  }, []);
  async function signInLedger() {
    try {
      const result = await auth.signIn();
      if (result.user) {
        setSignedIn(true);
        await loadRemote();
      }
    } catch {
      setSyncMessage('Sign-in did not complete.');
    }
  }
  async function importLegacy() {
    if (!loaded || !legacyWagers.length) return;
    if (
      !window.confirm(
        'Import this browser’s prior wagers into your account? Existing matching IDs will not be duplicated.'
      )
    )
      return;
    const ids = new Set(wagers.map(w => w.id));
    await updateWagers([
      ...wagers,
      ...legacyWagers.filter(w => !ids.has(w.id)),
    ]);
  }
  const [limits, setLimits] = useState<Limits>(() =>
    readStored<Limits>(LIMIT_KEY, { dailyStake: 10, openExposure: 10 })
  );
  const [errorText, setErrorText] = useState('');
  const [form, setForm] = useState(emptyWagerForm);

  const actualOpen = wagers.filter(
    wager => wager.mode === 'actual' && wager.status === 'open'
  );
  const openByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const wager of actualOpen)
      totals.set(
        wager.currency,
        (totals.get(wager.currency) ?? 0) + wager.stake
      );
    return [...totals.entries()];
  }, [actualOpen]);

  const confirmedActual = wagers.filter(
    wager =>
      wager.mode === 'actual' &&
      wager.status !== 'open' &&
      wager.settlementConfirmed
  );

  const performanceByCurrency = useMemo(() => {
    const totals = new Map<
      string,
      {
        stake: number;
        profit: number;
        wins: number;
        losses: number;
        pushes: number;
        voids: number;
      }
    >();
    for (const wager of confirmedActual) {
      const current = totals.get(wager.currency) ?? {
        stake: 0,
        profit: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        voids: 0,
      };
      current.stake += wager.stake;
      current.profit += netProfit(wager) ?? 0;
      if (wager.status === 'win') current.wins += 1;
      if (wager.status === 'loss') current.losses += 1;
      if (wager.status === 'push') current.pushes += 1;
      if (wager.status === 'void') current.voids += 1;
      totals.set(wager.currency, current);
    }
    return [...totals.entries()];
  }, [confirmedActual]);

  const maxDrawdownByCurrency = useMemo(() => {
    const result = new Map<string, number>();
    const currencies = new Set(confirmedActual.map(wager => wager.currency));
    for (const currency of currencies) {
      const rows = confirmedActual
        .filter(wager => wager.currency === currency)
        .sort((a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt));
      let cumulative = 0;
      let peak = 0;
      let maxDrawdown = 0;
      for (const wager of rows) {
        cumulative += netProfit(wager) ?? 0;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
      }
      result.set(currency, maxDrawdown);
    }
    return result;
  }, [confirmedActual]);

  async function confirmPending(write: PendingLedgerWrite, data: unknown): Promise<boolean> {
    const currentUser = await auth.getUser();
    if (ownerRef.current !== write.owner || currentUser?.userId !== write.owner) {
      clearOwnerState(Boolean(currentUser), 'Account changed. Reload your private ledger before continuing.');
      return false;
    }
    const status = ledgerSaveResponse(data, write);
    if (status === 'saved') {
      // A receipt is historical: always reload the current head before another edit.
      const ready = await loadRemote(write);
      if (ready) setSyncMessage('Saved to your private account. Current ledger reloaded.');
      return ready;
    }
    if (status === 'conflict' || status === 'migration_required') {
      forgetPendingLedgerWrite(write);
      setPending(pendingLedgerWrites(write.owner)[0] ?? null);
      setLoaded(false);
      setSyncMessage(status === 'conflict'
        ? 'Another edit changed the ledger. The conflicting save was not applied. Your manual-entry draft is retained. Reload and review the saved ledger; re-enter any settlement changes.'
        : 'Ledger migration is required. Your draft is retained and edits stay disabled.');
      return false;
    }
    setLoaded(false);
    setPending(write);
    setSyncMessage('Save is still unconfirmed. Reconcile pending save before editing; no save will be retried.');
    return false;
  }

  async function reconcilePending() {
    if (!pending || savingRef.current || protocolRef.current !== LEDGER_PROTOCOL) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const user = await auth.getUser();
      if (user?.userId !== pending.owner) {
        clearOwnerState(Boolean(user), 'Account changed. Reload your private ledger before continuing.');
        return;
      }
      const { data } = await api.post('/api/wager-ledger', {
        action: 'reconcile', owner: pending.owner, requestId: pending.requestId,
        expectedRevision: pending.expectedRevision, wagers: pending.wagers,
      });
      await confirmPending(pending, data);
    } catch {
      setLoaded(false);
      setSyncMessage('Reconciliation could not be confirmed. The pending request is retained; no save was retried.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function updateWagers(next: Wager[]): Promise<boolean> {
    if (!signedIn || !loaded || savingRef.current) {
      setSyncMessage('Sign in and wait for syncing before editing.');
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    let write: PendingLedgerWrite | null = null;
    let retained = false;
    let attempted = false;
    try {
      const owner = ownerRef.current;
      const user = await auth.getUser();
      if (!owner || user?.userId !== owner) {
        clearOwnerState(Boolean(user), 'Account changed. Reload your private ledger before continuing.');
        return false;
      }
      if (protocolRef.current === LEDGER_PROTOCOL) {
        if (!ledgerRevision(revisionRef.current)) throw Error('Authenticated ledger revision is unavailable.');
        const unresolved = pendingLedgerWrites(owner)[0];
        if (unresolved) {
          setPending(unresolved);
          throw Error('An earlier ledger save must be reconciled first.');
        }
        write = createPendingLedgerWrite(owner, newId(), revisionRef.current, next, form);
        // If durable retention fails, do not issue a save with an unrecoverable ID.
        persistPendingLedgerWrite(write);
        retained = true;
        setPending(write);
        attempted = true;
        const { data } = await api.post('/api/wager-ledger', {
          action: 'save', owner: write.owner, requestId: write.requestId,
          expectedRevision: write.expectedRevision, wagers: write.wagers,
        });
        return await confirmPending(write, data);
      }
      attempted = true;
      const response = await api.post('/api/wager-ledger', { owner, wagers: next });
      if (response.data?.count !== next.length) throw Error('Unconfirmed legacy ledger acknowledgement');
      const currentUser = await auth.getUser();
      if (ownerRef.current !== owner || currentUser?.userId !== owner) {
        clearOwnerState(Boolean(currentUser), 'Account changed. Reload your private ledger before continuing.');
        return false;
      }
      setWagers(next);
      setSyncMessage('Saved to your private account.');
      return true;
    } catch {
      setLoaded(false);
      setSyncMessage(!attempted
        ? 'The ledger could not be prepared for saving. No save was attempted; pending recovery could not be retained or verified. Reload saved ledger.'
        : write && retained
        ? 'Save could not be confirmed. Your draft and request are retained. Reconcile pending save before editing.'
        : 'Save could not be confirmed. Your draft is retained. Reload saved ledger before editing or retrying.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function updateLimits(next: Limits) {
    setLimits(next);
    writeStored(LIMIT_KEY, next);
  }

  async function addWager() {
    setErrorText('');
    const decimalOdds = Number(form.decimalOdds);
    const stake = Number(form.stake);
    if (
      !form.event.trim() ||
      !form.sportsbook.trim() ||
      !form.market.trim() ||
      !form.selection.trim()
    ) {
      setErrorText('Event, sportsbook, market and selection are required.');
      return;
    }
    if (
      !Number.isFinite(decimalOdds) ||
      decimalOdds <= 1 ||
      !Number.isFinite(stake) ||
      stake <= 0
    ) {
      setErrorText('Enter decimal odds above 1.00 and a positive stake.');
      return;
    }
    const externalId = form.externalId.trim();
    if (
      externalId &&
      wagers.some(
        wager =>
          wager.sportsbook.toLowerCase() ===
            form.sportsbook.trim().toLowerCase() &&
          wager.externalId.toLowerCase() === externalId.toLowerCase()
      )
    ) {
      setErrorText('Duplicate sportsbook/external identifier blocked.');
      return;
    }

    const placed = new Date(form.placedAt);
    if (!Number.isFinite(placed.getTime())) {
      setErrorText('Enter a valid placement date and time.');
      return;
    }
    const placedAt = placed.toISOString();
    if (form.mode === 'actual') {
      const sameCurrencyOpen = actualOpen
        .filter(wager => wager.currency === form.currency)
        .reduce((sum, wager) => sum + wager.stake, 0);
      const daily = wagers
        .filter(
          wager =>
            wager.mode === 'actual' &&
            wager.currency === form.currency &&
            localDateKey(wager.placedAt) === localDateKey(placedAt)
        )
        .reduce((sum, wager) => sum + wager.stake, 0);
      if (daily + stake > limits.dailyStake) {
        setErrorText(
          `Daily stake limit would be exceeded: ${(daily + stake).toFixed(2)} > ${limits.dailyStake.toFixed(2)} ${form.currency}.`
        );
        return;
      }
      if (sameCurrencyOpen + stake > limits.openExposure) {
        setErrorText(
          `Open exposure limit would be exceeded: ${(sameCurrencyOpen + stake).toFixed(2)} > ${limits.openExposure.toFixed(2)} ${form.currency}.`
        );
        return;
      }
    }

    const created: Wager = {
      id: newId(),
      mode: form.mode,
      betType: form.betType,
      sport: form.sport.trim(),
      league: form.league.trim(),
      event: form.event.trim(),
      sportsbook: form.sportsbook.trim(),
      market: form.market.trim(),
      selection: form.selection.trim(),
      line: form.line.trim(),
      decimalOdds,
      stake,
      currency: form.currency.trim().toUpperCase(),
      placedAt,
      externalId,
      researchId: form.researchId.trim(),
      modelVersion: form.modelVersion.trim(),
      legsText: form.betType === 'parlay' ? form.legsText.trim() : '',
      notes: form.notes.trim(),
      status: 'open',
      payout: 0,
      fees: 0,
      settlementConfirmed: false,
      history: [
        {
          at: new Date().toISOString(),
          action: 'created',
          detail: `${form.mode} ${form.betType} entered manually`,
        },
      ],
    };
    if (!(await updateWagers([created, ...wagers]))) return;
    setForm(current => current !== form ? current : ({
      ...current,
      event: '',
      market: '',
      selection: '',
      line: '',
      externalId: '',
      researchId: '',
      modelVersion: '',
      legsText: '',
      notes: '',
    }));
  }

  function reviseWager(
    id: string,
    patch: Partial<
      Pick<Wager, 'status' | 'payout' | 'fees' | 'settlementConfirmed'>
    >
  ) {
    updateWagers(
      wagers.map(wager => {
        if (wager.id !== id) return wager;
        const updates = Object.entries(patch)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(', ');
        return {
          ...wager,
          ...patch,
          history: [
            ...wager.history,
            {
              at: new Date().toISOString(),
              action: 'settlement revision',
              detail: updates,
            },
          ],
        };
      })
    );
  }

  return (
    <section className="panel lab">
      <div className="sectionHead">
        <div>
          <h2>
            <ClipboardList size={20} /> Research wager ledger
          </h2>
          <p>
            Manual tracking only. Research candidates, paper wagers and actual
            wagers remain separate; no sportsbook execution occurs here.
          </p>
        </div>
      </div>

      <div className="signalNotice">
        <div>
          <strong>
            <ShieldCheck size={16} /> Accounting definition
          </strong>
          <span>
            Payout is the total amount returned by the sportsbook, including
            returned stake. Net P/L = payout − stake − fees. Pushes/voids assume
            stake is returned and therefore record only fees.
          </span>
        </div>
        <small>
          Deposits, withdrawals and bonuses are intentionally excluded from
          wagering P/L. Currencies are never converted or combined. Drawdown uses wager placement order, not settlement chronology; it is not account drawdown.
        </small>
      </div>

      <div className="signalNotice">
        <div><strong>Research records only</strong><span>Exposure, performance and limits here cover this research ledger only. The workspace wager ledger has separate records and totals; they are not combined or reconciled with a sportsbook account.</span><a href="/">Return to EdgeBoard, then choose Wagers for the separate workspace ledger →</a></div>
      </div>
      <div className="signalNotice">
        <div>
          <strong>Private wager ledger</strong>
          <span role="status">{syncMessage}</span>
        </div>
        {!signedIn && (
          <button type="button" onClick={signInLedger}>
            Sign in to track wagers
          </button>
        )}
        {signedIn && (
          <button
            type="button"
            onClick={() => void loadRemote()}
            disabled={saving}
          >
            Reload saved ledger
          </button>
        )}
        {pending && protocolRef.current === LEDGER_PROTOCOL && (
          <button type="button" onClick={() => void reconcilePending()} disabled={saving}>
            Reconcile pending save
          </button>
        )}
        {loaded && legacyWagers.length > 0 && (
          <button
            type="button"
            onClick={() => void importLegacy()}
            disabled={saving}
          >
            Import old browser wagers ({legacyWagers.length})
          </button>
        )}
      </div>
      <div className="controlGrid">
        <label className="field">
          Daily actual-wager limit
          <input
            type="number"
            min="0"
            step="1"
            value={limits.dailyStake}
            onChange={event =>
              updateLimits({
                ...limits,
                dailyStake: Math.max(0, Number(event.target.value) || 0),
              })
            }
          />
        </label>
        <label className="field">
          Open exposure limit
          <input
            type="number"
            min="0"
            step="1"
            value={limits.openExposure}
            onChange={event =>
              updateLimits({
                ...limits,
                openExposure: Math.max(0, Number(event.target.value) || 0),
              })
            }
          />
        </label>
      </div>

      <div className="trackerStats">
        {openByCurrency.length ? (
          openByCurrency.map(([currency, exposure]) => (
            <div className="calcOutput" key={currency}>
              <span>Open exposure · {currency}</span>
              <strong>{exposure.toFixed(2)}</strong>
            </div>
          ))
        ) : (
          <div className="calcOutput">
            <span>Open exposure</span>
            <strong>0</strong>
          </div>
        )}
        {performanceByCurrency.map(([currency, summary]) => (
          <div className="calcOutput" key={`perf-${currency}`}>
            <span>Settled actual · {currency}</span>
            <strong className={summary.profit >= 0 ? 'positive' : ''}>
              {summary.profit >= 0 ? '+' : ''}
              {summary.profit.toFixed(2)}
            </strong>
            <small>
              ROI{' '}
              {summary.stake
                ? ((summary.profit / summary.stake) * 100).toFixed(1)
                : '0.0'}
              % · {summary.wins}-{summary.losses}-{summary.pushes} · placed-order drawdown{' '}
              {(maxDrawdownByCurrency.get(currency) ?? 0).toFixed(2)}
            </small>
          </div>
        ))}
      </div>

      <div className="entryTabs">
        <button
          className={form.mode === 'actual' ? 'active' : ''}
          type="button"
          onClick={() => setForm(current => ({ ...current, mode: 'actual' }))}
        >
          Actual wager
        </button>
        <button
          className={form.mode === 'paper' ? 'active' : ''}
          type="button"
          onClick={() => setForm(current => ({ ...current, mode: 'paper' }))}
        >
          Paper wager
        </button>
      </div>

      <div className="trackerForm">
        <label className="field">
          Sport
          <input
            value={form.sport}
            onChange={event =>
              setForm(current => ({ ...current, sport: event.target.value }))
            }
          />
        </label>
        <label className="field">
          League
          <input
            value={form.league}
            onChange={event =>
              setForm(current => ({ ...current, league: event.target.value }))
            }
          />
        </label>
        <label className="field wideField">
          Event
          <input
            value={form.event}
            onChange={event =>
              setForm(current => ({ ...current, event: event.target.value }))
            }
            placeholder="Away @ Home"
          />
        </label>
        <label className="field">
          Sportsbook
          <input
            value={form.sportsbook}
            onChange={event =>
              setForm(current => ({
                ...current,
                sportsbook: event.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          Bet type
          <select
            value={form.betType}
            onChange={event =>
              setForm(current => ({
                ...current,
                betType: event.target.value as BetType,
              }))
            }
          >
            <option value="single">Single</option>
            <option value="parlay">Parlay</option>
          </select>
        </label>
        <label className="field">
          Market
          <input
            value={form.market}
            onChange={event =>
              setForm(current => ({ ...current, market: event.target.value }))
            }
            placeholder="Strikeouts / spread / total"
          />
        </label>
        <label className="field">
          Selection
          <input
            value={form.selection}
            onChange={event =>
              setForm(current => ({
                ...current,
                selection: event.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          Line
          <input
            value={form.line}
            onChange={event =>
              setForm(current => ({ ...current, line: event.target.value }))
            }
            placeholder="7.5 / -3.5"
          />
        </label>
        <label className="field">
          Decimal odds
          <input
            inputMode="decimal"
            value={form.decimalOdds}
            onChange={event =>
              setForm(current => ({
                ...current,
                decimalOdds: event.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          Stake
          <input
            inputMode="decimal"
            value={form.stake}
            onChange={event =>
              setForm(current => ({ ...current, stake: event.target.value }))
            }
          />
        </label>
        <label className="field">
          Currency
          <input
            value={form.currency}
            onChange={event =>
              setForm(current => ({ ...current, currency: event.target.value }))
            }
          />
        </label>
        <label className="field">
          Placed at
          <input
            type="datetime-local"
            value={form.placedAt}
            onChange={event =>
              setForm(current => ({ ...current, placedAt: event.target.value }))
            }
          />
        </label>
        <label className="field">
          External ID
          <input
            value={form.externalId}
            onChange={event =>
              setForm(current => ({
                ...current,
                externalId: event.target.value,
              }))
            }
            placeholder="optional dedupe key"
          />
        </label>
        <label className="field">
          Research ID
          <input
            value={form.researchId}
            onChange={event =>
              setForm(current => ({
                ...current,
                researchId: event.target.value,
              }))
            }
          />
        </label>
        <label className="field">
          Model version
          <input
            value={form.modelVersion}
            onChange={event =>
              setForm(current => ({
                ...current,
                modelVersion: event.target.value,
              }))
            }
          />
        </label>
        {form.betType === 'parlay' && (
          <label className="field wideField">
            Legs
            <textarea
              value={form.legsText}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  legsText: event.target.value,
                }))
              }
              placeholder="One leg per line"
            />
          </label>
        )}
        <label className="field wideField">
          Notes
          <textarea
            value={form.notes}
            onChange={event =>
              setForm(current => ({ ...current, notes: event.target.value }))
            }
          />
        </label>
      </div>
      <button
        className="scanButton"
        type="button"
        onClick={addWager}
        disabled={!loaded || saving}
      >
        Save manual {form.mode} wager
      </button>
      {errorText && <div className="errorBox">{errorText}</div>}

      <div className="wagerList">
        {wagers.length === 0 ? (
          <div className="empty">
            <strong>No tracked wagers yet.</strong>
            <span>
              Research results above are not silently converted into wagers.
            </span>
          </div>
        ) : (
          wagers.map(wager => {
            const profit = netProfit(wager);
            return (
              <article className="wagerRow" key={wager.id}>
                <div className="wagerHeader">
                  <div>
                    <strong>{wager.event}</strong>
                    <small>
                      {wager.mode.toUpperCase()} · {wager.sportsbook} ·{' '}
                      {wager.betType} ·{' '}
                      {new Date(wager.placedAt).toLocaleString()}
                    </small>
                  </div>
                  <span
                    className={
                      wager.mode === 'actual'
                        ? 'sourceStatus active'
                        : 'sourceStatus partial'
                    }
                  >
                    {wager.mode}
                  </span>
                </div>
                <div className="wagerMeta">
                  <span>
                    {wager.market} · {wager.selection} {wager.line}
                  </span>
                  <span>
                    {wager.stake.toFixed(2)} {wager.currency} @{' '}
                    {wager.decimalOdds.toFixed(2)}
                  </span>
                  <span>
                    {wager.externalId
                      ? `ID ${wager.externalId}`
                      : 'no external ID'}
                  </span>
                </div>
                {wager.legsText && (
                  <div className="refs">Legs: {wager.legsText}</div>
                )}
                <div className="settlementGrid">
                  <label className="field">
                    Status
                    <select
                      value={wager.status}
                      disabled={!loaded || saving}
                      onChange={event =>
                        reviseWager(wager.id, {
                          status: event.target.value as WagerStatus,
                          settlementConfirmed: false,
                        })
                      }
                    >
                      {(
                        [
                          'open',
                          'win',
                          'loss',
                          'push',
                          'void',
                          'cashout',
                          'partial',
                        ] as WagerStatus[]
                      ).map(status => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Total payout
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={wager.payout}
                      disabled={!loaded || saving}
                      onChange={event =>
                        reviseWager(wager.id, {
                          payout: Math.max(0, Number(event.target.value) || 0),
                          settlementConfirmed: false,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Fees
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={wager.fees}
                      disabled={!loaded || saving}
                      onChange={event =>
                        reviseWager(wager.id, {
                          fees: Math.max(0, Number(event.target.value) || 0),
                          settlementConfirmed: false,
                        })
                      }
                    />
                  </label>
                  <label className="checkField">
                    <input
                      type="checkbox"
                      checked={wager.settlementConfirmed}
                      disabled={!loaded || saving || wager.status === 'open'}
                      onChange={event =>
                        reviseWager(wager.id, {
                          settlementConfirmed: event.target.checked,
                        })
                      }
                    />{' '}
                    Confirm settlement
                  </label>
                </div>
                <div className="wagerFooter">
                  <span>
                    {profit === null
                      ? 'Open / provisional P&L'
                      : `Confirmed P&L ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${wager.currency}`}
                  </span>
                  <small>audit trail: {wager.history.length} entries</small>
                </div>
              </article>
            );
          })
        )}
      </div>
      <small className="mutedText">
        Signed-in wager records save to an account-private ledger. Older browser
        records can be imported explicitly. No wagers are placed or reconciled
        automatically.
      </small>
    </section>
  );
}

export default WagerTracker;
