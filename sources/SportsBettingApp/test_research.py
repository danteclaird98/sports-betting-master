import unittest
from research import *
class Controls(unittest.TestCase):
 def test_scoring(self):
  s=score([.5,.5],[0,1]); self.assertEqual(s["brier"],.25); self.assertAlmostEqual(s["log_loss"],math.log(2))
 def test_devig(self): self.assertEqual(fair(1.91,1.91),.5)
 def test_bad_odds(self):
  for x in (1,0,float("nan")):
   with self.assertRaises(ValueError): implied(x)
 def test_clv_matching(self): self.assertIsNone(clv(2,2,2,"over 7","over 7.5"))
 def test_clv(self): self.assertAlmostEqual(clv(2.1,2,2,"a","a"),.05)
 def test_settlement(self):
  self.assertEqual(settlement("win",10,2,3,True)["profit"],3)
  self.assertEqual(settlement("loss",10,2,3,False)["profit"],0)
  self.assertEqual(settlement("void",10,2,3,True)["profit"],0)
 def test_time(self):
  with self.assertRaises(ValueError): time("2026-01-01")
 def test_split_future(self):
  with self.assertRaises(ValueError): partition([dict(event_id="a",decision_at="2025-01-01T00:00:00Z",feature_available_at="2025-01-02T00:00:00Z",model_trained_through="2024-01-01T00:00:00Z")],"2025-02-01T00:00:00Z","2025-03-01T00:00:00Z")
 def fixture(self):
  return dict(event_id="demo",market_key="demo binary",book="fixture",decision_at="2026-01-01T00:01:00Z",odds_at="2026-01-01T00:00:00Z",feature_available_at="2026-01-01T00:00:00Z",decimal_odds=2,probability=.6,probability_low=.55,probability_high=.65,market_type="binary_no_push",uncertainty_validated=True,**{k:True for k in ("event_verified","market_verified","source_verified","rules_verified","price_available")})
 def test_pass(self): self.assertEqual(result(self.fixture())["status"],"PASSES_RESEARCH")
 def test_stale(self):
  r=self.fixture();r["odds_at"]="2025-12-31T00:00:00Z";self.assertIn("stale or future quote",result(r)["reasons_to_abstain"])
 def test_uncertainty(self):
  r=self.fixture();r["probability_low"]=.4;self.assertEqual(result(r)["status"],"ABSTAIN")
 def test_parlay(self):
  r=self.fixture();r["parlay"]=True;self.assertEqual(result(r)["status"],"ABSTAIN")
if __name__=="__main__": unittest.main()
