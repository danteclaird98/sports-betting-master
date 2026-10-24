import copy,json,tempfile,threading,unittest,urllib.request,urllib.error
from datetime import datetime,timedelta,timezone
from engine import Store,now
from server import build_handler,ThreadingHTTPServer
from evaluation import evaluate,closing_line_value

def quote():
    return dict(id='q',provider='fixture',provider_event_id='px',event_id='e',sport='test',league='test',event='Test event',start_at=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),market='moneyline_2way',selection='A',period='full',rules='binary regulation',sportsbook='book',observed_at=now(),retrieved_at=now(),source_ref='synthetic fixture',decimal_odds=2.1,status='open',scope='pregame',provenance='demonstration')
def wager():
    return dict(id='w',event_id='e',event='Test',sport='test',league='test',sportsbook='book',market='moneyline_2way',selection='A',period='full',rules='binary regulation',decimal_odds=2,stake='10',currency='USD',placed_at=now(),source='synthetic',mode='paper',exposure_group='e')
def settlement():
    return dict(id='w',revision=1,status='win',payout='20',fees='1',settled_at=now(),source_ref='fixture',provisional=False,reason='Initial')
class Workflow(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name+'/test.db')
    def tearDown(self): self.tmp.cleanup()
    def test_quote_snapshot_and_fail_closed(self):
        q=quote();self.s.import_quote('a',q);self.assertTrue(self.s.import_quote('a',q)['duplicate'])
        row=self.s.board('a')[0];self.assertIsNone(row['ev_per_unit']);self.assertEqual(row['qualification'],'unevaluable');self.assertEqual(len(row['snapshot_id']),64)
        self.assertEqual(self.s.board('b'),[])
        q['decimal_odds']=3
        with self.assertRaises(ValueError):self.s.import_quote('a',q)
    def test_settlement_correction_reconciliation(self):
        self.s.wager('a',wager());s=settlement();self.s.settle('a',s);self.assertTrue(self.s.settle('a',s)['duplicate'])
        self.assertEqual(self.s.report('a')[0]['net_profit'],'9.00')
        s.update(revision=2,status='loss',payout='0',fees='0',reason='Correction');self.s.settle('a',s)
        r=self.s.report('a')[0];self.assertEqual(r['net_profit'],'-10.00');self.assertEqual(r['drawdown'],'10.00');self.assertEqual(r['roi'],-1)
        self.assertEqual(len(self.s.audit('a')),3)
        with self.assertRaises(ValueError):self.s.settle('b',s)
    def test_duplicate_external_import(self):
        w=wager();w['external_id']='external';self.s.wager('a',w);w['id']='w2'
        with self.assertRaises(ValueError):self.s.wager('a',w)
    def test_currency_and_provisional_isolation(self):
        self.s.wager('a',wager());s=settlement();s['provisional']=True;self.s.settle('a',s)
        self.assertEqual(self.s.report('a')[0]['settled_count'],0)
        w=wager();w.update(id='w2',currency='EUR',mode='actual');self.s.wager('a',w)
        self.assertEqual(len(self.s.report('a')),2)
    def test_combination_requires_legs_and_has_no_inferred_probability(self):
        w=wager();w['market']='same_game_parlay'
        with self.assertRaises(ValueError):self.s.wager('a',w)
        w['legs']=[dict(event_id='e',market='total',selection='over',period='full',rules='rule',status='open')];self.s.wager('a',w)
    def test_limits(self):
        self.s.limits('a',dict(currency='USD',max_open=15,max_group=15,max_daily=15));w=wager();w['mode']='actual';self.s.wager('a',w);w['id']='w2'
        with self.assertRaises(ValueError):self.s.wager('a',w)
    def test_out_of_order_live_and_disconnect(self):
        s=dict(id='s',event_id='e',source_at=now(),retrieved_at=now(),period='1',clock='10:00',score='0-0',connected=False,mode='manual',source_ref='fixture');self.s.state('a',s)
        s['id']='s2'
        with self.assertRaises(ValueError):self.s.state('a',s)
        q=quote();q.update(scope='live',latency_seconds=1);self.s.import_quote('a',q)
        self.assertIn('Live state stale or disconnected',self.s.board('a')[0]['exclusion_reasons'])
    def test_nonfinite_and_missing_data(self):
        q=quote();q['decimal_odds']=float('nan')
        with self.assertRaises(ValueError):self.s.import_quote('a',q)
        with self.assertRaises(ValueError):self.s.wager('a',{})
    def test_http_workflow_auth_and_execution(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),build_handler(self.s,{'a':'a'*32,'b':'b'*32}));t=threading.Thread(target=server.serve_forever,daemon=True);t.start();base='http://127.0.0.1:'+str(server.server_port)
        def request(path,data=None,token='a'*32):
            req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            return json.loads(urllib.request.urlopen(req).read())
        try:
            self.assertIn(b'Sports Research Desk',urllib.request.urlopen(base).read())
            with self.assertRaises(urllib.error.HTTPError):request('/api/wagers',token='bad')
            request('/api/wagers',wager());request('/api/settle',settlement());self.assertEqual(request('/api/performance')[0]['net_profit'],'9.00');self.assertEqual(request('/api/wagers',token='b'*32),[])
            with self.assertRaises(urllib.error.HTTPError):request('/api/execute',{'stake':10})
        finally: server.shutdown();server.server_close();t.join()
class Evaluation(unittest.TestCase):
    def test_leakage_rejected(self):
        r=dict(id='x',prediction_at='2025-01-02T00:00:00Z',inputs_available_at='2025-01-03T00:00:00Z',odds_observed_at='2025-01-01T00:00:00Z',result_available_at='2025-01-04T00:00:00Z',outcome=1,settlement_type='binary',probability=.6,baseline_probability=.5,decimal_odds=2)
        with self.assertRaises(ValueError):evaluate([r],'2025-01-01T00:00:00Z','2025-01-02T00:00:00Z')
        r.update(event_id='event',inputs_available_at='2025-01-01T00:00:00Z',sport='test',market='moneyline',season=2025)
        result=evaluate([r],'2024-01-01T00:00:00Z','2024-12-01T00:00:00Z')
        self.assertEqual(result['test']['n'],1)
        self.assertAlmostEqual(result['test']['probability']['brier'],.16)
    def test_clv_changed_line_rejected(self):
        w=wager();w['line']='2.5';c=dict(w,observed_at=now(),start_at='2030-01-01T00:00:00Z',source_ref='fixture',decimal_odds=1.9)
        self.assertAlmostEqual(closing_line_value(w,c)['price_ratio_minus_one'],2/1.9-1)
        c['line']='3.5'
        with self.assertRaises(ValueError):closing_line_value(w,c)
if __name__=='__main__':unittest.main()
