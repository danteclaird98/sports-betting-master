"""Retrospective receiving >=60 research candidate. No production integration."""
import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

FEATURES = ['past3avg', 'past8avg', 'past3hit', 'past8hit', 'priorgames']


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-700, min(700, x))))


def score(artifact, features):
    if artifact.get('version') != 'receiving60-logistic-v1' or artifact.get('features') != FEATURES:
        raise ValueError('Unsupported artifact schema')
    if any(len(artifact.get(k,[])) != 5 for k in ('mean','scale','coefficients')):
        raise ValueError('Invalid artifact dimensions')
    if any(not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v) for k in ('mean','scale','coefficients') for v in artifact[k]) or any(v <= 0 for v in artifact['scale']):
        raise ValueError('Invalid artifact numeric values')
    if set(features) != set(FEATURES):
        raise ValueError('Exact five historical features required')
    values = [features[k] for k in FEATURES]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError('Finite historical features required')
    if values[-1] < 3:
        raise ValueError('At least three prior recorded rows required')
    if values[-1] != int(values[-1]) or any(not 0 <= v <= 1 for v in values[2:4]):
        raise ValueError('Invalid prior count or hit rates')
    z = artifact['intercept'] + sum(b * (x-m)/s for b,x,m,s in zip(artifact['coefficients'], values, artifact['mean'], artifact['scale']))
    raw = sigmoid(z)
    cal = artifact['calibration']
    calibrated = sigmoid(cal['intercept'] + cal['slope'] * z)
    return {'p_raw': raw, 'p_calibrated': calibrated, 'p': calibrated if cal['selected'] else raw,
            'status': 'HOLD', 'production_enabled': False}


def cohort(raw_dir):
    history = defaultdict(list)
    rows, seen, weeks, hashes = [], set(), set(), {}
    excluded = defaultdict(int)
    negative = 0
    for season in range(2021, 2026):
        path = Path(raw_dir) / f'stats_player_week_{season}.csv'
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        with path.open() as stream:
            source = list(csv.DictReader(stream))
        source.sort(key=lambda r: (int(r['season']), int(r['week']), r['game_id'], r['player_id']))
        for row in source:
            if row['season_type'] != 'REG' or row['position'] not in {'WR', 'RB', 'TE'}:
                excluded['outside_regular_season_position_scope'] += 1
                continue
            key = (row['player_id'], row['game_id'])
            week_key = (row['player_id'], row['season'], row['week'])
            if not row['player_id'].strip() or not row['game_id'].strip() or key in seen or week_key in weeks:
                raise ValueError('Missing identity or duplicate player-game/week')
            seen.add(key)
            weeks.add(week_key)
            try:
                yards = float(row['receiving_yards'])
            except ValueError:
                excluded['missing_yards'] += 1
                continue
            if not math.isfinite(yards):
                raise ValueError('Nonfinite receiving yards')
            negative += yards < 0
            past = history[row['player_id']]
            if len(past) >= 3:
                p3, p8 = past[-3:], past[-8:]
                features = [sum(p3)/len(p3), sum(p8)/len(p8), sum(x >= 60 for x in p3)/len(p3),
                            sum(x >= 60 for x in p8)/len(p8), len(past)]
                year, week = int(row['season']), int(row['week'])
                split = ('train' if year <= 2023 else 'selection' if year == 2024 and week <= 9
                         else 'calibration' if year == 2024 else 'consumed_diagnostic')
                rows.append({'player_id': row['player_id'], 'game_id': row['game_id'], 'season': year,
                             'week': week, 'split': split, 'yards': yards, 'y': int(yards >= 60),
                             'features': features})
            else:
                excluded['insufficient_prior_rows'] += 1
            past.append(yards)
    return rows, hashes, dict(excluded), negative


def fit_logistic(x, y, penalty):
    import numpy as np
    b = np.zeros(x.shape[1])
    regularizer = np.ones(x.shape[1]) * penalty
    regularizer[0] = 0
    for _ in range(100):
        logits = np.clip(x @ b, -35, 35)
        p = 1 / (1 + np.exp(-logits))
        grad = x.T @ (p-y) + regularizer*b
        hessian = x.T @ ((p*(1-p))[:, None] * x) + np.diag(regularizer + 1e-10)
        step = np.linalg.solve(hessian, grad)
        b -= step
        if np.max(np.abs(step)) < 1e-9:
            return b
    raise ValueError('Logistic optimizer did not converge')


def metrics(labels, predictions):
    n = len(labels)
    return {'n': n, 'brier': sum((p-y)**2 for p,y in zip(predictions,labels))/n,
            'log_loss': sum(-y*math.log(max(1e-15,p))-(1-y)*math.log(max(1e-15,1-p)) for p,y in zip(predictions,labels))/n}


