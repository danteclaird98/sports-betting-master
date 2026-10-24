type R=Record<string,unknown>;
const rec=(x:unknown):R=>x&&typeof x==='object'&&!Array.isArray(x)?x as R:{};
const str=(x:unknown):string=>typeof x==='string'?x:'';
const list=(x:unknown):R[]=>Array.isArray(x)?x.map(rec):[];
const norm=(x:string)=>x.toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
export async function getNflInjuries(receiver:string,opponent:string) {
  if(!/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(receiver.trim())||opponent.length>90||
    /[^a-zA-Z .'-]/.test(opponent))throw Error('Valid receiver and opponent names required.');
  const url='https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';
  const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('ESPN NFL injuries returned '+response.status);
  const data=await response.json() as R;
  if(!Array.isArray(data.injuries))throw Error('Unexpected ESPN injury feed structure.');
  const retrievedAt=new Date().toISOString();
  const now=Date.now();
  const sourceAt=Date.parse(str(data.timestamp));
  const teams=list(data.injuries);
  function players(team:R) {
    return list(team.injuries).map(row=>{
      const athlete=rec(row.athlete),position=rec(athlete.position);
      const date=str(row.date),time=Date.parse(date);
      return {player:str(athlete.displayName)||str(athlete.fullName),
        position:str(position.abbreviation),status:str(row.status)||'Not specified',
        reportAt:date,recencyVerified:Number.isFinite(time)&&time<=now+5000&&now-time<=72*3600000,
        note:str(row.shortComment).slice(0,480)};
    });
  }
  const name=norm(receiver),other=norm(opponent);
  const receiverReports=teams.flatMap(players).filter(x=>norm(x.player)===name).slice(0,8);
  const opponentTeam=other?teams.find(t=>norm(str(t.displayName)||str(rec(t.team).displayName))===other):undefined;
  const positions=new Set(['CB','DB','FS','SS','S','NB']);
  const defensiveBackReports=opponentTeam?players(opponentTeam).filter(x=>positions.has(x.position)).slice(0,16):[];
  return {source:'ESPN public injury observations (not official team designation)',
    sourceUrl:url,feedTimestamp:str(data.timestamp)||null,retrievedAt,
    receiver,opponent,sourceFresh:Number.isFinite(sourceAt)&&sourceAt<=now+5000&&now-sourceAt<=48*3600000,
    receiverReports,opponentTeamMatched:Boolean(opponentTeam),defensiveBackReports,
    noListingMeansHealthy:false,cornerbackAssignmentVerified:false,
    officialNflInjuryStatusVerified:false,providerCreditsUsed:0,
    recommendation:'HOLD',
    note:'A missing injury listing never implies healthy or available; a defensive-back injury does not establish shadow, slot, zone or safety assignments. Confirm official practice and game reports.',
  };
}
