import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import type { PropObservation } from '../shared/propEvidence';
import type { auditPropEvidence } from '../backend/verifyProp';
import './PropVerification.css';

type Evidence = ReturnType<typeof auditPropEvidence>;
export default function PropVerification({
  observation,
}: {
  observation: PropObservation;
}) {
  const [result, setResult] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const verify = useCallback(async () => {
    const token = ++request.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await api.post('/api/verify-prop', observation);
      if (token === request.current) setResult(response.data as Evidence);
    } catch (failure) {
      if (token === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Evidence check unavailable. HOLD; no selection approved.',
        );
    } finally {
      if (token === request.current) setBusy(false);
    }
  }, [observation]);
  useEffect(() => {
    void verify();
    return () => {
      request.current += 1;
    };
  }, [verify]);
  return (
    <section
      className="propVerification"
      aria-label={`Verification for ${observation.player}`}
    >
      <button
        type="button"
        className="simpleSecondary"
        disabled={busy}
        onClick={verify}
      >
        {busy
          ? 'Checking public evidence…'
          : result
            ? 'Refresh evidence · $0'
            : 'Verify evidence · $0'}
      </button>
      {busy && (
        <p role="status">
          Refreshing the exact public prop and independent game/roster sources.
          No paid provider requests.
        </p>
      )}
      {error && (
        <p role="alert">
          {error} Retry with Verify evidence. This quote remains unverified.
        </p>
      )}
      {result && (
        <>
          <p role="status">
            <strong>
              {result.confirmedChecks} of {result.totalChecks} checks confirmed
              · HOLD · stake $0
            </strong>
          </p>
          <p>
            Checked {new Date(result.checkedAt).toLocaleString()}. Confirmed
            public facts do not establish a profitable bet.
          </p>
          <details>
            <summary>
              View verification evidence and missing requirements
            </summary>
            <ul>
              {result.checks.map((check) => (
                <li key={check.key}>
                  <strong>
                    {check.label} · {check.state.toLowerCase()}
                  </strong>
                  <p>{check.detail}</p>
                  {check.observedAt && (
                    <small>
                      Observed {new Date(check.observedAt).toLocaleString()}{' '}
                      ·{' '}
                    </small>
                  )}
                  {check.sourceUrl && (
                    <a href={check.sourceUrl} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {!!result.nearbyPublicThresholds.length && (
              <p>
                Current public thresholds:{' '}
                {result.nearbyPublicThresholds.join(', ')}. Original observation
                retained for comparison.
              </p>
            )}
            <p>
              No independent win probability or EV has been verified.{' '}
              {result.notAShortlist}
            </p>
          </details>
        </>
      )}
    </section>
  );
}
