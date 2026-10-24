type SourceType = 'coverage' | 'coach' | 'analyst' | 'injury' | 'usage';
type Evidence = { type: SourceType; url: string; publishedAt: string; summary: string; reviewed: boolean };
type Audit = {
  receiver: string;
  opponent: string;
  event: string;
  kickoff: string;
  market: 'receptions' | 'receiving_yards';
  line: number;
  likelyCorner?: string;
  assignment?: 'shadow' | 'side' | 'slot' | 'zone' | 'unknown';
  coverageScheme?: 'man' | 'zone' | 'mixed' | 'unknown';
  routesVerified?: boolean;
  targetVolumeVerified?: boolean;
  injuriesVerified?: boolean;
  evidence?: Evidence[];
};
function validDate(value: string) {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}
function validEvidence(e: Evidence, kickoff: number, now: number) {
  let host = '';
  try { const u = new URL(e.url); if (u.protocol !== 'https:') return false; host = u.hostname; } catch { return false; }
  const published = Date.parse(e.publishedAt);
  return host.includes('.') && validDate(e.publishedAt) &&
    published <= Math.min(kickoff, now) && published >= kickoff - 14 * 86400000 &&
    e.reviewed === true && typeof e.summary === 'string' &&
    e.summary.trim().length >= 18 && e.summary.length <= 1600 &&
    ['coverage','coach','analyst','injury','usage'].includes(e.type);
}
export function auditReceiverMatchup(input: Audit, now = Date.now()) {
  if (!input || !input.receiver?.trim() || !input.event?.trim() ||
      !validDate(input.kickoff) || !['receptions','receiving_yards'].includes(input.market) ||
      !Number.isFinite(input.line) || input.line < 0 || input.line > 1000) {
    throw Error('Receiver, event, kickoff, market and exact line required.');
  }
  const kickoff = Date.parse(input.kickoff);
  const reviewed = (input.evidence ?? []).slice(0,25).filter(e => validEvidence(e, kickoff, now));
  const has = (type: SourceType) => reviewed.some(e => e.type === type);
  const checklist = {
    upcomingGame: kickoff > now,
    cornerNamed: Boolean(input.likelyCorner?.trim()),
    cornerAssignmentDescribed: Boolean(input.assignment && input.assignment !== 'unknown'),
    coverageSchemeDescribed: Boolean(input.coverageScheme && input.coverageScheme !== 'unknown'),
    cornerCoverageEvidenceSupplied: has('coverage'),
    routeAndTargetEvidenceSupplied: input.routesVerified === true && input.targetVolumeVerified === true && has('usage'),
    injuryPracticeEvidenceSupplied: input.injuriesVerified === true && has('injury'),
    coachingStatementSupplied: has('coach'),
    independentAnalystEvidenceSupplied: has('analyst'),
  };
  const blockers: string[] = [];
  if (!checklist.upcomingGame) blockers.push('Not a future pregame event.');
  if (!checklist.cornerNamed || !checklist.cornerAssignmentDescribed) blockers.push('Cornerback assignment or slot/shadow/zone responsibility unverified.');
  if (!checklist.coverageSchemeDescribed || !checklist.cornerCoverageEvidenceSupplied) blockers.push('Man/zone rates, coverage responsibility and safety help unverified.');
  if (!checklist.routeAndTargetEvidenceSupplied) blockers.push('Routes run, alignment, target share and quarterback usage need source-backed review.');
  if (!checklist.injuryPracticeEvidenceSupplied) blockers.push('Receiver/cornerback/team practice status and injuries need official verification.');
  if (!checklist.coachingStatementSupplied) blockers.push('No directly reviewed and attributed game-specific coach statement.');
  if (!checklist.independentAnalystEvidenceSupplied) blockers.push('No directly reviewed independent matchup analysis or projection disagreements.');
  blockers.push('No validated live player-prop probability distribution, uncertainty interval, executable Caesars price or verified grading rules.');
  return {
    status:'HOLD', receiver:input.receiver, market:input.market, line:input.line, checklist, blockers,
    suppliedReviewedSources:reviewed.length, sourceAuthenticityConfirmedByAdapter:false,
    note:'User-supplied evidence is not independently authenticated by this validator. A named corner does not imply shadow coverage.',
    winningProbability:null, estimatedEV:null, suggestedStake:0, noWagerPlaced:true,
  };
}
type NewsArticle = { headline?:string; description?:string; published?:string; lastModified?:string;
  links?:{web?:{href?:string}} };
