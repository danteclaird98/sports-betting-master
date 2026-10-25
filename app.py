"""EdgeFusion: dependency-free, loopback-only sports research workspace."""
import argparse
import hashlib
import json
import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from edgeodds.models import MarketKey, MarketType, MarketStatus, NormalizedQuote, evaluate_freshness
from edgeodds.price_intelligence import exact_selection_signature, best_price, price_movement
from integrations.movements import significant_moves
from integrations.provider_imports import ProviderImports

ROOT = Path(__file__).parent

def timestamp(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.utcoffset() is None:
        raise ValueError('Timestamp requires timezone')
    return dt

def normalize(row):
    for field in ('event_id', 'event', 'league', 'selection', 'bookmaker', 'provider', 'period', 'rules'):
        if not isinstance(row.get(field), str) or not row[field].strip() or len(row[field]) > 200:
            raise ValueError('Missing or invalid ' + field)
    timestamp(row['starts_at'])
    key = MarketKey(row['event_id'], MarketType(row['market']), row['selection'], row.get('line'), row['period'], row['rules'])
    return NormalizedQuote(row['provider'], row['bookmaker'], row['event_id'], row.get('source_market_id', row['market']), key,
        float(row['decimal_price']), timestamp(row['retrieved_at']), timestamp(row['updated_at']) if row.get('updated_at') else None,
        MarketStatus(row.get('status', 'unknown')), hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest())

class Workspace:
    def __init__(self, path):
        self.path = str(path)
        with self.connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS quotes(id INTEGER PRIMARY KEY, hash TEXT UNIQUE, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS wagers(id INTEGER PRIMARY KEY, body TEXT NOT NULL, result TEXT DEFAULT 'pending');''')
        self.provider_imports = ProviderImports(Path(self.path))
    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()
    def ingest(self, rows):
        if not isinstance(rows, list) or not 1 <= len(rows) <= 5000:
            raise ValueError('Import requires 1–5000 normalized quotes')
        # Validate complete batch before committing any row.
        parsed = [(normalize(r), r) for r in rows]
        with self.connect() as db:
            before = db.total_changes
            for q, row in parsed:
                db.execute('INSERT OR IGNORE INTO quotes(hash,body) VALUES (?,?)', (q.source_payload_hash, json.dumps(row, allow_nan=False)))
            return {'imported': db.total_changes - before}
    def state(self):
        now = datetime.now(timezone.utc)
        with self.connect() as db:
            archived = [json.loads(r[0]) for r in db.execute('SELECT body FROM quotes ORDER BY id')]
            wagers = [dict(id=r[0], **json.loads(r[1]), result=r[2]) for r in db.execute('SELECT id,body,result FROM wagers ORDER BY id DESC')]
        latest, histories = {}, {}
        for row in archived:
            q = normalize(row)
            sig = (exact_selection_signature(q), q.provider, q.bookmaker)
            histories.setdefault(sig, []).append(q)
            # Provider update order, rather than import order, selects the latest quote.
            order = q.source_updated_at or datetime.min.replace(tzinfo=timezone.utc)
            if sig not in latest or order >= latest[sig][0]:
                latest[sig] = (order, q, row)
        groups = {}
        for sig, (_, q, row) in latest.items():
            fresh = evaluate_freshness(q, now=now, max_age_seconds=120)
            demo = q.provider == 'demo'
            eligible = fresh.eligible and timestamp(row['starts_at']) > now and row['rules'] != 'unknown' and row['period'] != 'unknown' and not demo
            change = None
            try:
                change = price_movement(histories[sig]).decimal_ratio_minus_one
            except ValueError:
                pass
            detail = dict(row, eligible=eligible, freshness=fresh.reason, demo=demo, movement=change)
            group = groups.setdefault(exact_selection_signature(q), [])
            group.append((q, detail))
        markets = []
        for entries in groups.values():
            candidates = [q for q, r in entries if r['eligible']]
            winner = best_price(candidates) if candidates else None
            markets.append({'quotes': [r for q, r in entries], 'best_book': winner.bookmaker if winner else None,
                            'best_price': winner.decimal_price if winner else None})
        profit = sum(w['stake'] * (w['decimal_price'] - 1) if w['result'] == 'win' else -w['stake'] if w['result'] == 'loss' else 0 for w in wagers)
        turnover = sum(w['stake'] for w in wagers if w['result'] in ('win', 'loss'))
        return dict(markets=markets, movements=significant_moves(archived), wagers=wagers, summary=dict(snapshots=len(archived), markets=len(markets), profit=round(profit,2), roi=profit/turnover if turnover else None), provider_status='Imported quote snapshots; live verification not established')
    def import_provider(self, body):
        from integrations.adapters import convert
        converted=convert(body['format'],body['payload'],body.get('options'))
        result=self.ingest(converted['quotes'])
        return dict(result,skipped=converted['skipped'],warnings=converted['warnings'])
    def sync_provider(self, body):
        from integrations.adapters import fetch_sgo
        converted=fetch_sgo(body['league'])
        result=self.ingest(converted['quotes'])
        return dict(result,skipped=converted['skipped'],warnings=converted['warnings'])
    def providers(self):
        return {'providers':[{'name':'SportsGameOdds','credential_configured':bool(os.environ.get('SPORTSGAMEODDS_KEY')),'network_verified':False},
            {'name':'The Odds API','credential_configured':bool(os.environ.get('THE_ODDS_API_KEY')),'network_verified':False}],
            'formats':['normalized','sportsgameodds','the-odds-api','oddsharvester','edgeboard']}
    def wager(self, row):
        for key in ('event', 'selection', 'bookmaker'):
            if not isinstance(row.get(key), str) or not 1 <= len(row[key].strip()) <= 200:
                raise ValueError('Required ' + key)
        stake, price = float(row['stake']), float(row['decimal_price'])
        if not math.isfinite(stake) or not 0 < stake <= 1000000 or not math.isfinite(price) or price <= 1:
            raise ValueError('Stake must be positive and decimal odds greater than one')
        body = {k:row[k] for k in ('event','selection','bookmaker')}
        body.update(stake=stake, decimal_price=price, recorded_at=datetime.now(timezone.utc).isoformat())
        with self.connect() as db:
            cur = db.execute('INSERT INTO wagers(body) VALUES (?)', (json.dumps(body),))
            return {'id':cur.lastrowid}
    def settle(self, row):
        if row.get('result') not in ('win','loss','void'):
            raise ValueError('Choose win, loss or void')
        with self.connect() as db:
            cur = db.execute("UPDATE wagers SET result=? WHERE id=? AND result='pending'", (row['result'], int(row['id'])))
            if cur.rowcount != 1:
                raise ValueError('Wager missing or already settled')
        return {'saved':True}

def handler(workspace):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)
        def log_message(self, *_): pass
        def send(self, code, body, content_type='application/json'):
            data = json.dumps(body, allow_nan=False).encode() if content_type == 'application/json' else body
            self.send_response(code)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(data)
        def valid_host(self):
            return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')
        def do_GET(self):
            if not self.valid_host(): return self.send(403, {'error':'Invalid host'})
            path = urlsplit(self.path).path
            if path == '/health': return self.send(200, {'status':'ok'})
            if path == '/api/providers': return self.send(200, workspace.providers())
            if path == '/api/state': return self.send(200, workspace.state())
            if path == '/api/provider-imports': return self.send(200, workspace.provider_imports.summary())
            files = {'/':('index.html','text/html; charset=utf-8'), '/app.js':('app.js','text/javascript'), '/style.css':('style.css','text/css'), '/example.json':('example.json','application/json; charset=utf-8')}
            if path not in files: return self.send(404, {'error':'Not found'})
            name, mime = files[path]
            self.send(200, (ROOT/'web'/name).read_bytes(), mime)
        def do_POST(self):
            if not self.valid_host(): return self.send(403, {'error':'Invalid host'})
            origin = self.headers.get('Origin')
            if origin and origin not in (f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'):
                return self.send(403, {'error':'Invalid origin'})
            if self.headers.get('Content-Type') != 'application/json': return self.send(415, {'error':'JSON required'})
            try:
                size = int(self.headers.get('Content-Length',0))
                if not 0 < size <= 4000000: raise ValueError('Invalid request size')
                body = json.loads(self.rfile.read(size), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite number')))
                routes = {'/api/import':workspace.ingest, '/api/wagers':workspace.wager, '/api/settle':workspace.settle, '/api/import-provider':workspace.import_provider, '/api/sync-provider':workspace.sync_provider, '/api/provider-imports':workspace.provider_imports.import_payload}
                if self.path not in routes: return self.send(404, {'error':'Not found'})
                self.send(200,routes[self.path](body))
            except (ValueError, KeyError, TypeError, AttributeError, OverflowError, RecursionError) as exc:
                self.send(400, {'error':str(exc)[:200]})
    return Handler

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--db',default='data/edgefusion.sqlite3')
    args=parser.parse_args()
    Path(args.db).parent.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler(Workspace(args.db)))
    print(f'EdgeFusion → http://127.0.0.1:{args.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
