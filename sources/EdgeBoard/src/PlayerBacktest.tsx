import { useState } from 'react';
import { api } from '@appdeploy/client';
type Result = Record<string, unknown>;
export default function PlayerBacktest() {
  const [market, setMarket] = useState('receiving_yards');
  const [report, setReport] = useState<Result | null>(null);
  const [health, setHealth] = useState<Result | null>(null);
  const [fixture, setFixture] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function run(kind: 'health' | 'test' | 'fixture') {
    setError('');
    setLoading(true);
    try {
      const path =
        kind === 'health'
          ? '/api/nfl-player-source-health'
          : kind === 'fixture'
            ? '/api/nfl-prop-calibration-selftest'
            : '/api/nfl-prop-backtest?market=' + encodeURIComponent(market);
      const response = await api.get(path);
      if (kind === 'health') setHealth(response.data as Result);
      else if (kind === 'fixture') setFixture(response.data as Result);
      else setReport(response.data as Result);
    } catch (e) {
      const problem = e as {
        message?: string;
        response?: { data?: { error?: string; message?: string } };
      };
      setError(
        problem.response?.data?.error ??
          problem.response?.data?.message ??
          problem.message ??
          'nflverse public release fetch or evaluation unavailable',
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="panel lab" id="nfl-prop-backtest">
      <h2>Public nflverse NFL player-prop backtest</h2>
      <p>
        Reads nflverse 2021–2025 weekly player CSV releases. A fixed-threshold
        logistic model uses only prior player games. Training: 2021–2023; early
        2024 model selection; late 2024 probability calibration; reused 2025
        retrospective diagnostic. Valid negative-yard games remain in the cohort.
        Results are research only, not market-beating or current-game
        probabilities.
      </p>
      <button
        className="scanButton"
        type="button"
        disabled={loading}
        onClick={() => run('health')}
      >
        Check nflverse public data download
      </button>
      <button type="button" disabled={loading} onClick={() => run('fixture')}>
        Run deterministic calibration integrity test (free)
      </button>
      {fixture && (
        <p>
          Calibration software fixture:{' '}
          <strong>{String(fixture.status)}</strong>. Synthetic test only; not a
          live-model approval.
        </p>
      )}
      <label>
        Prop market{' '}
        <select
          aria-label="Backtest prop market"
          value={market}
          onChange={(e) => {
            setMarket(e.target.value);
            setReport(null);
          }}
        >
          <option value="receiving_yards">Receiving 60+ yards</option>
          <option value="rushing_yards">Rushing 50+ yards</option>
          <option value="passing_yards">Passing 200+ yards</option>
          <option value="receptions">Receptions 4+</option>
        </select>
      </label>
      <button
        className="scanButton"
        type="button"
        disabled={loading}
        onClick={() => run('test')}
      >
        {loading ? 'Evaluating…' : 'Run historical diagnostic'}
      </button>
      {error && (
        <p role="alert">
          Import or backtest failed: {error}. Live approval stays disabled.
        </p>
      )}
      {health && (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {JSON.stringify(health, null, 2)}
        </pre>
      )}
      {report && (
        <div>
          <p>
            <strong>Status: {String(report.status)} — HOLD</strong>
          </p>
          <p>
            Training through 2023; early 2024 selects model; late 2024 fits
            calibration; 2025 is a consumed diagnostic and is not a new untouched holdout. No contemporaneous
            sportsbook comparison or live approval.
          </p>
          {Boolean(report.calibration) && (
            <p>
              <strong>Historical calibration diagnostic available.</strong>{' '}
              Review Brier, log loss, reliability bins and the uncalibrated
              comparison in the report below. Improvement is not presumed.
            </p>
          )}
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: 410,
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(report, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
