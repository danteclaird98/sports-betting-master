import OddsBackend from './OddsBackend';
import { useEffect, useState } from 'react';
import AccountSlipWorkspace from './AccountSlipWorkspace';
import DailyDashboard from './DailyDashboard';
import ReceiverMatchupLab from './ReceiverMatchupLab';
import EdgeScanner from './EdgeScanner';
import WagerTracker from './WagerTracker';
import ResearchSetup from './ResearchSetup';
import AssistantReport from './AssistantReport';
import ResearchPipeline from './ResearchPipeline';
import AllSportsReport from './AllSportsReport';
import TnfUnderdogDeepDive from './TnfUnderdogDeepDive';
import IntegrationDiagnostics from './IntegrationDiagnostics';
import HistoricalCalibration from './HistoricalCalibration';
import NflPropLab from './NflPropLab';
import BlockerAudit from './BlockerAudit';
import PlayerBacktest from './PlayerBacktest';
import CorrectedReceivingLab from './CorrectedReceivingLab';
import ReceivingForecast from './ReceivingForecast';
import ReceivingValidation from './ReceivingValidation';
import LineAwarePropLab from './LineAwarePropLab';
import HistoricalPropPriceAudit from './HistoricalPropPriceAudit';
import HistoricalNflOddsV4Panel from './HistoricalNflOddsV4Panel';
import NhlShotsBacktest from './NhlShotsBacktest';
import NhlLeagueBacktest from './NhlLeagueBacktest';
import NhlOddsAudit from './NhlOddsAudit';
import CaesarsEvidence from './CaesarsEvidence';
import ParlayAudit from './ParlayAudit';
import LiveResearchPage from './LiveResearchPage';

type Workspace = 'today' | 'account' | 'live' | 'wagers' | 'model' | 'advanced';
type AdvancedSection = 'markets' | 'models' | 'integrations';
type WorkspaceRoute = { workspace: Workspace; advanced: AdvancedSection };

function readRoute(): WorkspaceRoute {
  const [workspace, section] = window.location.hash.slice(1).split('/');
  if (workspace === 'models') return { workspace: 'advanced', advanced: 'models' };
  const advanced = section === 'models' || section === 'integrations' ? section : 'markets';
  if (workspace === 'account' || workspace === 'live' || workspace === 'wagers' || workspace === 'model' || workspace === 'advanced') {
    return { workspace, advanced };
  }
  return { workspace: 'today', advanced: 'markets' };
}

