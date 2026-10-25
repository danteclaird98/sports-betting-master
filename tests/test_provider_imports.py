import copy
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from integrations.provider_imports import ProviderImports


def quote(**changes):
    row = dict(provider='fixture', event_id='fixture:123', event='Away @ Home', league='NFL', bookmaker='example', selection='Home', period='full_game', rules='unknown', market='spread', line=0, decimal_price=1.91, starts_at='2026-10-26T12:00:00-07:00', retrieved_at='2026-10-25T12:00:00-07:00', updated_at=None, source_market_id='native-spread', status='open')
    row.update(changes)
    return row


def payload(rows=None, request_id='request_001'):
    return dict(request_id=request_id, format='normalized', payload=rows or [quote()])


class ProviderImportsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'workspace.sqlite3'
        self.store = ProviderImports(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_replay_restart_and_changed_payload(self):
        receipt = self.store.import_payload(payload())
        self.assertEqual(receipt, ProviderImports(self.path).import_payload(payload()))
        with self.assertRaises(ValueError):
            self.store.import_payload(payload([quote(decimal_price=2.1)]))
        self.assertEqual(self.store.summary()['observation_count'], 1)
        self.assertFalse(receipt['execution_enabled'])

    def test_new_request_same_payload_does_not_duplicate(self):
        original = self.store.import_payload(payload())
        duplicate = self.store.import_payload(payload(request_id='request_002'))
        self.assertEqual(duplicate['duplicate_of'], original['request_id'])
        self.assertEqual(duplicate['imported'], 0)
        self.assertEqual(self.store.summary()['observation_count'], 1)
        self.assertEqual(duplicate, self.store.import_payload(payload(request_id='request_002')))

    def test_concurrent_duplicate(self):
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: ProviderImports(self.path).import_payload(payload()), range(12)))
        self.assertTrue(all(row == results[0] for row in results))
        self.assertEqual(self.store.summary()['observation_count'], 1)

    def test_atomic_invalid_and_immutable(self):
        with self.assertRaises(ValueError):
            self.store.import_payload(payload([quote(), quote(decimal_price=True)]))
        self.assertEqual(self.store.summary()['observation_count'], 0)
        self.store.import_payload(payload())
        with sqlite3.connect(self.path) as db:
            for table in ('provider_import_receipts', 'provider_import_observations'):
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute('DELETE FROM '+table)

    def test_clocks_are_distinct_utc_and_not_fabricated(self):
        self.store.import_payload(payload())
        row = self.store.summary()['observations'][0]
        self.assertEqual(row['starts_at'], '2026-10-26T19:00:00+00:00')
        self.assertEqual(row['retrieved_at'], '2026-10-25T19:00:00+00:00')
        self.assertIsNone(row['updated_at'])
        self.assertEqual(row['verification'], 'UNVERIFIED')
        self.assertFalse(row['eligible_for_ev'])
        self.assertEqual(self.store.summary()['movements'], [])

    def test_movement_identity_and_conflicts(self):
        rows = [quote(updated_at='2026-10-25T19:00:00Z'), quote(updated_at='2026-10-25T19:01:00Z', line=.5)]
        self.store.import_payload(payload(rows))
        move = self.store.summary()['movements'][0]
        self.assertEqual(move['line_change'], .5)
        self.assertEqual(move['source_market_id'], 'native-spread')
        self.assertEqual(move['rules'], 'unknown')
        self.store.import_payload(payload([quote(updated_at='2026-10-25T19:01:00Z', line=1)], 'request_002'))
        self.assertEqual(self.store.summary()['movements'], [])

    def test_no_cross_identity_comparison(self):
        for field in ('provider','event_id','source_market_id','bookmaker','selection','period','rules'):
            with self.subTest(field=field):
                path = Path(self.temp.name)/(field+'.sqlite3')
                store = ProviderImports(path)
                store.import_payload(payload([quote(updated_at='2026-10-25T19:00:00Z'), quote(**{field:'different'}, updated_at='2026-10-25T19:01:00Z', line=1)]))
                self.assertEqual(store.summary()['movements'], [])

    def test_validation_bounds_and_sensitive_inputs(self):
        cases = [payload([quote(line=True)]), payload([quote(decimal_price=float('nan'))]), payload([quote(starts_at='2026-10-25T19:00:00')]), payload([quote(api_key='private')]), payload([quote(event='Bearer secret123')]), payload([quote()]*501), payload(request_id='bad'), payload([quote(decimal_price=1)])]
        for data in cases:
            with self.subTest(data_type=str(type(data))):
                with self.assertRaises(ValueError):
                    self.store.import_payload(data)
        self.assertEqual(self.store.summary()['observation_count'], 0)

    def test_realistic_odds_api_fixture(self):
        raw = [dict(id='game1',home_team='Home',away_team='Away',sport_title='NFL',commence_time='2026-10-26T19:00:00Z',bookmakers=[dict(key='fixture-book',markets=[dict(key='spreads',outcomes=[dict(name='Home',price=-110,point=0)])])])]
        data = dict(request_id='odds_api_001',format='the-odds-api',payload=raw,options={'odds_format':'american','retrieved_at':'2026-10-25T19:00:00Z'})
        self.store.import_payload(data)
        row = self.store.summary()['observations'][0]
        self.assertAlmostEqual(row['decimal_price'], 1+100/110)
        self.assertEqual(row['line'],0)
        self.assertIsNone(row['updated_at'])
        raw[0]['bookmakers'][0]['markets'][0]['outcomes'][0]['price']=True
        data['request_id']='odds_api_002'
        with self.assertRaises(ValueError):self.store.import_payload(data)

    def test_connections_close_on_success_replay_and_failure(self):
        connections = []
        connect = sqlite3.connect
        def track(*args, **kwargs):
            db = connect(*args, **kwargs)
            connections.append(db)
            return db
        with patch('integrations.provider_imports.sqlite3.connect', side_effect=track):
            store = ProviderImports(self.path)
            store.import_payload(payload())
            store.import_payload(payload())
            with self.assertRaises(ValueError):
                store.import_payload(payload([quote(line=1)]))
            store.summary()
        self.assertEqual(len(connections), 5)
        for db in connections:
            with self.assertRaises(sqlite3.ProgrammingError):
                db.execute('SELECT 1')

    def test_huge_json_integer_rejected_without_overflow(self):
        data = payload([quote(line=10**1000)])
        with self.assertRaises(ValueError):
            self.store.import_payload(data)
        self.assertEqual(self.store.summary()['observation_count'], 0)

    def test_summary_bounds(self):
        self.store.import_payload(payload([quote() for _ in range(110)]))
        self.assertEqual(len(self.store.summary()['observations']),100)
        self.assertEqual(self.store.summary()['observation_count'],110)


if __name__ == '__main__':
    unittest.main()
