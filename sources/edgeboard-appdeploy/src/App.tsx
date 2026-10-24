import { useState } from 'react';
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
import LineAwarePropLab from './LineAwarePropLab';
import HistoricalPropPriceAudit from './HistoricalPropPriceAudit';
import HistoricalNflOddsV4Panel from './HistoricalNflOddsV4Panel';
import NhlShotsBacktest from './NhlShotsBacktest';
import NhlLeagueBacktest from './NhlLeagueBacktest';
import NhlOddsAudit from './NhlOddsAudit';
import CaesarsEvidence from './CaesarsEvidence';
import ParlayAudit from './ParlayAudit';
import LiveResearchPage from './LiveResearchPage';

type Workspace = 'today' | 'account' | 'live' | 'wagers' | 'advanced';
type AdvancedSection = 'markets' | 'models' | 'integrations';

function App() {
  const [workspace, setWorkspace] = useState<Workspace>('today');
  const [advanced, setAdvanced] = useState<AdvancedSection>('markets');
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
    setAdvanced('markets');
    open('advanced');
  }

  function open(workspaceToOpen: Workspace) {
    setWorkspace(workspaceToOpen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  return (
    <>
      <header className="simpleNav">
        <div className="simpleBrand">
          <strong>
            EdgeBoard <span>SportsAI888</span>
          </strong>
          <small>Verified research, disciplined betting</small>
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
        {workspace === 'today' && (
          <DailyDashboard
            onAdvanced={() => open('advanced')}
            onLive={() => open('live')}
            onResearchReceiver={openReceiver}
          />
        )}
        {workspace === 'account' && <AccountSlipWorkspace />}
        {workspace === 'live' && <LiveResearchPage />}
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
                onClick={() => setAdvanced('markets')}
              >
                Markets & props
              </button>
              <button
                type="button"
                className={advanced === 'models' ? 'selected' : ''}
                onClick={() => setAdvanced('models')}
              >
                Models & history
              </button>
              <button
                type="button"
                className={advanced === 'integrations' ? 'selected' : ''}
                onClick={() => setAdvanced('integrations')}
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
