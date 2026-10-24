import { getFreeUnderdogLines } from './freeUnderdog';

const players = [
  'Jaxon Smith-Njigba','George Holani','Bo Nix','AJ Barner','Courtland Sutton',
  'RJ Harvey','Emanuel Wilson','Sam Darnold','Jaylen Waddle','Evan Engram',
  'J.K. Dobbins','Rashid Shaheed','Cooper Kupp'
];
const nameKey=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]/g,'');
const KEYED=new Map(players.map(p=>[nameKey(p),p]));
export async function thursdayUnderdogDeepDive() {
  const board=await getFreeUnderdogLines({sport:'americanfootball_nfl',limit:1000});
  const kickoff=Date.parse('2026-10-16T00:15:00Z');
  const gameLines=board.lines.filter(line=>{
    const eventDate=line.commenceTime?Date.parse(line.commenceTime):NaN;
    const normalized=line.event.toLowerCase();
    const teamMatch=(normalized.includes('seattle')||normalized.includes('seahawks'))&&
      (normalized.includes('denver')||normalized.includes('broncos'));
    return !line.isLive &&
      line.status.toLowerCase()!=='closed' &&
      (teamMatch || Number.isFinite(eventDate)&&Math.abs(eventDate-kickoff)<1200000);
  });
  const selected=gameLines.filter(line=>KEYED.has(nameKey(line.player)))
    .map(line=>({
      player:KEYED.get(nameKey(line.player)),
      event:line.event,commenceTime:line.commenceTime,market:line.market,
      marketLabel:line.marketLabel,line:line.line,
      lineType:line.lineType,status:line.status,lineId:line.lineId,
      observedAt:line.observedAt,lineUpdatedAt:line.lineUpdatedAt,
      higher:line.higher,lower:line.lower,
      eventIdentityVerified:/seattle|seahawks/i.test(line.event)&&/denver|broncos/i.test(line.event)
    }))
    .sort((a,b)=>a.player!.localeCompare(b.player!)||a.market.localeCompare(b.market)||a.line-b.line);
  const byPlayer=players.map(player=>{
    const lines=selected.filter(line=>line.player===player);
    return {player,offerCount:lines.length,lines};
  });
  const allGamePlayers=[...new Set(gameLines.map(l=>l.player))].sort();
  const specific=[
    {player:'Jaxon Smith-Njigba',markets:['receiving_rec'],threshold:6.5},
    {player:'George Holani',markets:['receiving_rec'],threshold:1.5},
    {player:'Bo Nix',markets:['passing_ints'],threshold:0.5}
  ].map(target=>{
    const p=byPlayer.find(x=>x.player===target.player)!;
    const matches=p.lines.filter(l=>target.markets.includes(l.market)&&l.line===target.threshold&&l.lineType.toLowerCase().includes('standard') || target.markets.includes(l.market)&&l.line===target.threshold);
    return {...target,exactMatches:matches,verifiedInRetrievedSnapshot:matches.length>0,
      note:matches.length?'Direct Underdog public pregame listing, not a confirmed personal Pickem slip.':'Not found in current returned public game board; this does not rule out other account-specific offers.'};
  });
  return {
    source:board.source,sourceUrl:board.sourceUrl,retrievedAt:board.retrievedAt,
    event:'Seattle Seahawks at Denver Broncos',kickoffUTC:'2026-10-16T00:15:00Z',
    sportLinesReturned:board.count,gameLinesCount:gameLines.length,
    allGamePlayers,requestedMarkets:specific,
    byPlayer,
    dataPolicy:'Source price fields are raw public Underdog option data. Do not treat individual decimal_price or payout_multiplier as a verified same-game parlay payout. Identity not verified without teams in event title.',
    modelStatus:'NO_VALIDATED_NFL_JOINT_MODEL',recommendation:'HOLD',qualifiedPositiveEv:false
  };
}