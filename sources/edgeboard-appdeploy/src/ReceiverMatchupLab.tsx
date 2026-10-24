import { useEffect, useState } from 'react';
import { api } from '@appdeploy/client';
import { ShieldCheck, RefreshCw, ExternalLink } from 'lucide-react';

type Choice = { player:string; event:string; market:string; line:number|null; startTime:string };
type News = { source:string;coverage:string;retrievedAt:string;headlines:Array<{
  headline:string;description:string;publishedAt:string|null;url:string|null;
  fullArticleRead:boolean;coachQuoteVerified:boolean;cornerAssignmentVerified:boolean;
}>;note:string };
type InjuryContext={source:string;retrievedAt:string;sourceFresh:boolean;receiverReports:Array<{player:string;position:string;status:string;reportAt:string;note:string;recencyVerified:boolean}>;defensiveBackReports:Array<{player:string;position:string;status:string;reportAt:string;note:string;recencyVerified:boolean}>;opponentTeamMatched:boolean;note:string};
type AuditReport = {status:string;checklist:Record<string,boolean>;blockers:string[];
  winningProbability:null;estimatedEV:null; suggestedStake:number};
const coverageChecklist=[
  'Confirm actual cornerback assignment: shadow, fixed side, slot, or zone handoff.',
  'Check man/zone frequency, safety help, coverage responsibility and route-type matchups.',
  'Review recent targets per route, alignment, routes run, aDOT and quarterback pass volume.',
  'Check official practices/injuries for receiver, cornerbacks, safeties and QB.',
  'Read dated coach press conferences for intended usage and offensive/defensive game plans.',
  'Review independent matchup analysis and competing projections; separate opinions from data.',
  'Confirm specific over line, fresh Caesars price, settlement rules and validated model interval.',
];
const receiverMarket=(market:string)=>/^(receptions?|receiving[_ -]?yards?|rec[_ -]?yards?)$/i.test(market.trim());
export default function ReceiverMatchupLab({initialChoice}:{initialChoice:Choice|null}) {
  const [receiver,setReceiver]=useState('');
  const [opponent,setOpponent]=useState('');
  const [news,setNews]=useState<News|null>(null);
  const [injury,setInjury]=useState<InjuryContext|null>(null);
  const [audit,setAudit]=useState<AuditReport|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [corner,setCorner]=useState('');
  const [assignment,setAssignment]=useState('unknown');
  const [coverage,setCoverage]=useState('unknown');
  useEffect(()=>{
    if(initialChoice) {
      setReceiver(initialChoice.player);
      setOpponent('');
      setCorner('');
      setAssignment('unknown');
      setCoverage('unknown');
      setNews(null);
      setInjury(null);
      setAudit(null);
    }
  },[initialChoice]);
  async function check() {
    if(!receiver.trim()) { setError('Enter a receiver name first.'); return; }
    setLoading(true);setError('');setNews(null);setInjury(null);setAudit(null);
    const market=initialChoice && receiverMarket(initialChoice.market)
      ? /recept/i.test(initialChoice.market)?'receptions':'receiving_yards'
      : 'receptions';
    const kickoff=initialChoice?.startTime&&Number.isFinite(Date.parse(initialChoice.startTime))
      ? initialChoice.startTime : new Date(Date.now()+86400000).toISOString();
    try {
      const [newsResult,injuryResult,auditResult]=await Promise.allSettled([
        api.get('/api/nfl-receiver-news?receiver='+encodeURIComponent(receiver.trim())+'&opponent='+encodeURIComponent(opponent.trim())),
        api.get('/api/nfl-receiver-injuries?receiver='+encodeURIComponent(receiver.trim())+'&opponent='+encodeURIComponent(opponent.trim())),
        api.post('/api/nfl-receiver-matchup-audit',{
          receiver:receiver.trim(),opponent:opponent.trim(),event:initialChoice?.event??'Unmatched game',
          kickoff,market,line:initialChoice?.line??0,likelyCorner:corner,
          assignment,coverageScheme:coverage, routesVerified:false,targetVolumeVerified:false,
          injuriesVerified:false,evidence:[]
        }),
      ]);
      if(newsResult.status==='fulfilled') setNews(newsResult.value.data as News);
      else setError('NFL news feed unavailable; no coaching statements or reports have been verified.');
      if(injuryResult.status==='fulfilled') setInjury(injuryResult.value.data as InjuryContext);
      else setError('ESPN injuries unavailable; do not assume players are healthy.');
      if(auditResult.status==='fulfilled') setAudit(auditResult.value.data as AuditReport);
      else setError('Matchup evidence audit unavailable. HOLD.');
    } finally {setLoading(false);}
  }
  const search=(q:string)=>'https://www.google.com/search?q='+encodeURIComponent(q);
  return (
    <section className='panel lab receiverLab' aria-label='Receiver cornerback and coaching intelligence'>
      <div className='sectionHead'><div>
        <h2>Receiver vs. cornerback research</h2>
        <p>Use this before evaluating an NFL over on receptions or receiving yards. Individual corners matter, but coverage rotations, zone assignments and route usage matter too.</p>
      </div></div>
      {initialChoice && <p className='hint'>Selected prop: {initialChoice.player} · {initialChoice.market.replaceAll('_',' ')} {initialChoice.line??'line pending'} · {initialChoice.event}</p>}
      <div className='receiverControls'>
        <label>Receiver <input value={receiver} onChange={e=>setReceiver(e.target.value)} placeholder='Full name' /></label>
        <label>Opponent team (optional) <input value={opponent} onChange={e=>setOpponent(e.target.value)} placeholder='e.g. Denver Broncos' /></label>
        <label>Possible corner (unverified) <input value={corner} onChange={e=>setCorner(e.target.value)} placeholder='Do not assume shadow coverage' /></label>
        <label>Defender assignment
          <select value={assignment} onChange={e=>setAssignment(e.target.value)}>
            <option value='unknown'>Unknown</option><option value='shadow'>Shadow (needs evidence)</option>
            <option value='side'>Fixed side</option><option value='slot'>Slot</option><option value='zone'>Zone responsibility</option>
          </select>
        </label>
        <label>Defensive coverage <select value={coverage} onChange={e=>setCoverage(e.target.value)}>
          <option value='unknown'>Unknown</option><option value='man'>Mostly man</option>
          <option value='zone'>Mostly zone</option><option value='mixed'>Mixed</option>
        </select></label>
      </div>
      <button className='simplePrimary' type='button' onClick={check} disabled={loading}>
        <RefreshCw size={16} className={loading?'spin':''}/>{loading?'Checking news…':'Review available matchup information'}
      </button>
      {error && <p role='alert' className='errorBox'>{error}</p>}
      {audit && <div className='receiverAudit'>
        <h3><ShieldCheck size={19}/> {audit.status} — more evidence required</h3>
        <p>A cornerback name alone cannot verify a matchup. Research status: <strong>no defensible win probability or EV</strong>, suggested stake $0.</p>
        <h4>Evidence still needed</h4>
        <ul>{audit.blockers.map((reason,i)=><li key={i}>{reason}</li>)}</ul>
      </div>}
      {injury && <div className='receiverNews'>
        <h3>Current ESPN injury observations</h3>
        <p>Source: {injury.source}. Retrieved {injury.retrievedAt}. {injury.sourceFresh?'Recent feed timestamp.':'Feed freshness not confirmed.'} These notes are not official NFL injury designations or confirmed cornerback assignments.</p>
        <h4>Receiver</h4>
        {injury.receiverReports.length===0?<p>No listing found; that does not establish full health or game availability.</p>:injury.receiverReports.map((r,i)=><p key={i}><strong>{r.player} · {r.status}</strong> ({r.position}), dated {r.reportAt}. {r.note} {r.recencyVerified?'':'Older observation.'}</p>)}
        <h4>Opponent defensive backs</h4>
        {!injury.opponentTeamMatched&&<p>Enter the opponent's exact team name to inspect its defensive-back injury notes. No cornerback matchups inferred.</p>}
        {injury.defensiveBackReports.map((r,i)=><p key={i}><strong>{r.player} · {r.status}</strong> ({r.position}), dated {r.reportAt}. {r.note} {r.recencyVerified?'':'Older observation.'}</p>)}
        <a href='https://www.nfl.com/injuries/' target='_blank' rel='noreferrer'>Cross-check official NFL injury reports</a>
      </div>}
      {news && <div className='receiverNews'>
        <h3>Recent leaguewide report leads ({news.headlines.length})</h3>
        <p><strong>Partial coverage only.</strong> The public ESPN feed provides headlines and brief descriptions, not a comprehensive review of team press conferences or paywalled analyst coverage. These items are not verified quotes or cornerback assignments.</p>
        {news.headlines.length===0 && <p>No matching recent headlines in this limited feed. This does not mean no relevant reports exist.</p>}
        {news.headlines.map((item,i)=><article className='receiverNewsItem' key={i}>
          <strong>{item.headline}</strong>
          <small>{item.publishedAt??'Publication time unknown'} · headline/summary only</small>
          <p>{item.description}</p>
          {item.url && <a href={item.url} target='_blank' rel='noreferrer'>Read original article <ExternalLink size={13}/></a>}
        </article>)}
      </div>}
      {receiver.trim()&&<div className='receiverLinks'>
        <h3>Original reporting to check</h3>
        <p>These are search shortcuts, not sources automatically read or verified.</p>
        <a href={search(receiver+' '+opponent+' cornerback coverage shadow matchup NFL Next Gen Stats')} target='_blank' rel='noreferrer'>Cornerback assignments and coverage data <ExternalLink size={13}/></a>
        <a href={search(receiver+' '+opponent+' NFL head coach offensive coordinator press conference practice statement')} target='_blank' rel='noreferrer'>Team coach and coordinator statements <ExternalLink size={13}/></a>
        <a href={search(receiver+' '+opponent+' nfl analyst route targets matchup preview')} target='_blank' rel='noreferrer'>Independent analyst reports <ExternalLink size={13}/></a>
        <a href='https://www.nfl.com/injuries/' target='_blank' rel='noreferrer'>NFL official injury reports <ExternalLink size={13}/></a>
      </div>}
      <details className='receiverDetails'><summary>Full receiver-over research checklist</summary>
        <ul>{coverageChecklist.map(item=><li key={item}>{item}</li>)}</ul>
        <p>Source notes alone cannot produce calibrated probabilities. We need a validated distribution and a matching executable quote before any BET decision.</p>
      </details>
    </section>
  );
}
