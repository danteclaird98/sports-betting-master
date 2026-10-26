import copy
from itertools import permutations
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from datetime import datetime,timedelta,timezone
from pathlib import Path
from http.server import ThreadingHTTPServer
from app import Workspace, handler

class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.ws=Workspace(Path(self.temp.name)/'test.sqlite')
        self.rows=json.loads(Path('web/example.json').read_text())
    def tearDown(self): self.temp.cleanup()
    def fresh(self):
        rows=copy.deepcopy(self.rows)
        now=datetime.now(timezone.utc)
        for i,row in enumerate(rows):
            row.update(provider='manual',starts_at=(now+timedelta(days=1)).isoformat(),updated_at=(now-timedelta(seconds=20-i)).isoformat(),retrieved_at=now.isoformat())
        return rows
    def test_atomic_validation_and_deduplication(self):
        bad=copy.deepcopy(self.rows);bad[-1]['decimal_price']=1
        with self.assertRaises(ValueError): self.ws.ingest(bad)
        self.assertEqual(self.ws.state()['summary']['snapshots'],0)
        self.assertEqual(self.ws.ingest(self.rows)['imported'],6)
        self.assertEqual(self.ws.ingest(self.rows)['imported'],0)
    def test_demo_and_stale_excluded(self):
        self.ws.ingest(self.rows)
        self.assertIsNone(self.ws.state()['markets'][0]['best_book'])
        stale=self.fresh()
        for r in stale:r['updated_at']='2020-01-01T00:00:00Z'
        self.ws.ingest(stale)
        self.assertTrue(all(m['best_book'] is None for m in self.ws.state()['markets']))
    def test_ordering_best_price_movement_exact_contract(self):
        rows=self.fresh();self.ws.ingest(list(reversed(rows)))
        m=self.ws.state()['markets'][0]
        self.assertEqual(m['best_book'],'FanDuel')
        self.assertAlmostEqual(m['quotes'][0]['movement'],1.98/1.90-1)
        changed=copy.deepcopy(rows[0]);changed['rules']='other-rules'
        self.ws.ingest([changed]);self.assertEqual(len(self.ws.state()['markets']),2)
    def test_unknown_timestamp_and_rules_excluded(self):
        rows=self.fresh()
        for r in rows:r.update(updated_at=None,rules='unknown')
        self.ws.ingest(rows)
        self.assertIsNone(self.ws.state()['markets'][0]['best_book'])
    def test_latest_conflicts_fail_closed_in_every_import_order(self):
        base = self.fresh()[0]
        older = dict(base, updated_at=(datetime.fromisoformat(base['updated_at'])-timedelta(seconds=1)).isoformat())
        for changed in (dict(base, decimal_price=base['decimal_price']+.5),
                        dict(base, status='suspended')):
            for order in permutations([older, base, changed]):
                with self.subTest(changed=changed, order=order), tempfile.TemporaryDirectory() as tmp:
                    ws = Workspace(Path(tmp)/'quotes.db')
                    ws.ingest(list(order))
                    with ws.connect() as db:
                        before = db.execute('SELECT hash,body FROM quotes ORDER BY id').fetchall()
                    state = ws.state()
                    self.assertEqual(state['movements'], [])
                    market = state['markets'][0]
                    self.assertIsNone(market['best_book'])
                    self.assertEqual(len(market['quotes']), 2)
                    self.assertTrue(all(not q['eligible'] and q['movement'] is None and
                                        q['freshness']=='CONFLICTING_LATEST_QUOTES' for q in market['quotes']))
                    with ws.connect() as db:
                        self.assertEqual(db.execute('SELECT hash,body FROM quotes ORDER BY id').fetchall(), before)

    def test_conflict_isolated_to_book_and_later_clean_quote_restores(self):
        base = self.fresh()[0]
        self.ws.ingest([base, dict(base, decimal_price=3),
                        dict(base, bookmaker='Healthy', decimal_price=2)])
        self.assertEqual(self.ws.state()['markets'][0]['best_book'], 'Healthy')
        later = dict(base, decimal_price=2.5, updated_at=datetime.now(timezone.utc).isoformat())
        self.ws.ingest([later])
        market = self.ws.state()['markets'][0]
        self.assertEqual(market['best_book'], base['bookmaker'])
        self.assertEqual(market['best_price'], 2.5)
        self.assertEqual(len(market['quotes']), 2)
        self.assertEqual(self.ws.state()['summary']['snapshots'], 4)

    def test_identical_semantic_repolls_remain_eligible(self):
        base = self.fresh()[0]
        later_receipt = dict(base, retrieved_at=(datetime.fromisoformat(base['retrieved_at'])+timedelta(seconds=1)).isoformat())
        self.ws.ingest([base, later_receipt])
        self.assertEqual(self.ws.state()['markets'][0]['best_book'], base['bookmaker'])
        self.assertEqual(len(self.ws.state()['markets'][0]['quotes']), 1)
        self.assertEqual(self.ws.state()['summary']['snapshots'], 2)

    def test_new_capture_clocks_are_utc_without_rewriting_input_or_history(self):
        row = self.fresh()[0]
        for field in ('starts_at', 'retrieved_at', 'updated_at'):
            row[field] = datetime.fromisoformat(row[field]).astimezone(timezone(timedelta(hours=-7))).isoformat()
        original = copy.deepcopy(row)
        # Simulate an existing capture with original non-UTC bytes.
        legacy = json.dumps(row)
        with self.ws.connect() as db:
            db.execute('INSERT INTO quotes(hash,body) VALUES (?,?)', ('legacy', legacy))
        self.ws.ingest([row])
        self.assertEqual(row, original)
        with self.ws.connect() as db:
            saved = db.execute('SELECT hash,body FROM quotes ORDER BY id').fetchall()
        self.assertEqual(saved[0], ('legacy', legacy))
        captured = json.loads(saved[1][1])
        for field in ('starts_at', 'retrieved_at', 'updated_at'):
            self.assertTrue(captured[field].endswith('+00:00'))
            self.assertEqual(datetime.fromisoformat(captured[field]), datetime.fromisoformat(row[field]))
        self.ws.state()
        with self.ws.connect() as db:
            self.assertEqual(db.execute('SELECT hash,body FROM quotes ORDER BY id').fetchall(), saved)

    def test_ledger_persistence_and_settlement(self):
        row=dict(event='A @ B',selection='A',bookmaker='Book',stake=10,decimal_price=2.5)
        a=self.ws.wager(row)['id'];b=self.ws.wager(row)['id']
        self.ws.settle(dict(id=a,result='win'));self.ws.settle(dict(id=b,result='loss'))
        with self.assertRaises(ValueError):self.ws.settle(dict(id=a,result='loss'))
        other=Workspace(self.ws.path)
        self.assertEqual(other.state()['summary']['profit'],5)
        self.assertEqual(other.state()['summary']['roi'],.25)
        with self.assertRaises(ValueError):self.ws.wager(dict(row,stake=float('nan')))
    def test_http_flow_and_origin_boundary(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.ws))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        try:
            self.assertIn(b'Sports Betting Master',urllib.request.urlopen(base).read())
            req=urllib.request.Request(base+'/api/import',data=json.dumps(self.rows).encode(),headers={'Content-Type':'application/json'},method='POST')
            self.assertEqual(json.load(urllib.request.urlopen(req))['imported'],6)
            req.add_header('Origin','https://example.com')
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
            self.assertEqual(error.exception.code,403)
            self.assertEqual(json.load(urllib.request.urlopen(base+'/api/state'))['summary']['snapshots'],6)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
