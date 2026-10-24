import { deVigProportional } from './researchControls';

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const list = (v: unknown): Row[] => Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) as Row[] : [];
const at = (v: unknown) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(str(v)) ? Date.parse(str(v)) : NaN;
const marketKeys: Record<string,string> = {
  player_receptions:'receptions', player_reception_yds:'receiving_yards',
  player_rush_yds:'rushing_yards', player_pass_yds:'passing_yards',
};
function decimal(v: unknown, mode:'american'|'decimal') {
  if(typeof v!=='number'||!Number.isFinite(v))return null;
  if(mode==='decimal')return v>1.001&&v<101?v:null;
  if(!Number.isInteger(v)||Math.abs(v)<100||Math.abs(v)>10000)return null;
  return v>0?1+v/100:1+100/Math.abs(v);
}
export function readArchivedNflOdds(input:unknown) {
  const root=rec(input);
  const mode=root.oddsFormat;
  const payload=rec(root.payload);
  if(mode!=='american'&&mode!=='decimal')throw Error('Select American or decimal odds format.');
  const snapshot=at(payload.timestamp);
  if(!Number.isFinite(snapshot)||snapshot>Date.now()+5000)throw Error('Historical snapshot timestamp invalid.');
  const events=Array.isArray(payload.data)?list(payload.data):[rec(payload.data)];
  if(events.length<1||events.length>30)throw Error('Provide one or up to 30 NFL event snapshots.');
  const counts: Record<string,number>={};
  const rejected=(key:string)=>{counts[key]=(counts[key]??0)+1;};
  const paired:Array<{game:string;providerEventId:string;nflverseGameId:null;player:string;playerId:null;
    market:string;line:number;book:string;decimalOver:number;decimalUnder:number;
    fairOver:number;fairUnder:number;margin:number;quoteAt:string;startTime:string}>=[];
  for(const e of events){
    const kickoff=at(e.commence_time);
    if(e.sport_key!=='americanfootball_nfl'||!str(e.id)||!str(e.away_team)||!str(e.home_team)||
      !Number.isFinite(kickoff)||kickoff<=snapshot||kickoff>snapshot+7*86400000){
      rejected('Invalid NFL event identity or pregame chronology');continue;
    }
    for(const b of list(e.bookmakers).slice(0,40)){
      const book=str(b.key);
      if(!/^[a-z0-9_]{2,55}$/i.test(book)){rejected('Missing book identity');continue;}
      for(const m of list(b.markets).slice(0,100)){
        const market=marketKeys[str(m.key)];
        if(!market)continue;
        const quoteTime=at(m.last_update);
        if(!Number.isFinite(quoteTime)||quoteTime>=kickoff||quoteTime>snapshot+5000||
          snapshot-quoteTime>48*3600000){
          rejected('Missing, future, or stale market timestamp');continue;
        }
        const grouped=new Map<string,{player:string;line:number;over?:number;under?:number;ambiguous:boolean}>();
        for(const o of list(m.outcomes).slice(0,350)){
          const side=str(o.name).toLowerCase();
          const player=str(o.description).trim();
          const line=o.point;
          const price=decimal(o.price,mode);
          if((side!=='over'&&side!=='under')||!player||player.length>90||
            typeof line!=='number'||!Number.isFinite(line)||line<0||line>999||price===null){
            rejected('Invalid player, side, line or price');continue;
          }
          const key=JSON.stringify([player.toLowerCase(),line]);
          const prior=grouped.get(key)??{player,line,ambiguous:false};
          if(prior[side as 'over'|'under']!==undefined){prior.ambiguous=true;rejected('Repeated side with same identity');}
          else prior[side as 'over'|'under']=price;
          grouped.set(key,prior);
        }
        for(const row of grouped.values()){
          if(row.over===undefined||row.under===undefined||row.ambiguous){
            rejected('Incomplete or contradictory two-sided market');continue;
          }
          const fair=deVigProportional([row.over,row.under]);
          paired.push({game:str(e.away_team)+' @ '+str(e.home_team),providerEventId:str(e.id),
            nflverseGameId:null,player:row.player,playerId:null,market,line:row.line,book,
            decimalOver:row.over,decimalUnder:row.under,fairOver:fair.fair[0],
            fairUnder:fair.fair[1],margin:fair.margin,quoteAt:str(m.last_update),startTime:str(e.commence_time)});
        }
      }
    }
  }
  return {
    status:'UNAUTHENTICATED_ARCHIVE_IMPORT',recommendation:'HOLD',betCount:0,stake:0,
    provider:'The Odds API v4 historical event odds (file import only)',
    snapshotAt:str(payload.timestamp),events:events.length,twoWayQuotes:paired.length,
    books:[...new Set(paired.map(p=>p.book))],rejectReasons:counts,quotesPreview:paired.slice(0,20),
    exportedQuotes:paired.length<=600?paired:[],truncatedPreview:paired.length>20,
    provenanceAuthenticated:false,providerCreditsUsed:0,modelMarketBenchmarkComplete:false,
    canonicalEventJoinComplete:false,canonicalPlayerJoinComplete:false,
    closingLineVerified:false,actualSportsbookFillsVerified:false,
    historicalBettingRoi:null,positiveEvEstablished:false,
    limitations:[
      'This is an externally provided JSON file; EdgeBoard has NOT independently retrieved or authenticated the provider response.',
      'Provider event IDs and athlete names must be mapped to independently checked nflverse game/player IDs before comparing model outcomes.',
      'Two-way de-vig benchmarks are sportsbook prices, not independent prop probabilities.',
      'Integer line push/void rules and account-specific execution are not verified.',
      'Historical NFL player props are a paid data product; this parser makes no paid calls.',
    ],
  };
}
export function archivedNflOddsFixture() {
  const timestamp='2025-10-01T15:00:00Z';
  const payload={timestamp,data:{id:'fixture',sport_key:'americanfootball_nfl',
    away_team:'Example Away',home_team:'Example Home',commence_time:'2025-10-01T20:00:00Z',
    bookmakers:[{key:'draftkings',markets:[{key:'player_receptions',last_update:timestamp,
      outcomes:[{name:'Over',description:'Fixture Player',point:4.5,price:-110},
        {name:'Under',description:'Fixture Player',point:4.5,price:-110}]}]}]}};
  const report=readArchivedNflOdds({oddsFormat:'american',payload});
  const checks={
    matchedTwoWayPrice:report.twoWayQuotes===1,
    deVigOverExactlyHalf:Math.abs(report.quotesPreview[0].fairOver-0.5)<1e-8,
    importCannotAuthenticateProvider:report.provenanceAuthenticated===false,
    positiveEvNotInvented:report.positiveEvEstablished===false&&report.historicalBettingRoi===null,
    noCreditsConsumed:report.providerCreditsUsed===0,
  };
  return {status:Object.values(checks).every(Boolean)?'PASS':'FAIL',fixture:'SYNTHETIC_DATA',checks};
}
