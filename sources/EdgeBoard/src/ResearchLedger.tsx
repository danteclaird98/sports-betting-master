import { useCallback, useEffect, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import { Archive, LogIn, LogOut, RefreshCw } from 'lucide-react';

type LedgerSelection = {
  id: string;
  event: string;
  sport: string;
  market: string;
  selection: string;
  line: number | null;
  sportsbook: string;
  decimalOdds: number;
  oddsAt: string;
  decisionAt: string;
  featureAvailableAt: string;
  modelTrainedThrough: string;
  modelVersion: string;
  probability: number;
  probabilityLow: number;
  probabilityHigh: number;
  researchStatus: 'ABSTAIN' | 'PASSES_RESEARCH';
  reasonsToAbstain: string[];
  supportingEvidence: string[];
  sources: Array<{ source: string; observedAt: string; detail?: string }>;
};

type LedgerRow = LedgerSelection & {
  id: string;
  sourceDecisionId: string;
  outcome: 'win' | 'loss' | 'push' | 'void' | null;
  settledAt: string | null;
  createdAt: string;
  correctionHistory: Array<{ at: string; action: string; detail: string }>;
};

type Diagnostics = {
  label: string;
  settledBinaryCount: number;
  metrics: null | {
    n: number;
    brier: number;
    logLoss: number;
    ece: number;
  };
  warning: string;
};

function ResearchLedger({ selected }: { selected: LedgerSelection | null }) {
  const [user, setUser] = useState<{ userId: string; email?: string; name?: string } | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!auth.isSignedIn()) return;
    setLoading(true);
    try {
      const { data } = await api.get('/api/research-ledger');
      const payload = data as { items: LedgerRow[]; diagnostics: Diagnostics };
      setRows(payload.items ?? []);
      setDiagnostics(payload.diagnostics ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Research ledger could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auth.isSignedIn()) return;
    auth.getUser().then(current => {
      if (current) {
        setUser(current);
        void refresh();
      }
    }).catch(() => setUser(null));
  }, [refresh]);

  async function signIn() {
    setMessage('');
    try {
      const result = await auth.signIn();
      setUser(result.user);
      await refresh();
    } catch (error) {
      const authError = error as Error & { code?: string };
      setMessage(authError.code === 'popup_closed'
        ? 'Sign-in was cancelled.'
        : authError.code === 'popup_blocked'
          ? 'Sign-in popup was blocked. Allow popups and try again.'
          : 'Sign-in failed.');
    }
  }

  async function signOut() {
    await auth.signOut();
    setUser(null);
    setRows([]);
    setDiagnostics(null);
    setMessage('');
  }

  async function archiveSelected() {
    if (!selected) return;
    if (!user) {
      setMessage('Sign in before archiving a research snapshot.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const { data } = await api.post('/api/research-ledger', { action: 'archive', ...selected, sourceDecisionId: selected.id });
      const result = data as { duplicate?: boolean };
      setMessage(result.duplicate ? 'That exact decision snapshot was already archived.' : 'Research snapshot archived.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not archive research snapshot.');
    } finally {
      setLoading(false);
    }
  }

  async function settle(id: string, outcome: 'win' | 'loss' | 'push' | 'void') {
    setLoading(true);
    setMessage('');
    try {
      await api.post('/api/research-ledger', {
        action: 'settle',
        id,
        outcome,
        settledAt: new Date().toISOString(),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not record outcome.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel lab">
      <div className="sectionHead">
        <div>
          <h2><Archive size={20} /> Protected research ledger</h2>
          <p>Archive point-in-time predictions before outcomes are known. Personal ledger data is protected by sign-in and scoped to your user ID.</p>
        </div>
        {user ? (
          <button className="miniButton" type="button" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button>
        ) : (
          <button className="miniButton" type="button" onClick={() => void signIn()}><LogIn size={15} /> Sign in</button>
        )}
      </div>

      {!user ? (
        <div className="hint">Public market research remains available without an account. Sign-in is required only for the private prediction ledger.</div>
      ) : (
        <>
          <div className="signalNotice">
            <div>
              <strong>{user.name || user.email || 'Signed in'}</strong>
              <span>Private archive · latest 100–200 records per request · no sportsbook execution.</span>
            </div>
            <button className="miniButton" type="button" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh ledger
            </button>
          </div>

          <button className="scanButton" type="button" disabled={!selected || loading} onClick={() => void archiveSelected()}>
            <Archive size={17} /> {selected ? 'Archive selected market snapshot' : 'Select one prop research row to archive'}
          </button>

          {diagnostics && (
            <div className="coverageGrid">
              <div><span>Archived rows</span><strong>{rows.length}</strong></div>
              <div><span>Settled binary</span><strong>{diagnostics.settledBinaryCount}</strong></div>
              <div><span>Brier</span><strong>{diagnostics.metrics ? diagnostics.metrics.brier.toFixed(4) : '—'}</strong></div>
              <div><span>Log loss</span><strong>{diagnostics.metrics ? diagnostics.metrics.logLoss.toFixed(4) : '—'}</strong></div>
              <div><span>ECE</span><strong>{diagnostics.metrics ? diagnostics.metrics.ece.toFixed(4) : '—'}</strong></div>
              <div><span>Validation</span><strong>OBSERVATIONAL</strong></div>
            </div>
          )}
          {diagnostics && <div className="hint">{diagnostics.warning}</div>}

          <div className="wagerList">
            {rows.slice(0, 20).map(row => (
              <article className="wagerRow" key={row.id}>
                <div className="wagerHeader">
                  <div>
                    <strong>{row.event}</strong>
                    <small>{row.market} · {row.selection}{row.line === null ? '' : ` ${row.line}`} · model {row.modelVersion}</small>
                  </div>
                  <span className={row.researchStatus === 'PASSES_RESEARCH' ? 'sourceStatus active' : 'sourceStatus partial'}>{row.researchStatus}</span>
                </div>
                <div className="wagerMeta">
                  <span>p={(row.probability * 100).toFixed(1)}% · {(row.probabilityLow * 100).toFixed(1)}–{(row.probabilityHigh * 100).toFixed(1)}%</span>
                  <span>{row.sportsbook || 'source'} · {row.decimalOdds.toFixed(2)}x</span>
                  <span>decision {new Date(row.decisionAt).toLocaleString()}</span>
                </div>
                <div className="tagRow">
                  {(['win', 'loss', 'push', 'void'] as const).map(outcome => (
                    <button key={outcome} type="button" className={row.outcome === outcome ? 'chip active' : 'chip'} onClick={() => void settle(row.id, outcome)}>
                      {outcome}
                    </button>
                  ))}
                </div>
                <div className="refs">
                  {row.outcome ? `Outcome ${row.outcome} · settled ${row.settledAt ? new Date(row.settledAt).toLocaleString() : 'time unavailable'}` : 'Outcome pending'} · audit entries {row.correctionHistory?.length ?? 0}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {message && <div className="hint">{message}</div>}
    </section>
  );
}

export default ResearchLedger;
