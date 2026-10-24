"""Research controls; binary, no-push markets only. Not a wagering executor."""
import math
from datetime import datetime

def time(s):
    t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if t.tzinfo is None: raise ValueError("timezone required")
    return t

def implied(decimal):
    if not math.isfinite(decimal) or decimal <= 1: raise ValueError("invalid odds")
    return 1 / decimal

def fair(a, b):
    x, y = implied(a), implied(b)
    return x / (x + y)

def score(ps, ys):
    if not ps or len(ps) != len(ys): raise ValueError("empty or unequal samples")
    if any(not math.isfinite(p) or not 0 <= p <= 1 for p in ps): raise ValueError("invalid probability")
    if any(y not in (0, 1) for y in ys): raise ValueError("binary outcomes required")
    q = [max(1e-12, min(1-1e-12, p)) for p in ps]
    bins = []
    for j in range(10):
        ix = [i for i,p in enumerate(ps) if min(9,int(p*10)) == j]
        if ix: bins.append(dict(n=len(ix), predicted=sum(ps[i] for i in ix)/len(ix), observed=sum(ys[i] for i in ix)/len(ix)))
    return dict(n=len(ps), brier=sum((p-y)**2 for p,y in zip(ps,ys))/len(ps), log_loss=-sum(y*math.log(p)+(1-y)*math.log(1-p) for p,y in zip(q,ys))/len(ps), reliability=bins)

def partition(rows, validation_start, test_start):
    a,b=time(validation_start),time(test_start)
    if a>=b: raise ValueError("invalid boundaries")
    groups=[[],[],[]]
    event_groups={}
    for r in rows:
        t=time(r["decision_at"])
        k=0 if t<a else 1 if t<b else 2
        if r["event_id"] in event_groups and event_groups[r["event_id"]]!=k: raise ValueError("event crosses split; purge it")
        event_groups[r["event_id"]]=k
        if time(r["feature_available_at"])>t or time(r["model_trained_through"])>=t: raise ValueError("future information")
        groups[k].append(r)
    if any(not g for g in groups): raise ValueError("empty chronological period")
    for k in (0,1):
        boundary=a if k==0 else b
        if any(time(r["settled_at"])>=boundary for r in groups[k]): raise ValueError("unsettled labels cross boundary")
    return groups

def result(r, max_age_seconds=120, edge_buffer=.02):
    reasons=[]
    d=time(r["decision_at"])
    age=(d-time(r["odds_at"])).total_seconds()
    if not 0<=age<=max_age_seconds: reasons.append("stale or future quote")
    if time(r["feature_available_at"])>d: reasons.append("future feature")
    for field in ("event_verified","market_verified","source_verified","rules_verified","price_available"):
        if not r.get(field): reasons.append(field+" missing")
    if r.get("market_type")!="binary_no_push": reasons.append("unsupported push/void/partial settlement")
    if not r.get("uncertainty_validated"): reasons.append("uncertainty not validated")
    if r.get("parlay"): reasons.append("joint model required; marginal multiplication prohibited")
    p,lo,hi=r["probability"],r["probability_low"],r["probability_high"]
    if not all(math.isfinite(v) for v in (lo,p,hi)) or not 0<=lo<=p<=hi<=1: raise ValueError("invalid uncertainty")
    odds=r["decimal_odds"]; raw=implied(odds)
    ev=p*odds-1
    if lo*odds-1<=edge_buffer: reasons.append("lower probability bound does not clear EV buffer")
    return dict(event=r["event_id"],market=r["market_key"],sportsbook=r["book"],odds_at=r["odds_at"],decimal_odds=odds,market_implied_probability=raw,estimated_probability=p,uncertainty=[lo,hi],estimated_ev=ev,supporting_evidence=r.get("evidence",[]),reasons_to_abstain=reasons,status="ABSTAIN" if reasons else "PASSES_RESEARCH")

def settlement(outcome, stake, odds, limit, accepted):
    implied(odds)
    if min(stake,limit)<0: raise ValueError("negative stake/limit")
    filled=min(stake,limit) if accepted else 0
    if outcome not in ("win","loss","push","void"): raise ValueError("unsupported settlement")
    return dict(filled=filled,profit=filled*(odds-1) if outcome=="win" else -filled if outcome=="loss" else 0)

def clv(entry_odds, close_yes, close_no, entry_key, close_key):
    if entry_key!=close_key: return None
    return entry_odds*fair(close_yes,close_no)-1
