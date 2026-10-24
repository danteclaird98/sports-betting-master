import { useCallback, useEffect, useState } from 'react';
import { api } from '@appdeploy/client';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';

type Provider = {
  provider: string;
  configured: boolean;
  cost: string;
  historical: boolean;
  pregame: boolean;
  live: boolean;
  role: string;
};

type MarketFamily = {
  family: string;
  status: string;
  note: string;
};

type CoveragePayload = {
  generatedAt: string;
  standards: Record<string, boolean>;
  sports: Array<{ sport: string; key: string; coverage: string }>;
  providers: Provider[];
  marketFamilies: MarketFamily[];
  blockers: string[];
};

type ResearchPolicy = {
  maxQuoteAgeSeconds: number;
  edgeBuffer: number;
  purpose: string;
  calibrationStatus: string;
  historicalValidation: Record<string, string>;
  implemented: string[];
};

type FreeHealth = {
  source: string;
  cost: string;
  coverage: string;
  observedAt: string;
  sport: string;
  lines: number;
  historicalLedger: string;
};

function DataHealthPanel({ sport }: { sport: string }) {
  const [coverage, setCoverage] = useState<CoveragePayload | null>(null);
  const [policy, setPolicy] = useState<ResearchPolicy | null>(null);
  const [freeHealth, setFreeHealth] = useState<FreeHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    try {
      const [coverageResponse, policyResponse, healthResponse] = await Promise.all([
        api.get('/api/coverage'),
        api.get('/api/research-policy'),
        api.get(`/api/free-source-health?sport=${encodeURIComponent(sport)}`),
      ]);
      setCoverage((coverageResponse.data as { coverage: CoveragePayload }).coverage);
      setPolicy((policyResponse.data as { policy: ResearchPolicy }).policy);
      setFreeHealth(healthResponse.data as FreeHealth);
    } catch (loadError) {
      setErrorText(loadError instanceof Error ? loadError.message : 'Data health could not be refreshed.');
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel lab">
      <div className="sectionHead">
        <div>
          <h2><Activity size={20} /> Coverage & data health</h2>
          <p>Operational claims are separated from partial, source-dependent and unavailable coverage.</p>
        </div>
        <button className="miniButton" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {errorText && <div className="errorBox">{errorText}</div>}

      {freeHealth && (
        <div className="signalNotice">
          <div>
            <strong>{freeHealth.source} · {freeHealth.cost}</strong>
            <span>{freeHealth.coverage}</span>
          </div>
          <div className="signalGrid">
            <span>{freeHealth.lines} current lines for selected sport</span>
            <span>observed {new Date(freeHealth.observedAt).toLocaleTimeString()}</span>
          </div>
          <small>{freeHealth.historicalLedger}</small>
        </div>
      )}

      {coverage && (
        <>
          <div className="healthGrid">
            {coverage.providers.map(provider => (
              <div className="providerCard" key={provider.provider}>
                <div className="providerTop">
                  <strong>{provider.provider}</strong>
                  <span className={provider.configured ? 'sourceStatus active' : 'sourceStatus unconfigured'}>
                    {provider.configured ? 'configured' : 'optional'}
                  </span>
                </div>
                <small>{provider.role}</small>
                <div className="providerMeta">
                  {provider.cost} · pregame {provider.pregame ? 'yes' : 'no'} · live {provider.live ? 'yes' : 'no'} · historical {provider.historical ? 'yes' : 'no'}
                </div>
              </div>
            ))}
          </div>

          <div className="kalshiRefs">
            <h3>Market coverage</h3>
            <p>Markets are only marked implemented when an adapter preserves exact selection, line, period and settlement identity.</p>
            {coverage.marketFamilies.map(item => (
              <div className="kalshiRow" key={item.family}>
                <span><strong>{item.family}</strong> · {item.note}</span>
                <strong>{item.status}</strong>
              </div>
            ))}
          </div>

          <div className="kalshiRefs">
            <h3>Current blockers</h3>
            <p>These prevent EdgeBoard from claiming profitability or full-market coverage.</p>
            {coverage.blockers.map(blocker => (
              <div className="kalshiRow" key={blocker}>
                <span>{blocker}</span>
                <strong>OPEN</strong>
              </div>
            ))}
          </div>
        </>
      )}

      {policy && (
        <div className="kalshiRefs">
          <h3><ShieldCheck size={17} /> Research validation</h3>
          <p>{policy.purpose}</p>
          <div className="coverageGrid">
            <div><span>Freshness gate</span><strong>{policy.maxQuoteAgeSeconds}s</strong></div>
            <div><span>Lower-bound EV buffer</span><strong>{(policy.edgeBuffer * 100).toFixed(1)}%</strong></div>
            <div><span>Calibration</span><strong>{policy.historicalValidation.calibration}</strong></div>
            <div><span>Brier</span><strong>{policy.historicalValidation.brier}</strong></div>
            <div><span>CLV</span><strong>{policy.historicalValidation.clv}</strong></div>
            <div><span>Returns</span><strong>{policy.historicalValidation.returns}</strong></div>
          </div>
          <small className="mutedText">{policy.calibrationStatus}</small>
        </div>
      )}
    </section>
  );
}

export default DataHealthPanel;
