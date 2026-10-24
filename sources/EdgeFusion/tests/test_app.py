import copy
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
            self.assertIn(b'EdgeFusion',urllib.request.urlopen(base).read())
            req=urllib.request.Request(base+'/api/import',data=json.dumps(self.rows).encode(),headers={'Content-Type':'application/json'},method='POST')
            self.assertEqual(json.load(urllib.request.urlopen(req))['imported'],6)
            req.add_header('Origin','https://example.com')
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
            self.assertEqual(error.exception.code,403)
            self.assertEqual(json.load(urllib.request.urlopen(base+'/api/state'))['summary']['snapshots'],6)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
