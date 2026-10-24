import unittest
from datetime import datetime, timedelta, timezone
import test_app as fixtures
from engine import now


quote,wager,settlement=fixtures.quote,fixtures.wager,fixtures.settlement

class Hardening(unittest.TestCase):
    setUp=fixtures.Workflow.setUp
    tearDown=fixtures.Workflow.tearDown
    def test_suspended_latest_invalidates_old_open(self):
        q=quote(); q.update(provenance='authorized_import',rules_verified=True,
            observed_at=(datetime.now(timezone.utc)-timedelta(seconds=5)).isoformat())
        self.s.import_quote('a',q)
        q.update(id='q2',status='suspended',observed_at=now(),retrieved_at=now())
        self.s.import_quote('a',q)
        rows=self.s.board('a')
        self.assertFalse(rows[0]['price_fresh'])
        self.assertTrue(all(r['best_observed_decimal'] is None for r in rows))

    def test_identical_time_provider_conflict_fails_closed(self):
        q=quote();q.update(provenance='authorized_import',rules_verified=True)
        self.s.import_quote('a',q);q.update(id='q2',decimal_odds=3)
        self.s.import_quote('a',q)
        self.assertTrue(all(not r['price_fresh'] for r in self.s.board('a')))

    def test_boolean_numeric_and_rules_rejected(self):
        for field,value in [('decimal_odds',True),('rules_verified','false'),('latency_seconds',-1),('event_id',[])]:
            q=quote();q[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError): self.s.import_quote('a',q)

    def test_zero_after_rounding_rejected(self):
        w=wager();w['stake']='0.001'
        with self.assertRaises(ValueError):self.s.wager('a',w)

    def test_provisional_exposure_still_consumes_limit(self):
        self.s.limits('a',dict(currency='usd',max_open=15,max_group=15,max_daily=100))
        w=wager();w['mode']='actual';self.s.wager('a',w)
        s=settlement();s['provisional']=True;self.s.settle('a',s)
        w['id']='w2'
        with self.assertRaisesRegex(ValueError,'max_open'):self.s.wager('a',w)

    def test_reimport_settled_wager_does_not_reset_settlement(self):
        w=wager();self.s.wager('a',w);self.s.settle('a',settlement())
        self.assertTrue(self.s.wager('a',w)['duplicate'])
        self.assertEqual(self.s.report('a')[0]['net_profit'],'9.00')

    def test_boolean_revision_rejected(self):
        self.s.wager('a',wager());s=settlement();s['revision']=True
        with self.assertRaises(ValueError):self.s.settle('a',s)

    def test_live_and_pregame_prices_never_compared(self):
        q=quote();q.update(provenance='authorized_import',rules_verified=True)
        self.s.import_quote('a',q)
        q.update(id='live',scope='live',decimal_odds=9,latency_seconds=1)
        self.s.import_quote('a',q)
        row=self.s.board('a')[0]
        self.assertEqual(row['best_observed_decimal'],2.1)

    def test_limits_concurrent_entry_serialized(self):
        from concurrent.futures import ThreadPoolExecutor
        self.s.limits('a',dict(currency='USD',max_open=10,max_group=10,max_daily=100))
        def enter(i):
            w=wager();w.update(id=str(i),mode='actual')
            try:self.s.wager('a',w);return True
            except ValueError:return False
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(enter,range(4))),1)