function App() {
  const [route, setRoute] = useState<WorkspaceRoute>(readRoute);
  const { workspace, advanced } = route;
  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [receiverPick, setReceiverPick] = useState<{
    player: string;
    event: string;
    market: string;
    line: number | null;
    startTime: string;
  } | null>(null);
  function openReceiver(pick: {
    player: string;
    event: string;
    market: string;
    line: number | null;
    startTime: string;
  }) {
    setReceiverPick(pick);
    open('advanced', 'markets');
  }

  function open(workspaceToOpen: Workspace, section: AdvancedSection = advanced) {
    setRoute({ workspace: workspaceToOpen, advanced: section });
    window.location.hash = workspaceToOpen === 'advanced' ? `advanced/${section}` : workspaceToOpen;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  return (
    <>
      <header className="simpleNav">
        <a href="/">Sports Betting Master</a>
        <div className="simpleBrand">
          <strong>
            EdgeBoard <span>Research</span>
          </strong>
          <small>Evidence, model audits and disciplined research</small>
        </div>
        <nav aria-label="Main workspace" className="simpleNavButtons">
          <button
            type="button"
            className={workspace === 'today' ? 'selected' : ''}
            aria-current={workspace === 'today' ? 'page' : undefined}
            onClick={() => open('today')}
          >
            Today's Board
          </button>
          <button
            type="button"
            className={workspace === 'model' ? 'selected' : ''}
            aria-current={workspace === 'model' ? 'page' : undefined}
            onClick={() => open('model')}
          >
            Independent model
          </button>
          <button
            type="button"
            className={workspace === 'account' ? 'selected' : ''}
            aria-current={workspace === 'account' ? 'page' : undefined}
            onClick={() => open('account')}
          >
            Check my slip
          </button>
          <button
            type="button"
            className={workspace === 'live' ? 'selected' : ''}
            aria-current={workspace === 'live' ? 'page' : undefined}
            onClick={() => open('live')}
          >
            Live & 2H
          </button>
          <button
            type="button"
            className={workspace === 'wagers' ? 'selected' : ''}
            aria-current={workspace === 'wagers' ? 'page' : undefined}
            onClick={() => open('wagers')}
          >
            My Wagers
          </button>
          <button
            type="button"
            className={workspace === 'advanced' ? 'selected' : ''}
            aria-current={workspace === 'advanced' ? 'page' : undefined}
            onClick={() => open('advanced')}
          >
            Advanced Research
          </button>
        </nav>
      </header>
      <main>
        <aside className="releaseWorkspaceNotice" aria-label="Workspace setup">
          Research tools share this Sports Betting Master host. Provider connections require setup; the two tracking views retain separate records.
        </aside>
        {workspace === 'today' && (
          <DailyDashboard
            onAdvanced={() => open('advanced')}
            onLive={() => open('live')}
            onModel={() => open('model')}
            onResearchReceiver={openReceiver}
          />
        )}
        {workspace === 'account' && <AccountSlipWorkspace />}
        {workspace === 'live' && <LiveResearchPage />}
        {workspace === 'model' && (
          <div className="advancedShell independentModelWorkspace">
            <div className="advancedIntro">
              <span className="simpleEyebrow">INDEPENDENT OF MARKET ODDS</span>
              <h1>Independent probability model</h1>
              <p>Choose a real player and next fixture to calculate a conditional receiving forecast, inspect the frozen model and review separate 2026 evidence. Prospective validation and market checks remain required for betting approval.</p>
            </div>
            <ReceivingForecast />
            <ReceivingValidation />
            <CorrectedReceivingLab />
          </div>
        )}
        {workspace === 'wagers' && (
          <div className="advancedShell">
            <div className="advancedIntro">
              <h1>My Wagers</h1>
              <p>
                Record confirmed bets and settlements. This is a tracking tool,
                not a betting executor.
              </p>
            </div>
            <WagerTracker />
          </div>
        )}
        {workspace === 'advanced' && (
          <div className="advancedShell">
            <div className="advancedIntro">
              <span className="simpleEyebrow">
                ALL ORIGINAL RESEARCH TOOLS PRESERVED
              </span>
              <h1>Advanced Research</h1>
              <p>
                Detailed sportsbook quotes, statistical models, historical
                tests, source health and parlay analysis. These tools remain
                available but no longer clutter the daily betting board.
              </p>
            </div>
            <nav
              className="advancedTabs"
              aria-label="Advanced research sections"
            >
              <button
                type="button"
                className={advanced === 'markets' ? 'selected' : ''}
                onClick={() => open('advanced', 'markets')}
              >
                Markets & props
              </button>
              <button
                type="button"
                className={advanced === 'models' ? 'selected' : ''}
                onClick={() => open('advanced', 'models')}
              >
                Models & history
              </button>
              <button
                type="button"
                className={advanced === 'integrations' ? 'selected' : ''}
                onClick={() => open('advanced', 'integrations')}
              >
                Bookmakers & diagnostics
              </button>
            </nav>
            {advanced === 'markets' && (
              <div className="advancedModules">
                <ReceiverMatchupLab initialChoice={receiverPick} />
                <AllSportsReport />
                <ResearchPipeline />
                <AssistantReport />
                <EdgeScanner />
                <details className="advancedArchive">
                  <summary>Archived targeted game research</summary>
                  <TnfUnderdogDeepDive />
                </details>
              </div>
            )}
            {advanced === 'models' && (
              <div className="advancedModules">
                <HistoricalCalibration />
                <NflPropLab />
                <ReceivingForecast />
                <ReceivingValidation />
                <CorrectedReceivingLab />
                <PlayerBacktest />
                <LineAwarePropLab />
                <HistoricalPropPriceAudit />
                <HistoricalNflOddsV4Panel />
                <NhlShotsBacktest />
                <NhlLeagueBacktest />
                <NhlOddsAudit />
                <BlockerAudit />
              </div>
            )}
            {advanced === 'integrations' && (
              <div className="advancedModules">
                <OddsBackend />
                <IntegrationDiagnostics />
                <ResearchSetup />
                <CaesarsEvidence />
                <ParlayAudit />
              </div>
            )}
          </div>
        )}
      </main>
      <footer className="simpleFooter">
        EdgeBoard is research-only. Account prices, model performance and
        settlement rules must be verified. No automatic wagers.
      </footer>
    </>
  );
}
export default App;