def train(raw_dir, output):
    import numpy as np
    rows, hashes, exclusions, negative = cohort(raw_dir)
    groups = {s: [r for r in rows if r['split'] == s] for s in ('train','selection','calibration','consumed_diagnostic')}
    tx = np.array([r['features'] for r in groups['train']], dtype=float)
    mean, scale = tx.mean(axis=0), tx.std(axis=0)
    scale[scale == 0] = 1
    def design(subset):
        a = np.array([r['features'] for r in subset], dtype=float)
        return np.column_stack([np.ones(len(a)), (a-mean)/scale])
    x, y = design(groups['train']), np.array([r['y'] for r in groups['train']])
    choices = []
    for penalty in (.01, .1, 1., 10., 100.):
        weights = fit_logistic(x, y, penalty)
        predictions = 1/(1+np.exp(-np.clip(design(groups['selection']) @ weights,-35,35)))
        choices.append((metrics([r['y'] for r in groups['selection']], predictions)['log_loss'], penalty, weights))
    _, penalty, weights = min(choices, key=lambda a:(a[0], a[1]))
    cx = design(groups['calibration']) @ weights
    cy = np.array([r['y'] for r in groups['calibration']])
    cal_weights = fit_logistic(np.column_stack([np.ones(len(cx)), cx]), cy, 1e-6)
    raw = 1/(1+np.exp(-np.clip(cx,-35,35)))
    calibrated = 1/(1+np.exp(-np.clip(cal_weights[0]+cal_weights[1]*cx,-35,35)))
    raw_metrics, cal_metrics = metrics(cy,raw), metrics(cy,calibrated)
    selected = cal_metrics['log_loss'] < raw_metrics['log_loss']
    artifact = {'version':'receiving60-logistic-v1','features': FEATURES,'mean':mean.tolist(),'scale':scale.tolist(),
                'intercept':float(weights[0]),'coefficients':weights[1:].tolist(),'regularization':penalty,
                'calibration':{'intercept':float(cal_weights[0]),'slope':float(cal_weights[1]),'selected':bool(selected)},
                'target':{'stat':'receiving_yards','threshold':60,'comparison':'>='},'status':'HOLD','production_enabled':False,
                'source_hashes':hashes,'pipeline_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'protocol':{'fit':'2021-2023 REG','regularization_selection':'2024 REG weeks1-9 raw log_loss',
                            'platt_fit_and_choice':'2024 REG weeks10-18 in-sample log_loss','diagnostic':'2025 consumed; not untouched'},
                'scope':'Retrospective REG WR/RB/TE recorded-player rows; >=3 prior rows across seasons; no odds features',
                'evaluation_status':'2025 already consumed diagnostic; no untouched test; no source-time availability proof'}
    report = {'status':'HOLD','counts':{s:len(g) for s,g in groups.items()},'negative_yard_rows_retained':negative,
              'exclusions':exclusions,'selection_grid':[{'l2':p,'log_loss':float(loss)} for loss,p,_ in choices],
              'calibration_comparison':{'raw':raw_metrics,'platt':cal_metrics,'selected':bool(selected),
               'limitation':'Platt fitted and compared on same late2024 partition; in-sample calibration selection, not independent evidence'},
              'partition_metrics':{},'limitations':['Candidate retrospective; protocol chosen after prior diagnostic consumption',
              'No untouched test or validated uncertainty; no market price/EV analysis',
              'Weekly archived rows lack historical publication timestamps; week order is a retrospective proxy',
              'Recorded-player-row cohort is conditional on an eventual row, not a prospective active roster',
              'No reproduction of deployed SportsAI888 backend; source access unavailable']}
    for split, subset in groups.items():
        preds = [score(artifact,dict(zip(FEATURES,r['features']))) for r in subset]
        labels = [r['y'] for r in subset]
        report['partition_metrics'][split] = {key: metrics(labels,[p[key] for p in preds]) for key in ('p_raw','p_calibrated','p')}
        report['partition_metrics'][split]['train_base_rate'] = metrics(labels,[float(y.mean())]*len(labels))
        for row, pred in zip(subset,preds): row.update(pred)
    out = Path(output); out.mkdir(parents=True,exist_ok=True)
    for name, data in [('artifact.json',artifact),('report.json',report)]:
        (out/name).write_text(json.dumps(data,sort_keys=True,indent=2,allow_nan=False)+'\n')
    with (out/'predictions.jsonl').open('w') as f:
        for row in rows: f.write(json.dumps(row,sort_keys=True,allow_nan=False)+'\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command',required=True)
    fit = commands.add_parser('train'); fit.add_argument('--raw-dir',required=True); fit.add_argument('--output',required=True)
    predict = commands.add_parser('predict'); predict.add_argument('--artifact',required=True); predict.add_argument('--features',required=True)
    args = parser.parse_args()
    if args.command == 'train': print(json.dumps(train(args.raw_dir,args.output),sort_keys=True))
    else: print(json.dumps(score(json.loads(Path(args.artifact).read_text()),json.loads(Path(args.features).read_text())),sort_keys=True))


if __name__ == '__main__': main()
