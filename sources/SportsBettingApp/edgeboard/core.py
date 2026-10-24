"""Auditable binary-market research primitives; no feed or trained model bundled."""
import math
from datetime import datetime, timedelta

IDENTITY = ('event_id','sport','market','player_id','side','line','period','rules_id')

def dt(value):
    x = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if x.tzinfo is None:
        raise ValueError('Timezone required')
    return x

def decimal(american):
    if not math.isfinite(american) or abs(american) < 100:
        raise ValueError('Invalid American odds')
    return 1 + (american/100 if american > 0 else 100/abs(american))

def devig(a, b):
    if min(a,b) <= 1: raise ValueError('Decimal odds must exceed one')
    return (1/a)/(1/a+1/b)

def same_market(a,b):
    return all(k in a and k in b and a[k] == b[k] for k in IDENTITY)

def validate(row, max_age_seconds=120):
    t = dt(row['decision_at'])
    if not t < dt(row['start_at']): raise ValueError('Pregame evaluator only')
    for key in IDENTITY + ('book','source_url','provider_id','model_version'):
        if key not in row or row[key] is None: raise ValueError('Missing '+key)
    q = dt(row['quote_at'])
    if not q <= dt(row['retrieved_at']) <= t: raise ValueError('Quote unavailable at decision')
    if (t-q).total_seconds() > max_age_seconds: raise ValueError('Stale quote')
    if not row.get('features'): raise ValueError('Feature provenance required')
    for f in row['features']:
        if not f.get('source_url') or dt(f['available_at']) > t:
            raise ValueError('Future or unattributed feature')
    if dt(row['model_fit_at']) > t: raise ValueError('Model fit after prediction')
    if not 0 <= row['p'] <= 1: raise ValueError('Invalid probability')
    if not math.isfinite(row['odds']) or row['odds'] <= 1: raise ValueError('Invalid price')
    if row['outcome'] not in ('win','loss','push','void'): raise ValueError('Unsupported settlement')
    if dt(row['settled_at']) < dt(row['start_at']): raise ValueError('Invalid settlement time')
    if 'opposing_odds' in row and row['opposing_odds'] <= 1: raise ValueError('Invalid opposing odds')

def split(rows, train_end, validation_end):
    a,b = dt(train_end),dt(validation_end)
    if a >= b: raise ValueError('Invalid cutoffs')
    parts=[[],[],[]]; seen={}
    for r in rows:
        t=dt(r['decision_at']); i=0 if t<a else 1 if t<b else 2
        if r['event_id'] in seen and seen[r['event_id']] != i:
            raise ValueError('Event crosses split boundary')
        seen[r['event_id']]=i
        if i<2 and dt(r['settled_at']) >= (a if i==0 else b):
            raise ValueError('Label unavailable before next period')
        parts[i].append(r)
    if any(not p for p in parts): raise ValueError('Every chronological period needs data')
    return parts

def metrics(rows, probabilities):
    pairs=[(r,p) for r,p in zip(rows,probabilities) if r['outcome'] in ('win','loss')]
    if not pairs: return {'n':0}
    brier=loss=0; bins=[]
    for r,p in pairs:
        y=int(r['outcome']=='win'); brier+=(p-y)**2
        p=max(1e-12,min(1-1e-12,p)); loss-=y*math.log(p)+(1-y)*math.log(1-p)
    for i in range(10):
        group=[(r,p) for r,p in pairs if min(9,int(p*10))==i]
        if group: bins.append({'bin':i,'n':len(group),'predicted':sum(p for _,p in group)/len(group),'observed':sum(r['outcome']=='win' for r,_ in group)/len(group)})
    return {'n':len(pairs),'events':len({r['event_id'] for r,_ in pairs}),'brier':brier/len(pairs),'log_loss':loss/len(pairs),'calibration_bins':bins}

def assess(row, p, latency_seconds=5):
    reasons=[]; lo=row.get('p_lower'); hi=row.get('p_upper')
    if lo is None or hi is None or not 0<=lo<=p<=hi<=1:
        reasons.append('Validated probability interval unavailable')
    if not row.get('uncertainty_method'): reasons.append('Uncertainty provenance unavailable')
    if lo is not None and lo*row['odds']-1 <= 0: reasons.append('Conservative EV not positive')
    if not row.get('source_verified'): reasons.append('Source unverified')
    if not row.get('rules_verified'): reasons.append('Settlement equivalence unverified')
    if not row.get('independent_reference_verified'): reasons.append('Independent reference unavailable')
    if not row.get('available'): reasons.append('Price unavailable')
    if 'valid_until' not in row or dt(row['valid_until']) < dt(row['decision_at'])+timedelta(seconds=latency_seconds):
        reasons.append('Price not verified through execution delay')
    if row.get('limit',0)<=0: reasons.append('Bookmaker limit unavailable')
    return {'event':row['event_id'],'market':{k:row[k] for k in IDENTITY},'book':row['book'],'odds':row['odds'],'quote_at':row['quote_at'],'implied_probability':1/row['odds'],'estimated_probability':p,'uncertainty':[lo,hi],'estimated_ev':p*row['odds']-1,'evidence':[row['source_url']]+[f['source_url'] for f in row['features']],'reasons_to_abstain':reasons,'status':'PASS' if reasons else 'CANDIDATE'}

def returns(rows, probabilities):
    staked=profit=0; count=0; clv=[]; results=[]
    for r,p in zip(rows,probabilities):
        result=assess(r,p); results.append(result)
        if result['status']=='PASS': continue
        stake=min(1,r['limit']); count+=1; staked+=stake
        profit+=stake*((r['odds']-1) if r['outcome']=='win' else -1 if r['outcome']=='loss' else 0)-r.get('fee',0)
        c=r.get('close')
        if c and same_market(r,c) and c.get('book')==r['book'] and c.get('source_verified') and dt(r['decision_at'])<=dt(c['quote_at'])<dt(r['start_at']) and c.get('last_prestart_verified') and c['odds']>1:
            clv.append(r['odds']/c['odds']-1)
    return {'bets':count,'stake':staked,'profit':profit,'roi':profit/staked if staked else None,'abstention_rate':1-count/len(rows) if rows else None,'price_clv_n':len(clv),'mean_price_clv':sum(clv)/len(clv) if clv else None,'research_results':results}
