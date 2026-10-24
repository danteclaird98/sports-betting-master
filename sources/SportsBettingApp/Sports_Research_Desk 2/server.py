"""Loopback-only application. Authentication tokens are configured server-side."""
import argparse, hashlib, hmac, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from engine import Store, coverage

def build_handler(store,tokens):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def send(self,status,data,content='application/json'):
            body=data.encode() if isinstance(data,str) else json.dumps(data,allow_nan=False).encode()
            self.send_response(status);self.send_header('Content-Type',content);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");self.end_headers();self.wfile.write(body)
        def user(self):
            auth=self.headers.get('Authorization','')
            for user,token in tokens.items():
                if hmac.compare_digest(auth,'Bearer '+token): return user
            return None
        def do_GET(self):
            if self.path in ['/', '/ui.js','/style.css']:
                file={'/':'index.html','/ui.js':'ui.js','/style.css':'style.css'}[self.path]
                return self.send(200,(Path(__file__).parent/'web'/file).read_text(),{'/':'text/html','/ui.js':'text/javascript','/style.css':'text/css'}[self.path])
            user=self.user()
            if not user: return self.send(401,{'error':'Authentication required'})
            routes={'/api/research':lambda:store.board(user),'/api/wagers':lambda:store.rows(user,'wagers'),'/api/performance':lambda:store.report(user),'/api/audit':lambda:store.audit(user),'/api/states':lambda:store.rows(user,'states'),'/api/limits':lambda:store.rows(user,'limits'),'/api/coverage':coverage,'/api/health':lambda:{'provider':'unavailable','live_verified':False,'models':[],'scan':'blocked: no authorized provider adapter configured','execution':'disabled','latency':'unknown'}}
            if self.path not in routes: return self.send(404,{'error':'Not found'})
            try: self.send(200,routes[self.path]())
            except (ValueError,KeyError,TypeError) as e: self.send(400,{'error':str(e)})
        def do_POST(self):
            user=self.user()
            if not user: return self.send(401,{'error':'Authentication required'})
            routes={'/api/quotes':store.import_quote,'/api/states':store.state,'/api/wagers':store.wager,'/api/settle':store.settle,'/api/limits':store.limits}
            if self.path not in routes: return self.send(403,{'error':'Unsupported action; real-money execution is disabled'})
            try:
                size=int(self.headers.get('Content-Length','0'))
                if size<=0 or size>1000000: raise ValueError('Invalid request size')
                data=json.loads(self.rfile.read(size))
                if not isinstance(data,dict): raise ValueError('Expected a JSON object')
                self.send(200,routes[self.path](user,data))
            except (ValueError,KeyError,TypeError) as e: self.send(400,{'error':str(e)})
    return Handler

def main():
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8765);p.add_argument('--db',default='research.sqlite3');args=p.parse_args()
    tokens=json.loads(os.environ.get('BETTING_USERS','{}'))
    if not tokens or any(not isinstance(t,str) or len(t)<32 for t in tokens.values()) or len(set(tokens.values()))!=len(tokens): raise SystemExit('Set BETTING_USERS to distinct user tokens of at least 32 characters. See README.')
    ThreadingHTTPServer(('127.0.0.1',args.port),build_handler(Store(args.db),tokens)).serve_forever()
if __name__=='__main__': main()
