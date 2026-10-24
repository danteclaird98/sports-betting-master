import { useState } from 'react';
import { api } from '@appdeploy/client';
type Side={choice:'Higher'|'Lower';americanPrice:number|null;decimalPrice:number|null;payoutMultiplier:number|null;fantasyProbability:number|null};
type GameLine={player?:string;event:string;commenceTime:string|null;market:string;marketLabel:string;line:number;
  lineType:string;status:string;lineId:string;observedAt:string;lineUpdatedAt:string|null;
  higher:Side|null;lower:Side|null;eventIdentityVerified:boolean};
type Result={source:string;retrievedAt:string;event:string;sportLinesReturned:number;gameLinesCount:number;
  allGamePlayers:string[];requestedMarkets:Array<{player:string;markets:string[];threshold:number;exactMatches:GameLine[];verifiedInRetrievedSnapshot:boolean;note:string}>;
  byPlayer:Array<{player:string;offerCount:number;lines:GameLine[]}>;dataPolicy:string;recommendation:string;qualifiedPositiveEv:boolean};
const marketName=(key:string)=>({receiving_rec:'Receptions',receiving_yds:'Receiving yards',receiving_long:'Longest reception',
  passing_ints:'Passing interceptions',passing_yds:'Passing yards',rushing_yds:'Rushing yards',rushing_att:'Rush attempts'} as Record<string,string>)[key]??key;
const side=(s:Side|null)=>s?s.choice+': decimal '+(s.decimalPrice??'not supplied')+' / American '+(s.americanPrice??'not supplied')+' / pick multiplier '+(s.payoutMultiplier??'not supplied'):'Not offered in source';
export default function TnfUnderdogDeepDive(){
  const [result,setResult]=useState<Result|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function scan(){setBusy(true);setError('');setResult(null);
    try{const r=await api.get('/api/tnf-underdog-lines');setResult(r.data as Result);}
    catch(e){setError(e instanceof Error?e.message:'Underdog source unavailable');}
    finally{setBusy(false);}}
  return <section className='panel lab' id='tnf-full-underdog-audit'>
    <h2>Oct 15 TNF · full Underdog line check</h2>
    <p>Seattle at Denver · exact-player/market search across all available NFL feed rows, not 25 sampled props. Price fields are raw publicly quoted options and are not guaranteed executable in your account.</p>
    <button className='scanButton' type='button' disabled={busy} onClick={scan}>{busy?'Loading full NFL source…':'Check all Seahawks–Broncos Underdog props'}</button>
    {error&&<p role='alert'>Source unavailable: {error}. No recommendation.</p>}
    {result&&<div>
      <p role='status'>Source retrieved: {result.retrievedAt}. {result.sportLinesReturned} available NFL lines, {result.gameLinesCount} assigned to the game; {result.allGamePlayers.length} names.</p>
      <h3>Three requested props — exact threshold check</h3>
      {result.requestedMarkets.map(m=><div key={m.player}>
        <p><strong>{m.player}: {marketName(m.markets[0])} {m.threshold}</strong> — {m.verifiedInRetrievedSnapshot?'FOUND in current feed':'NOT FOUND in this feed snapshot'}</p>
        {m.exactMatches.map(l=><p key={l.lineId}>{l.event} · {l.status} · {l.lineType} · Higher: {side(l.higher)} · Lower: {side(l.lower)} · updated {l.lineUpdatedAt??'not supplied'}</p>)}
        {!m.exactMatches.length&&<p>{m.note}</p>}
      </div>)}
      <h3>All detected market alternatives for these players</h3>
      {result.byPlayer.map(p=><details key={p.player} open={['Jaxon Smith-Njigba','George Holani','Bo Nix'].includes(p.player)}>
        <summary>{p.player} — {p.offerCount} market entries</summary>
        {p.lines.length?<table><thead><tr><th>Market</th><th>Line</th><th>Higher option</th><th>Lower option</th></tr></thead>
          <tbody>{p.lines.map(l=><tr key={l.lineId}><td>{marketName(l.market)} · {l.lineType}</td><td>{l.line}</td>
            <td>{side(l.higher)}</td><td>{side(l.lower)}</td></tr>)}</tbody></table>
          :<p>No matching offer in this feed snapshot. This is not an account-level unavailable determination.</p>}
      </details>)}
      <p><strong>Recommendation: HOLD.</strong> {result.dataPolicy}</p>
    </div>}
  </section>;
}