import copy
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from app import Workspace


class CanonicalEventTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = Workspace(Path(self.tmp.name)/'quotes.db')
        self.now = datetime.now(timezone.utc)
        self.row = dict(event_id='native-1', event='Away @ Home', league='NBA',
                        provider='one', bookmaker='book-one', selection='Away',
                        market='moneyline', line=None, period='full_game', rules='rules-v1',
                        starts_at=(self.now+timedelta(days=1)).isoformat(),
                        updated_at=(self.now-timedelta(seconds=1)).isoformat(),
                        retrieved_at=self.now.isoformat(), decimal_price=2, status='open')

    def tearDown(self):
        self.tmp.cleanup()

    def counts(self):
        with self.ws.connect() as db:
            return tuple(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in
                         ('quotes','canonical_events','provider_event_bindings','quote_capture_observations'))

    def shifted(self, minutes, **changes):
        return dict(self.row, starts_at=(datetime.fromisoformat(self.row['starts_at'])+timedelta(minutes=minutes)).isoformat(), **changes)

    def test_two_providers_books_one_event_repolls_append_observations(self):
        second = self.shifted(20, provider='two', bookmaker='book-two', event_id='external-2',
                              event='  ＡＷＡＹ  @  HOME ', league=' nba ', selection='Ａｗａｙ', decimal_price=2.2)
        second['starts_at'] = datetime.fromisoformat(second['starts_at']).astimezone(timezone(timedelta(hours=-7))).isoformat()
        original = copy.deepcopy(second)
        self.ws.ingest([self.row, second])
        state = self.ws.state()
        self.assertEqual(state['summary']['canonical_events'], 1)
        self.assertEqual(state['summary']['capture_observations'], 2)
        self.assertEqual(len(state['markets']), 1)
        self.assertEqual(state['markets'][0]['best_book'], 'book-two')
        quotes = state['markets'][0]['quotes']
        self.assertEqual({q['selection'] for q in quotes}, {'away'})
        self.assertEqual({q['original_event_id'] for q in quotes}, {'native-1','external-2'})
        self.assertEqual(second, original)
        self.assertEqual(self.counts(), (2,1,2,2))
        result = self.ws.ingest([self.row, second])
        self.assertEqual(result['imported'], 0)
        self.assertEqual(result['observations'], 2)
        self.assertEqual(self.counts(), (2,1,2,4))
        with self.ws.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(DISTINCT capture_id) FROM quote_capture_observations').fetchone()[0], 2)

    def test_anchor_window_inclusive_and_no_chain_drift(self):
        self.ws.ingest([self.row])
        self.ws.ingest([self.shifted(30, provider='two')])
        self.assertEqual(self.counts()[1], 1)
        self.ws.ingest([self.shifted(60, provider='three')])
        self.assertEqual(self.counts()[1], 2)
        # 30 minutes from both immutable anchors is ambiguous.
        before = self.counts()
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS'):
            self.ws.ingest([self.shifted(30, provider='four')])
        self.assertEqual(self.counts(), before)

    def test_outside_thirty_minutes_is_distinct(self):
        self.ws.ingest([self.row, self.shifted(30+1/60, provider='two')])
        self.assertEqual(self.counts()[1], 2)

    def test_collision_and_ambiguous_batch_roll_back_every_table(self):
        self.ws.ingest([self.row])
        for changed in (self.shifted(31), dict(self.row, event='Other @ Home'),
                        dict(self.row, event='Home @ Away'), dict(self.row, event='Unparseable')):
            before = self.counts()
            with self.assertRaisesRegex(ValueError, 'BINDING_IDENTITY_CHANGED'):
                self.ws.ingest([dict(self.row, provider='new-provider'), changed])
            self.assertEqual(self.counts(), before)
        self.ws.ingest([self.shifted(60, provider='doubleheader')])
        before = self.counts()
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS'):
            self.ws.ingest([dict(self.row, provider='new-provider'), self.shifted(30, provider='unclear')])
        self.assertEqual(self.counts(), before)

    def test_binding_time_compares_original_anchor_not_last_observation(self):
        self.ws.ingest([self.row])
        self.ws.ingest([self.shifted(30)])
        with self.assertRaisesRegex(ValueError, 'BINDING_IDENTITY_CHANGED'):
            self.ws.ingest([self.shifted(60)])
        self.assertEqual(self.counts()[1], 1)

    def test_explicit_names_supported_no_aliases_or_home_away_guess(self):
        self.ws.ingest([dict(self.row, event='Display title', home_team='Home', away_team='Away')])
        self.ws.ingest([dict(self.row, provider='two', event='Away @ Home')])
        self.assertEqual(self.counts()[1], 1)
        self.ws.ingest([dict(self.row, provider='three', event='AWY @ Home')])
        self.assertEqual(self.counts()[1], 2)
        self.ws.ingest([dict(self.row, provider='four', event='Home @ Away')])
        self.assertEqual(self.counts()[1], 3)

    def test_legacy_and_unparseable_remain_unmapped_reads_preserve_bytes(self):
        raw = json.dumps(self.row)
        with self.ws.connect() as db:
            db.execute('INSERT INTO quotes(hash,body) VALUES (?,?)', ('legacy',raw))
        self.ws.ingest([dict(self.row, provider='unknown', event='Away vs Home')])
        before = self.counts()
        with self.ws.connect() as db:
            evidence = db.execute('SELECT * FROM quotes').fetchall()
        state = self.ws.state()
        self.assertTrue(all(q['canonical_event_id'] is None and q['identity_status'].startswith('UNMAPPED')
                            for market in state['markets'] for q in market['quotes']))
        self.assertTrue(all(market['best_book'] is None for market in state['markets']))
        self.assertEqual(state['summary']['unmapped_quotes'], 2)
        self.assertEqual(before, (2,0,0,1))
        self.assertEqual(self.counts(), before)
        with self.ws.connect() as db:
            self.assertEqual(db.execute('SELECT * FROM quotes').fetchall(), evidence)

    def test_different_external_ids_from_same_book_are_ambiguous(self):
        self.ws.ingest([self.row])
        before = self.counts()
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS_PROVIDER_EVENT_IDS'):
            self.ws.ingest([dict(self.row, event_id='possible-doubleheader')])
        self.assertEqual(self.counts(), before)

    def test_explicit_venue_and_neutral_metadata_must_match(self):
        self.ws.ingest([dict(self.row, venue_id='Arena A', neutral_site=False)])
        self.ws.ingest([dict(self.row, provider='two', venue_id=' arena a ', neutral_site=False)])
        self.assertEqual(self.counts()[1], 1)
        for extra in ({'venue_id':'Arena B','neutral_site':False},
                      {'venue_id':'Arena A','neutral_site':True}, {}):
            with self.assertRaisesRegex(ValueError, 'BINDING_IDENTITY_CHANGED'):
                self.ws.ingest([dict(self.row, **extra)])
        self.ws.ingest([dict(self.row, provider='three', venue_id='Arena B', neutral_site=False)])
        self.assertEqual(self.counts()[1], 2)
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS_EVENT_VENUE_OR_SITE'):
            self.ws.ingest([dict(self.row, provider='missing-venue')])

    def test_metadata_raw_replace_and_upsert_preserve_original_rows(self):
        self.ws.ingest([self.row])
        for table in ('quotes','canonical_events','provider_event_bindings','quote_capture_observations'):
            with sqlite3.connect(self.ws.path) as db:
                columns = [r[1] for r in db.execute('PRAGMA table_info('+table+')')]
                original = db.execute('SELECT * FROM '+table).fetchone()
                marks = ','.join('?' for _ in original)
                for sql in ('INSERT OR REPLACE INTO '+table+' VALUES('+marks+')',
                            'INSERT INTO '+table+' VALUES('+marks+') ON CONFLICT DO UPDATE SET '+columns[-1]+'=excluded.'+columns[-1]):
                    with self.assertRaisesRegex(Exception, 'append-only'):
                        db.execute(sql, original)
                    self.assertEqual(db.execute('SELECT * FROM '+table).fetchone(), original)

    def test_capture_quote_cannot_be_mutated_from_separate_connection(self):
        self.ws.ingest([self.row])
        with sqlite3.connect(self.ws.path) as db:
            original = db.execute('SELECT * FROM quotes').fetchone()
            for sql, args in (("UPDATE quotes SET body='{}'", ()),
                              ('DELETE FROM quotes', ()),
                              ('INSERT OR REPLACE INTO quotes(hash,body) VALUES (?,?)', (original[1], '{}'))):
                with self.assertRaisesRegex(sqlite3.IntegrityError, 'append-only'):
                    db.execute(sql, args)
                self.assertEqual(db.execute('SELECT * FROM quotes').fetchone(), original)

    def test_metadata_append_only(self):
        self.ws.ingest([self.row])
        for table in ('quotes','canonical_events','provider_event_bindings','quote_capture_observations'):
            with self.ws.connect() as db:
                with self.assertRaisesRegex(Exception, 'append-only'):
                    db.execute('DELETE FROM '+table)


if __name__ == '__main__':
    unittest.main()
