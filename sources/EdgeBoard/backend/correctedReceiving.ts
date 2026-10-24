/** Retrospective research candidate. No quote, EV, ledger or execution authority. */
import installedArtifact from './correctedReceivingArtifact.json' with {type:'json'};
import installedReport from './correctedReceivingReport.json' with {type:'json'};
import installedManifest from './correctedReceivingManifest.json' with {type:'json'};

const FEATURES = ['past3avg', 'past8avg', 'past3hit', 'past8hit', 'priorgames'];
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(v);
const time = (v: unknown): number => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) return NaN;
  const n = Date.parse(v);
  return finite(n) && new Date(n).toISOString() === v.replace(/Z$/,v.includes('.')?'Z':'.000Z') ? n : NaN;
};
const sigmoid = (z: number) => z >= 0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z));
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '['+v.map(canonicalJson).join(',')+']';
  if (object(v)) return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
async function digest(v: unknown) {
  const bytes = new TextEncoder().encode(canonicalJson(v));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function frozenClone<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value));
  const freeze = (x: unknown) => { if (object(x) || Array.isArray(x)) { Object.values(x).forEach(freeze); Object.freeze(x); } };
  freeze(clone); return clone;
}
type Artifact = typeof installedArtifact;
type Manifest = typeof installedManifest;
const BASE = {status:'HOLD',liveApproved:false,verifiedPositiveEv:false,productionEnabled:false,executionEnabled:false,
  modelVersion:'receiving60-logistic-v1',scope:'CONDITIONAL_RECORDED_PLAYER_RECEIVING_60_PLUS'} as const;

