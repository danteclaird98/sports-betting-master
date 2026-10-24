"""Persistent research and accounting; no numerical model or execution connector."""
import hashlib
import json
import math
import sqlite3
import threading
from functools import wraps
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from core import Quote, WagerKey, MarketStatus, check_quote_freshness, implied_probability

MARKETS = ['moneyline_2way','moneyline_3way','spread','alternate_spread','total','team_total','player_prop','game_prop','team_prop','period','futures','parlay','same_game_parlay']
def now(): return datetime.now(timezone.utc).isoformat()
def timestamp(value):
    d = datetime.fromisoformat(value.replace('Z','+00:00'))
    if d.tzinfo is None: raise ValueError('Timestamp requires timezone')
    return d.astimezone(timezone.utc)
def number(value, minimum=0):
    n=float(value)
    if not math.isfinite(n) or n<minimum: raise ValueError('Invalid number')
    return n
def money(value):
    number(value)
    return str(Decimal(str(value)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
def required(data, keys):
    for k in keys:
        if k not in data or data[k] is None or data[k]=='': raise ValueError('Required field: '+k)
def encoded(data): return json.dumps(data,sort_keys=True,allow_nan=False)
def digest(data): return hashlib.sha256(encoded(data).encode()).hexdigest()

def serialized(method):
    @wraps(method)
    def call(self,*args,**kwargs):
        with self.lock: return method(self,*args,**kwargs)
    return call

class Store:
    def __init__(self,path):
        self.path=path
        self.lock=threading.RLock()
        with self.connect() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS records(user TEXT, kind TEXT, id TEXT, payload TEXT, PRIMARY KEY(user,kind,id));
            CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT,kind TEXT,id TEXT,time TEXT,before TEXT,after TEXT);''')
    def connect(self):
        c=sqlite3.connect(self.path,timeout=15); c.row_factory=sqlite3.Row; return c
    def rows(self,user,kind):
        with self.connect() as c: return [json.loads(r[0]) for r in c.execute('SELECT payload FROM records WHERE user=? AND kind=? ORDER BY rowid',(user,kind))]
    def audit(self,user):
        with self.connect() as c: return [dict(r) for r in c.execute('SELECT * FROM audit WHERE user=? ORDER BY sequence',(user,))]
    def put(self,user,kind,key,data,replace=False):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT payload FROM records WHERE user=? AND kind=? AND id=?',(user,kind,key)).fetchone()
            if row and not replace:
                if row[0]==encoded(data): return {'duplicate':True,'id':key}
                raise ValueError('Identifier conflict; existing record differs')
            after=encoded(data)
            if row and row[0]==after: return {'duplicate':True,'id':key}
            c.execute('INSERT OR REPLACE INTO records VALUES(?,?,?,?)',(user,kind,key,after))
            c.execute('INSERT INTO audit(user,kind,id,time,before,after) VALUES(?,?,?,?,?,?)',(user,kind,key,now(),row[0] if row else None,after))
        return {'id':key,'duplicate':False}
    @serialized
    def import_quote(self,user,q):
        required(q,['id','provider','provider_event_id','event_id','sport','league','event','start_at','market','selection','period','rules','sportsbook','observed_at','retrieved_at','source_ref','decimal_odds','status','scope','provenance'])
        if q['market'] not in MARKETS: raise ValueError('Unsupported market identifier')
        if q['scope'] not in ['pregame','live']: raise ValueError('Invalid scope')
        if q['provenance'] not in ['manual_unverified','authorized_import','demonstration']: raise ValueError('Invalid provenance')
        if q['status'] not in [s.value for s in MarketStatus]: raise ValueError('Invalid status')
        if number(q['decimal_odds'],1)<=1: raise ValueError('Odds must exceed one')
        for key in ['start_at','observed_at','retrieved_at']: timestamp(q[key])
        if q.get('source_published_at'): timestamp(q['source_published_at'])
        q=dict(q); q['decimal_odds']=number(q['decimal_odds']); q['snapshot_id']=digest(q)
        return self.put(user,'quotes',q['id'],q)
    def board(self,user,scope=None):
        rows=[]
        for q in self.rows(user,'quotes'):
            if scope and q['scope']!=scope: continue
            key=WagerKey(q['event_id'],q['market'],q['selection'],q.get('line'),q['period'],q['rules'])
            quote=Quote(q['provider'],q['sportsbook'],timestamp(q['retrieved_at']),timestamp(q['observed_at']),timestamp(q['start_at']),MarketStatus(q['status']),key,q['decimal_odds'],'decimal',q.get('latency_seconds'))
            threshold=15 if q['scope']=='live' else 300
            fresh=check_quote_freshness(quote,now=datetime.now(timezone.utc),max_age_seconds=threshold,max_latency_seconds=5 if q['scope']=='live' else None)
            reasons=[]
            if not fresh.eligible: reasons.append(fresh.reason)
            if q['provenance']!='authorized_import': reasons.append('Price provenance unverified or demonstration')
            if not q.get('rules_verified'): reasons.append('Settlement rules not verified')
            if q['scope']=='pregame' and timestamp(q['start_at'])<=datetime.now(timezone.utc): reasons.append('Event has started; pregame quote expired')
            if q['scope']=='live':
                states=[s for s in self.rows(user,'states') if s['event_id']==q['event_id']]
                if not states: reasons.append('Live state missing')
                else:
                    s=max(states,key=lambda s:timestamp(s['source_at']))
                    age=(datetime.now(timezone.utc)-timestamp(s['source_at'])).total_seconds()
                    if age<0 or age>15 or s['connected'] is not True: reasons.append('Live state stale or disconnected')
                    if abs((timestamp(s['source_at'])-timestamp(q['observed_at'])).total_seconds())>5: reasons.append('State/odds timestamps misaligned')
            # Imported probabilities are never silently elevated into evaluated models.
            reasons.append('No implemented, evaluated model for this market')
            rows.append(dict(q,price_fresh=fresh.eligible,implied_probability=implied_probability(q['decimal_odds'],'decimal'),model_probability=None,ev_per_unit=None,uncertainty='unquantified',qualification='unevaluable',exclusion_reasons=reasons,price_type='observed quote; account availability unconfirmed',expires_at=datetime.fromtimestamp(timestamp(q['observed_at']).timestamp()+threshold,timezone.utc).isoformat()))
        # Exact identity includes sport/league/participant in addition to core key.
        for row in rows:
            fields=['sport','league','event_id','market','participant_id','selection','line','period','rules']
            matches=[r for r in rows if all(r.get(k)==row.get(k) for k in fields) and r['price_fresh'] and (r['scope']=='live' or timestamp(r['start_at'])>datetime.now(timezone.utc)) and r['provenance']=='authorized_import' and r.get('rules_verified')]
            row['best_observed_decimal']=max((r['decimal_odds'] for r in matches),default=None)
        return rows
    @serialized
    def state(self,user,s):
        required(s,['id','event_id','source_at','retrieved_at','period','clock','score','connected','mode','source_ref'])
        if s['mode'] not in ['polling','streaming','manual']: raise ValueError('Invalid feed mode')
        for k in ['source_at','retrieved_at']: timestamp(s[k])
        if timestamp(s['source_at'])>datetime.now(timezone.utc): raise ValueError('Future state')
        if not isinstance(s['connected'],bool): raise ValueError('connected must be boolean')
        old=[r for r in self.rows(user,'states') if r['event_id']==s['event_id']]
        if old and timestamp(s['source_at'])<=max(timestamp(r['source_at']) for r in old): raise ValueError('Duplicate or out-of-order live update')
        return self.put(user,'states',s['id'],s)
    @serialized
    def wager(self,user,w):
        required(w,['id','event_id','event','sport','league','sportsbook','market','selection','period','rules','decimal_odds','stake','currency','placed_at','source','mode','exposure_group'])
        if w['mode'] not in ['proposed','paper','actual']: raise ValueError('Invalid wager mode')
        if w['market'] not in MARKETS: raise ValueError('Unsupported market')
        if number(w['decimal_odds'],1)<=1 or number(w['stake'])<=0: raise ValueError('Invalid stake or odds')
        if len(w['currency'])!=3 or not w['currency'].isalpha(): raise ValueError('Use ISO currency code')
        timestamp(w['placed_at'])
        if timestamp(w['placed_at'])>datetime.now(timezone.utc): raise ValueError('Placement time in future')
        if w['market'] in ['parlay','same_game_parlay'] and not w.get('legs'): raise ValueError('Combination requires individual legs')
        for leg in w.get('legs',[]): required(leg,['event_id','market','selection','period','rules','status'])
        w=dict(w); w['stake']=money(w['stake']); w['currency']=w['currency'].upper(); w['settlement']=None
        existing=self.rows(user,'wagers')
        if w.get('external_id') and any(r.get('external_id')==w['external_id'] and r['sportsbook']==w['sportsbook'] and r['id']!=w['id'] for r in existing): raise ValueError('Duplicate external wager')
        limits=self.rows(user,'limits')
        for limit in limits:
            if limit['currency']!=w['currency'] or w['mode']!='actual': continue
            open_stake=sum(Decimal(r['stake']) for r in existing if r['mode']=='actual' and not r['settlement'] and r['currency']==w['currency'] and r['id']!=w['id'])
            group=sum(Decimal(r['stake']) for r in existing if r['mode']=='actual' and not r['settlement'] and r['currency']==w['currency'] and r['exposure_group']==w['exposure_group'] and r['id']!=w['id'])
            spent=sum(Decimal(r['stake']) for r in existing if r['mode']=='actual' and r['currency']==w['currency'] and timestamp(r['placed_at']).date()==timestamp(w['placed_at']).date() and r['id']!=w['id'])
            for total,k in [(open_stake,'max_open'),(group,'max_group'),(spent,'max_daily')]:
                if total+Decimal(w['stake'])>Decimal(limit[k]): raise ValueError('Tracking limit exceeded: '+k)
        return self.put(user,'wagers',w['id'],w)
    @serialized
    def settle(self,user,s):
        required(s,['id','revision','status','payout','fees','settled_at','source_ref','provisional','reason'])
        if s['status'] not in ['win','loss','push','void','cashout','partial','dead_heat']: raise ValueError('Invalid settlement status')
        if not isinstance(s['revision'],int) or s['revision']<1 or not isinstance(s['provisional'],bool): raise ValueError('Invalid revision or provisional flag')
        timestamp(s['settled_at'])
        wagers=[w for w in self.rows(user,'wagers') if w['id']==s['id']]
        if not wagers: raise ValueError('Unknown wager')
        w=wagers[0]
        if w['mode']=='proposed': raise ValueError('Proposed wagers cannot settle')
        if timestamp(s['settled_at'])<timestamp(w['placed_at']) or timestamp(s['settled_at'])>datetime.now(timezone.utc): raise ValueError('Invalid settlement time')
        s=dict(s); s['payout']=money(s['payout']); s['fees']=money(s['fees'])
        old=w['settlement']
        if old==s: return {'id':w['id'],'duplicate':True}
        if old and s['revision']<=old['revision']: raise ValueError('Correction requires increasing revision')
        if s['status'] in ['push','void'] and Decimal(s['payout'])!=Decimal(w['stake']): raise ValueError('Push/void must return stake')
        if s['status']=='loss' and Decimal(s['payout'])!=0: raise ValueError('Loss payout must be zero')
        w['settlement']=s
        return self.put(user,'wagers',w['id'],w,replace=True)
    @serialized
    def limits(self,user,data):
        required(data,['currency','max_open','max_group','max_daily'])
        data=dict(data)
        for k in ['max_open','max_group','max_daily']: data[k]=money(data[k])
        return self.put(user,'limits',data['currency'],data,replace=True)
    def report(self,user):
        groups={}
        for w in self.rows(user,'wagers'):
            key=(w['currency'],w['mode'])
            g=groups.setdefault(key,{'currency':key[0],'mode':key[1],'settled_count':0,'open_count':0,'provisional_count':0,'amount_wagered':Decimal(0),'net_profit':Decimal(0),'open_exposure':Decimal(0),'record':{},'breakdowns':{},'equity':[]})
            s=w['settlement']
            if not s or s['provisional']:
                g['open_count']+=1; g['open_exposure']+=Decimal(w['stake']); g['provisional_count']+=int(bool(s)); continue
            stake=Decimal(w['stake']); profit=Decimal(s['payout'])-stake-Decimal(s['fees'])
            g['settled_count']+=1; g['amount_wagered']+=stake; g['net_profit']+=profit
            g['record'][s['status']]=g['record'].get(s['status'],0)+1
            g['equity'].append((s['settled_at'],profit))
            for dimension in ['sport','league','market','sportsbook','date']:
                b=g['breakdowns'].setdefault(dimension,{}).setdefault(timestamp(w['placed_at']).date().isoformat() if dimension=='date' else w[dimension],{'count':0,'stake':Decimal(0),'profit':Decimal(0)})
                b['count']+=1;b['stake']+=stake;b['profit']+=profit
        for g in groups.values():
            equity=peak=dd=Decimal(0)
            for _,p in sorted(g.pop('equity')): equity+=p;peak=max(peak,equity);dd=max(dd,peak-equity)
            g['drawdown']=str(dd); g['roi']=float(g['net_profit']/g['amount_wagered']) if g['amount_wagered'] else None
            for k in ['amount_wagered','net_profit','open_exposure']: g[k]=str(g[k])
            for bs in g['breakdowns'].values():
                for b in bs.values():
                    b['roi']=float(b['profit']/b['stake']) if b['stake'] else None;b['stake']=str(b['stake']);b['profit']=str(b['profit'])
        return list(groups.values())

def coverage():
    return [{'market':m,'designed':True,'implemented':'manual quote and ledger schema; deterministic calculations','locally_tested':'generic import and accounting; no sport model','live_verified':False,'dependencies':'authorized feed, exact rules mapping, evaluated sport/market model'} for m in MARKETS]
