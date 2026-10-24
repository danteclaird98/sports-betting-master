import unittest
from core import *
from evaluate import evaluate

def row(day=1):
    return dict(event_id=str(day),sport='NFL',season='synthetic',market='moneyline',player_id='',side='home',line=0,period='full',rules_id='OT',book='fixture',source_url='fixture://quote',provider_id='fixture',model_version='raw',model_fit_at='2026-01-01T00:00:00Z',decision_at=f'2026-01-{day:02}T12:00:00Z',start_at=f'2026-01-{day:02}T13:00:00Z',quote_at=f'2026-01-{day:02}T11:59:00Z',retrieved_at=f'2026-01-{day:02}T11:59:30Z',features=[dict(source_url='fixture://feature',available_at='2026-01-01T00:00:00Z')],p=.7,p_lower=.6,p_upper=.8,uncertainty_method='fixture',odds=2,outcome='win',settled_at=f'2026-01-{day:02}T18:00:00Z',available=True,limit=1,valid_until=f'2026-01-{day:02}T12:00:10Z',source_verified=True,rules_verified=True,independent_reference_verified=True)

class Tests(unittest.TestCase):
    def test_odds(self):
        self.assertEqual(decimal(-100),2); self.assertAlmostEqual(devig(1.91,1.91),.5)
    def test_leakage(self):
        r=row(); r['features'][0]['available_at']='2026-01-02T00:00:00Z'
        with self.assertRaises(ValueError): validate(r)
    def test_stale(self):
        r=row(); r['quote_at']='2026-01-01T11:00:00Z'
        with self.assertRaises(ValueError): validate(r)
    def test_timezone(self):
        with self.assertRaises(ValueError): dt('2026-01-01T12:00:00')
    def test_boundary(self):
        rs=[row(1),row(2),row(3)]; rs[1]['event_id']='1'
        with self.assertRaises(ValueError): split(rs,'2026-01-02T00:00:00Z','2026-01-03T00:00:00Z')
    def test_latency(self):
        r=row(); r['valid_until']=r['decision_at']
        self.assertEqual(assess(r,.7)['status'],'PASS')
    def test_uncertainty(self):
        r=row(); r.pop('p_lower'); self.assertEqual(assess(r,.7)['status'],'PASS')
    def test_matching(self):
        r=row(); c=dict(r,line=1); self.assertFalse(same_market(r,c))
    def test_settlement(self):
        for outcome,profit in [('win',1),('loss',-1),('push',0),('void',0)]:
            r=row(); r['outcome']=outcome; self.assertEqual(returns([r],[.7])['profit'],profit)
    def test_metrics(self):
        self.assertAlmostEqual(metrics([row()],[.7])['brier'],.09)
        self.assertAlmostEqual(metrics([row()],[.7])['log_loss'],-math.log(.7))
    def test_pipeline(self):
        rs=[row(i) for i in range(1,7)]
        out=evaluate(rs,'2026-01-03T00:00:00Z','2026-01-05T00:00:00Z')
        self.assertEqual(out['periods']['sizes'],[2,2,2])
        self.assertEqual(out['test_execution']['bets'],0) # new calibration lacks validated interval
    def test_test_labels_cannot_select(self):
        rs=[row(i) for i in range(1,7)]
        a=evaluate(rs,'2026-01-03T00:00:00Z','2026-01-05T00:00:00Z')
        rs[-1]['outcome']='loss'
        b=evaluate(rs,'2026-01-03T00:00:00Z','2026-01-05T00:00:00Z')
        self.assertEqual(a['calibration_model'],b['calibration_model']); self.assertEqual(a['candidate'],b['candidate'])

if __name__=='__main__': unittest.main()
