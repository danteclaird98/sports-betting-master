import copy,json,tempfile,unittest
from pathlib import Path
from app import Workspace
from integrations.adapters import convert,american,fetch_sgo
from integrations.movements import significant_moves

class IntegrationTests(unittest.TestCase):
    def sgo(self):
        return {'data':[{'eventID':'e1','leagueID':'NBA','teams':{'home':{'names':{'long':'Home'}},'away':{'names':{'long':'Away'}}},'status':{'startsAt':'2027-01-01T00:00:00Z'},'odds':{
            'points-away-game-sp-away':{'betTypeID':'sp','sideID':'away','statEntityID':'away','statID':'points','periodID':'game','byBookmaker':{'book':{'odds':'-110','spread':'0','available':True,'lastUpdatedAt':'2026-10-24T00:00:00Z'}}}}}]}
    def test_sgo_preserves_zero_line_time_and_availability(self):
        payload=self.sgo();r=convert('sportsgameodds',payload)['quotes'][0]
        self.assertEqual(r['line'],0);self.assertEqual(r['rules'],'unknown');self.assertEqual(r['selection'],'Away')
        self.assertEqual(r['event_id'],'sportsgameodds:e1');self.assertAlmostEqual(r['decimal_price'],1+100/110)
        payload['data'][0]['odds']['points-away-game-sp-away']['byBookmaker']['book']['available']=False
        self.assertEqual(convert('sportsgameodds',payload)['quotes'][0]['status'],'suspended')
    def test_props_never_masquerade_as_game_totals(self):
        payload=self.sgo();odd=payload['data'][0]['odds']['points-away-game-sp-away'];odd['playerID']='player-1'
        with self.assertRaisesRegex(ValueError,'No supported quotes'):convert('sportsgameodds',payload)
    def test_harvester_actual_fixture_retains_period_no_fabricated_source_clock(self):
        payload=json.loads(Path('tests/fixtures/oddsharvester-quarter.json').read_text())
        r=convert('oddsharvester',payload)
        self.assertEqual(len(r['quotes']),4)
        self.assertTrue(all(q['period']=='FirstQuarter' and q['updated_at'] is None for q in r['quotes']))
        payload[0]['home_away_market'][0]['blocked_outcomes']=['1']
        self.assertEqual(convert('oddsharvester',payload)['quotes'][0]['status'],'suspended')
    def test_odds_api_and_edgeboard_contract(self):
        events=[dict(id='one',away_team='Away',home_team='Home',sport_title='NBA',commence_time='2027-01-01T00:00:00Z',bookmakers=[dict(key='book',last_update='2026-10-24T00:00:00Z',markets=[dict(key='h2h',outcomes=[dict(name='Home',price=-110)])])])]
        q=convert('the-odds-api',events,{'odds_format':'american'})['quotes'][0]
        self.assertAlmostEqual(q['decimal_price'],american(-110))
        from edgeodds.integrations.edgeboard import edgeboard_contract
        contract=edgeboard_contract(dict(event_id='e1',event=dict(league='NBA',starts_at='2027-01-01T00:00:00Z'),quotes=[dict(provider='manual',sportsbook='book',market='moneyline',selection='Away',line=None,period='full_game',rules='unknown',decimal_odds=2,retrieved_at='2026-10-24T00:00:01Z',source_updated_at='2026-10-24T00:00:00Z',status='open')]))
        q=convert('edgeboard',contract)['quotes'][0]
        self.assertEqual(q['selection'],'Away');self.assertEqual(q['rules'],'unknown')
    def test_provider_clocks_normalize_utc_without_mutating_payload(self):
        payload = self.sgo()
        payload['data'][0]['status']['startsAt'] = '2027-01-01T02:00:00+02:00'
        payload['data'][0]['odds']['points-away-game-sp-away']['byBookmaker']['book']['lastUpdatedAt'] = '2026-10-24T02:00:00+02:00'
        original = copy.deepcopy(payload)
        quote = convert('sportsgameodds', payload, {'retrieved_at':'2026-10-24T02:00:01+02:00'})['quotes'][0]
        self.assertEqual(payload, original)
        self.assertEqual(quote['starts_at'], '2027-01-01T00:00:00+00:00')
        self.assertEqual(quote['retrieved_at'], '2026-10-24T00:00:01+00:00')
        self.assertEqual(quote['updated_at'], '2026-10-24T00:00:00+00:00')

    def test_edgeboard_updated_clock_uses_same_timezone_validation(self):
        from edgeodds.integrations.edgeboard import edgeboard_contract
        contract = edgeboard_contract(dict(event_id='e1', event=dict(league='NBA', starts_at='2027-01-01T00:00:00Z'), quotes=[dict(provider='manual', sportsbook='book', market='moneyline', selection='Away', line=None, period='full_game', rules='unknown', decimal_odds=2, retrieved_at='2026-10-24T00:00:01Z', source_updated_at='2026-10-24T00:00:00Z', status='open')]))
        contract['quotes'][0]['timestamps']['quote_updated_at'] = '2026-10-24T02:00:00+02:00'
        original = copy.deepcopy(contract)
        self.assertEqual(convert('edgeboard', contract)['quotes'][0]['updated_at'], '2026-10-24T00:00:00+00:00')
        self.assertEqual(contract, original)
        contract['quotes'][0]['timestamps']['quote_updated_at'] = None
        self.assertIsNone(convert('edgeboard', contract)['quotes'][0]['updated_at'])
        contract['quotes'][0]['timestamps']['quote_updated_at'] = '2026-10-24T00:00:00'
        with self.assertRaisesRegex(ValueError, 'explicit timezone'):
            convert('edgeboard', contract)

    def test_movements_zero_line_and_conflict_handling(self):
        q=convert('sportsgameodds',self.sgo())['quotes'][0]
        nextq=dict(q,line=.5,updated_at='2026-10-24T00:01:00Z')
        self.assertEqual(significant_moves([q,nextq])[0]['line_change'],.5)
        conflict=dict(nextq,line=1)
        self.assertEqual(significant_moves([q,nextq,conflict]),[])
    def test_missing_key_and_atomic_import(self):
        import unittest.mock
        with unittest.mock.patch.dict('os.environ',{},clear=True):
            with self.assertRaisesRegex(ValueError,'not configured'):fetch_sgo('NBA')
        with tempfile.TemporaryDirectory() as d:
            ws=Workspace(Path(d)/'db')
            result=ws.import_provider(dict(format='sportsgameodds',payload=self.sgo()))
            self.assertEqual(result['imported'],1)
            self.assertEqual(ws.state()['summary']['snapshots'],1)

if __name__=='__main__':unittest.main()