export async function fetchReceiverNews(receiver:string,opponent:string) {
  if (!/^[a-zA-Z][a-zA-Z .'-]{1,74}$/.test(receiver.trim())) throw Error('Enter a receiver name.');
  if (opponent.length > 90 || /[^a-zA-Z .'-]/.test(opponent)) throw Error('Invalid opponent.');
  const sourceUrl='https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100';
  const response=await fetch(sourceUrl,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(14000)});
  if(!response.ok) throw Error('Public NFL news feed unavailable.');
  const data=await response.json() as {articles?:NewsArticle[]};
  if(!Array.isArray(data.articles)) throw Error('Public feed does not contain an article list.');
  const query=receiver.toLowerCase().trim();
  const surname=query.split(/\s+/).at(-1) ?? query;
  const opp=opponent.toLowerCase().trim();
  const now=Date.now();
  const headlines=data.articles.filter(a=>{
    const p=Date.parse(a.published ?? a.lastModified ?? '');
    if(!Number.isFinite(p)||p>now||now-p>14*86400000) return false;
    const body=(a.headline ?? '')+' '+(a.description ?? '');
    const text=body.toLowerCase();
    return text.includes(query) || (surname.length>=5 && text.includes(surname) && (!opp || text.includes(opp)));
  }).slice(0,12).map(a=>{
    const url=a.links?.web?.href ?? '';
    return {
      headline:String(a.headline??'').slice(0,220),
      description:String(a.description??'').slice(0,360),
      publishedAt:a.published??a.lastModified??null,
      url:/^https:\/\/(?:www\.)?espn\.com\/nfl\//.test(url)?url:null,
      kind:'DISCOVERY_HEADLINE_ONLY',
      fullArticleRead:false, coachQuoteVerified:false, cornerAssignmentVerified:false,
    };
  });
  return {receiver,opponent,source:'ESPN public NFL news',retrievedAt:new Date().toISOString(),
    coverage:'PARTIAL_LEAGUEWIDE_FEED_NOT_ALL_ANALYST_REPORTS_OR_TEAM_PRESS_CONFERENCES',
    sourceUrl,headlines, count:headlines.length,
    recommendationsEnabled:false, independentlyVerifiedCoachQuotes:0, matchedCornerbackAssignments:0,
    note:'News descriptions are leads; to cite a coaching statement or defensive assignment, inspect the full original report and confirm source, timestamp and context.',
    recommendation:'HOLD', providerCreditsUsed:0 };
}
export function receiverMatchupSelfTest() {
  const result=auditReceiverMatchup({
    receiver:'Fixture Receiver',opponent:'Fixture Defense',event:'Fixture Game',
    kickoff:'2036-10-20T21:00:00Z',market:'receptions',line:5.5,likelyCorner:'Fixture Corner',
    assignment:'unknown',coverageScheme:'unknown',evidence:[]
  },Date.parse('2026-10-18T00:00:00Z'));
  const checks={noAssumedShadow:!result.checklist.cornerAssignmentDescribed,
    requiresCoaching:result.blockers.some(x=>x.includes('coach statement')),
    requiresCoverage:result.blockers.some(x=>x.includes('Man/zone')),
    cannotInventEV:result.estimatedEV===null&&result.winningProbability===null,
    noWager:result.suggestedStake===0&&result.status==='HOLD'};
  return {status:Object.values(checks).every(Boolean)?'PASS':'FAIL',fixture:'SYNTHETIC_NOT_LIVE',checks};
}
