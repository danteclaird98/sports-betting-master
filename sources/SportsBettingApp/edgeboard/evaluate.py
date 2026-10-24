"""Run: python evaluate.py history.jsonl --train-end ISO --validation-end ISO --output report.json"""
import argparse, collections, hashlib, json, random
from pathlib import Path
from core import validate, split, metrics, returns, devig

def fit(rows):
    bins=collections.defaultdict(list)
    for r in rows:
        if r['outcome'] in ('win','loss'): bins[min(9,int(r['p']*10))].append(int(r['outcome']=='win'))
    return {i:(sum(y)+1)/(len(y)+2) for i,y in bins.items()}

def calibrated(rows, model):
    return [model.get(min(9,int(r['p']*10)),r['p']) for r in rows]

def paired_ci(rows, candidate, iterations=1000):
    groups=collections.defaultdict(list)
    for r,p in zip(rows,candidate):
        if r['outcome'] in ('win','loss'):
            y=int(r['outcome']=='win'); groups[r['event_id']].append((p-y)**2-(r['p']-y)**2)
    if len(groups)<2: return None
    rng=random.Random(20261003); keys=list(groups); draws=[]
    for _ in range(iterations):
        values=[x for k in rng.choices(keys,k=len(keys)) for x in groups[k]]
        draws.append(sum(values)/len(values))
    draws.sort(); return [draws[25],draws[974]]

def evaluate(rows, train_end, validation_end):
    for r in rows: validate(r)
    keys=[(r['event_id'],r['market'],r['player_id'],r['side'],r['line'],r['period'],r['rules_id'],r['book'],r['decision_at']) for r in rows]
    if len(set(keys))!=len(keys): raise ValueError('Duplicate prediction records')
    train,val,test=split(rows,train_end,validation_end)
    eligible=[r for r in train if r['outcome'] in ('win','loss')]
    if not eligible: raise ValueError('No binary training outcomes')
    # Baseline evaluated before fitting the candidate.
    baseline={name:metrics(rs,[r['p'] for r in rs]) for name,rs in [('train',train),('validation',val),('test',test)]}
    model=fit(train)
    vcal=metrics(val,calibrated(val,model))
    if 'brier' not in vcal: raise ValueError('No binary validation outcomes')
    selected=vcal['brier']<baseline['validation']['brier']
    ps=calibrated(test,model) if selected else [r['p'] for r in test]
    base_rate=sum(r['outcome']=='win' for r in eligible)/len(eligible)
    market=[r for r in test if 'opposing_odds' in r and r.get('opposing_market_verified')]
    report={'status':'held-out improvement unestablished; never auto-promote','periods':{'train_end':train_end,'validation_end':validation_end,'sizes':[len(train),len(val),len(test)]},'unchanged_baseline':baseline,'candidate':'training-bin calibration' if selected else 'unchanged baseline','calibration_model':model,'validation_calibrated':vcal,'test_candidate':metrics(test,ps),'test_constant_baseline':metrics(test,[base_rate]*len(test)),'test_coinflip_baseline':metrics(test,[.5]*len(test)),'test_market_baseline_matched_subset':metrics(market,[devig(r['odds'],r['opposing_odds']) for r in market]),'test_raw_on_market_subset':metrics(market,[r['p'] for r in market]),'paired_event_bootstrap_brier_delta_95_ci':paired_ci(test,ps),'subgroups':{},'limitations':['Binary pregame singles only; pushes/voids excluded from probability metrics','Calibration intervals need independent validation; candidate returns abstain until supplied','Event bootstrap does not capture multi-event temporal dependence; use season/week block sensitivity before promotion','One training/validation split; no automatic promotion; no parlay probability model']}
    # Raw-model intervals cannot be recycled for a newly calibrated probability.
    return_rows=[dict(r,p_lower=None,p_upper=None,uncertainty_method=None) if selected else r for r in test]
    report['test_execution']=returns(return_rows,ps)
    def roi_ci(rs, qs):
        groups=collections.defaultdict(list)
        for r,p in zip(rs,qs): groups[r['event_id']].append((r,p))
        if len(groups)<2: return None
        rng=random.Random(20261003); keys=list(groups); values=[]
        for _ in range(1000):
            sample=[pair for k in rng.choices(keys,k=len(keys)) for pair in groups[k]]
            result=returns([r for r,_ in sample],[p for _,p in sample])
            if result['roi'] is not None: values.append(result['roi'])
        if len(values)<950: return None
        values.sort(); return [values[int(.025*len(values))],values[min(len(values)-1,int(.975*len(values)))]]
    report['test_execution']['roi_event_bootstrap_95_ci']=roi_ci(return_rows,ps)
    for dim in ('sport','market','season'):
        for value in sorted({str(r[dim]) for r in test}):
            idx=[i for i,r in enumerate(test) if str(r[dim])==value]
            rs=[test[i] for i in idx]; qs=[ps[i] for i in idx]
            report['subgroups'][dim+':'+value]={'candidate':metrics(rs,qs),'raw':metrics(rs,[r['p'] for r in rs]),'paired_brier_ci':paired_ci(rs,qs),'execution':returns([return_rows[i] for i in idx],qs)}
            report['subgroups'][dim+':'+value]['execution']['roi_event_bootstrap_95_ci']=roi_ci([return_rows[i] for i in idx],qs)
    return report

if __name__=='__main__':
    a=argparse.ArgumentParser(); a.add_argument('history'); a.add_argument('--train-end',required=True); a.add_argument('--validation-end',required=True); a.add_argument('--output',required=True); args=a.parse_args()
    target=Path(args.output)
    if target.exists(): raise SystemExit('Output exists; refusing to overwrite evaluation')
    data=Path(args.history).read_bytes(); rows=[json.loads(s) for s in data.decode().splitlines() if s.strip()]
    result=evaluate(rows,args.train_end,args.validation_end)
    result['dataset_sha256']=hashlib.sha256(data).hexdigest()
    result['code_sha256']={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in ('core.py','evaluate.py')}
    target.write_text(json.dumps(result,indent=2)+'\n')