/** Inputs are cloned/frozen. Only installed files are used by the public functions. */
export function createCorrectedReceivingService(artifact: unknown, report: unknown, manifest: Manifest, now:()=>number=()=>Date.now()) {
  const a = frozenClone(artifact) as Artifact;
  const frozenReport = frozenClone(report);
  const m = frozenClone(manifest);
  async function integrity() {
    try {
      if (a.version !== BASE.modelVersion || canonicalJson(a.features)!==canonicalJson(FEATURES)
        || ![a.mean,a.scale,a.coefficients].every(v=>Array.isArray(v)&&v.length===5&&v.every(finite))
        || a.scale.some(s=>s<=0) || !finite(a.intercept) || !finite(a.calibration?.intercept)
        || !finite(a.calibration?.slope) || typeof a.calibration?.selected!=='boolean'
        || a.target?.stat!=='receiving_yards' || a.target?.threshold!==60 || a.target?.comparison!=='>='
        || a.status!=='HOLD' || a.production_enabled!==false || !finite(time(m.artifactAvailableAt))) return false;
      return (await digest(a))===m.canonicalArtifactSha256 && (await digest(frozenReport))===m.canonicalReportSha256;
    } catch { return false; }
  }
  const receipt = () => ({...BASE,artifactSha256:m.sourceArtifactSha256,canonicalArtifactSha256:m.canonicalArtifactSha256,
    artifactAvailableAt:m.artifactAvailableAt,receiptType:'RETROSPECTIVE_CANDIDATE_RESEARCH_ONLY'});
  async function readiness() {
    const verified=await integrity();
    return {...receipt(),artifactVerified:verified,probability:null,
      reason:verified?'FORWARD_VALIDATION_REQUIRED':'ARTIFACT_INTEGRITY_FAILURE',
      independentOfOdds:true,untouchedHoldout:false,calibratedUncertaintyAvailable:false,
      limitations:['2025 diagnostic already consumed','Calibration fitted and compared on same late2024 partition',
        'Historical publication clocks unproven','Recorded-player-row scope does not predict participation'],
      requiredRequest:{league:'NFL',position:['WR','RB','TE'],seasonType:'REG',period:'FULL_GAME',stat:'receiving_yards',threshold:60,comparison:'>='}};
  }
  async function frozenMetrics() {
    if (!await integrity()) return {...receipt(),reason:'ARTIFACT_INTEGRITY_FAILURE',report:null};
    return {...receipt(),report:frozenReport,reportSha256:m.sourceReportSha256,
      reason:'FROZEN_RETROSPECTIVE_DIAGNOSTICS_NOT_PROSPECTIVE_VALIDATION'};
  }
  async function score(body: unknown) {
    const abstain=(reason:string)=>({...receipt(),probability:null,reason});
    if (!await integrity()) return abstain('ARTIFACT_INTEGRITY_FAILURE');
    if (!exact(body,['request','history']) || !exact(body.request,['playerId','gameId','kickoffAt','decisionAt','league','position','seasonType','period','stat','threshold','comparison'])
      || !Array.isArray(body.history) || body.history.length>500) return abstain('INVALID_REQUEST_SCHEMA');
    const r=body.request;
    if (r.league!=='NFL'||typeof r.position!=='string'||!['WR','RB','TE'].includes(r.position)||r.seasonType!=='REG'||r.period!=='FULL_GAME'
      ||r.stat!=='receiving_yards'||r.threshold!==60||r.comparison!=='>=') return abstain('UNSUPPORTED_TARGET');
    const decision=time(r.decisionAt),kickoff=time(r.kickoffAt),clock=now();
    if (!id(r.playerId)||!id(r.gameId)||![decision,kickoff,clock].every(finite)||decision>=kickoff||clock>=kickoff) return abstain('INVALID_DECISION_CLOCK');
    if (decision>clock) return abstain('FUTURE_DECISION_CLOCK');
    if (decision<time(m.artifactAvailableAt)) return abstain('MODEL_NOT_AVAILABLE_AS_OF_DECISION');
    const seen=new Set<string>();
    const history:{kickoff:number;yards:number}[]=[];
    for (const h of body.history) {
      if (!exact(h,['playerId','gameId','kickoffAt','resolvedAt','observedAt','receivingYards'])||h.playerId!==r.playerId||!id(h.gameId)||h.gameId===r.gameId||seen.has(h.gameId)) return abstain('INVALID_HISTORY_IDENTITY');
      seen.add(h.gameId);
      const played=time(h.kickoffAt),resolved=time(h.resolvedAt),observed=time(h.observedAt);
      if (![played,resolved,observed].every(finite)||played>=resolved||resolved>observed||observed>=decision||!finite(h.receivingYards)||!Number.isInteger(h.receivingYards)) return abstain('HISTORY_NOT_AVAILABLE_AS_OF_DECISION');
      history.push({kickoff:played,yards:h.receivingYards});
    }
    history.sort((x,y)=>x.kickoff-y.kickoff);
    if (history.some((h,i)=>i>0&&h.kickoff===history[i-1].kickoff)) return abstain('TIED_HISTORY_CLOCK');
    if (history.length<3) return abstain('INSUFFICIENT_HISTORY');
    const average=(n:number)=>history.slice(-n).reduce((s,h)=>s+h.yards,0)/Math.min(n,history.length);
    const hit=(n:number)=>history.slice(-n).filter(h=>h.yards>=60).length/Math.min(n,history.length);
    const features=[average(3),average(8),hit(3),hit(8),history.length];
    const logit=a.intercept+features.reduce((s,x,i)=>s+a.coefficients[i]*(x-a.mean[i])/a.scale[i],0);
    const calLogit=a.calibration.intercept+a.calibration.slope*logit;
    if (![...features,logit,calLogit].every(finite)) return abstain('NONFINITE_DERIVED_FEATURES');
    const rawProbability=sigmoid(logit),calibratedProbability=sigmoid(calLogit);
    return {...receipt(),probability:a.calibration.selected?calibratedProbability:rawProbability,rawProbability,calibratedProbability,
      features,playerId:r.playerId,gameId:r.gameId,decisionAt:r.decisionAt,eligibilityVerified:false,
      reason:'UNVERIFIED_SUPPLIED_HISTORY_REQUIRES_FORWARD_VALIDATION'};
  }
  return {readiness,frozenMetrics,score};
}
const installed=createCorrectedReceivingService(installedArtifact,installedReport,installedManifest);
export const correctedReceivingReadiness=installed.readiness;
export const correctedReceivingReport=installed.frozenMetrics;
export const correctedReceivingScore=installed.score;
