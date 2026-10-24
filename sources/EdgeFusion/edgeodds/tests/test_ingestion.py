"""Synthetic contracts and local HTTP tests. No real events or provider calls."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from io import BytesIO, StringIO
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from edgeodds.__main__ import main
from edgeodds.ingestion import IngestionStore
from edgeodds.read_api import build_handler
from edgeodds.sportradar import (
    EventBinding, FeedError, MAX_BODY, SportradarClient, decode, digest, normalize, response_metadata,
)

NOW = datetime(2030, 1, 2, 18, tzinfo=timezone.utc)
START = NOW + timedelta(hours=2)
TOKEN = 'synthetic-local-test-token-never-a-real-secret'


def binding():
    return EventBinding('fixture:nfl:one', 'sr:sport_event:900000001',
                        'fixture:home', 'fixture:away', 'sr:competitor:90001',
                        'sr:competitor:90002', START.isoformat(), 'fixture:reviewed-schedule-v1')


def payload():
    def market(mid, name, family):
        sides = ['over', 'under'] if family == 'total' else ['home', 'away']
        outcomes = []
        for index, side in enumerate(sides):
            row = {'id': f'sr:outcome:{index + 4}', 'type': side, 'odds_decimal': '1.91',
                   'external_outcome_id': f'fixture-{family}-{side}', 'removed': False}
            if family == 'spread':
                row['handicap'] = '-3.5' if side == 'home' else '3.5'
            if family == 'total':
                row['total'] = '42.5'
            outcomes.append(row)
        return {'id': mid, 'name': name, 'is_live': False, 'books': [
            {'id': 'sr:book:999999', 'name': 'Synthetic Test Book', 'removed': False,
             'external_market_id': f'fixture-{family}', 'external_sport_event_id': 'fixture-game',
             'outcomes': outcomes}]}
    return {'generated_at': NOW.isoformat(), 'sport_event': {
        'id': binding().source_event_id, 'start_time': START.isoformat(),
        'start_time_confirmed': True, 'status': 'not_started', 'competitors': [
            {'id': binding().source_home_id, 'name': 'Synthetic Home', 'qualifier': 'home'},
            {'id': binding().source_away_id, 'name': 'Synthetic Away', 'qualifier': 'away'}]},
        'markets': [market('sr:market:219', 'winner (incl. overtime)', 'moneyline'),
                    market('sr:market:223', 'handicap (incl. overtime)', 'spread'),
                    market('sr:market:225', 'total (incl. overtime)', 'total')]}


def raw(data=None):
    return json.dumps(data if data is not None else payload(), allow_nan=False).encode()


def normalized(data=None):
    return normalize(raw(data), binding(), NOW)


class NormalizationTests(unittest.TestCase):
    def test_three_core_markets(self):
        rows = normalized()['records']
        self.assertEqual(len(rows), 6)
        self.assertEqual({q['market'] for q in rows}, {'moneyline', 'spread', 'total'})
        self.assertEqual(rows[2]['line'], -3.5)
        self.assertEqual(rows[0]['selection'], 'fixture:home')

    def test_feed_generation_is_never_quote_update_time(self):
        data = payload()
        data['markets'][0]['books'][0]['outcomes'][0]['last_update'] = NOW.isoformat()
        self.assertTrue(all(q['source_updated_at'] is None for q in normalized(data)['records']))
        self.assertEqual(normalized()['records'][0]['timestamp_basis'], 'feed_generation_only')

    def test_wrong_event(self):
        data = payload(); data['sport_event']['id'] = 'sr:sport_event:2'
        with self.assertRaises(FeedError): normalized(data)

    def test_reversed_participants(self):
        data = payload(); data['sport_event']['competitors'].reverse()
        self.assertEqual(len(normalized(data)['records']), 6)
        data['sport_event']['competitors'][0]['qualifier'] = 'home'
        with self.assertRaises(FeedError): normalized(data)

    def test_changed_start(self):
        data = payload(); data['sport_event']['start_time'] = (START + timedelta(days=1)).isoformat()
        with self.assertRaises(FeedError): normalized(data)

    def test_reschedule_requires_reconciliation(self):
        data = payload(); data['sport_event']['replaced_by'] = 'sr:sport_event:2'
        with self.assertRaises(FeedError): normalized(data)

    def test_unsupported_league(self):
        with self.assertRaises(FeedError): replace(binding(), league='NBA')

    def test_future_generated_timestamp(self):
        data = payload(); data['generated_at'] = (NOW + timedelta(minutes=1)).isoformat()
        with self.assertRaises(FeedError): normalized(data)

    def test_timezone_equivalence(self):
        data = payload(); data['sport_event']['start_time'] = '2030-01-02T12:00:00-08:00'
        self.assertEqual(len(normalized(data)['records']), 6)

    def test_naive_timestamp(self):
        data = payload(); data['generated_at'] = '2030-01-02T18:00:00'
        with self.assertRaises(FeedError): normalized(data)

    def test_partial_period_name_not_silently_full_game(self):
        data = payload(); data['markets'][0]['name'] = '1st half winner'
        self.assertEqual(len(normalized(data)['records']), 4)

    def test_live_market_excluded(self):
        data = payload(); data['markets'][0]['is_live'] = True
        self.assertEqual(len(normalized(data)['records']), 4)

    def test_unknown_market_excluded(self):
        data = payload(); data['markets'][0]['id'] = 'sr:market:999999'
        self.assertEqual(len(normalized(data)['records']), 4)

    def test_book_removal_tombstone(self):
        data = payload(); data['markets'][0]['books'][0]['removed'] = True
        self.assertEqual(normalized(data)['records'][0]['status'], 'suspended')

    def test_outcome_removal_tombstone(self):
        data = payload(); data['markets'][0]['books'][0]['outcomes'][0]['removed'] = True
        self.assertEqual(normalized(data)['records'][0]['status'], 'suspended')

    def test_missing_and_string_false_flags_are_unknown(self):
        for value in (None, 'false', 0):
            data = payload(); data['markets'][0]['books'][0]['removed'] = value
            self.assertEqual(normalized(data)['records'][0]['status'], 'unknown')

    def test_price_one_is_not_a_valid_quote(self):
        data = payload(); data['markets'][0]['books'][0]['outcomes'][0]['odds_decimal'] = '1.00'
        row = normalized(data)['records'][0]
        self.assertIsNone(row['decimal_odds']); self.assertEqual(row['status'], 'suspended')

    def test_bad_prices_are_quarantined(self):
        for value in (True, '-110', 'NaN', 'Infinity', '1e308', None):
            data = payload(); data['markets'][0]['books'][0]['outcomes'][0]['odds_decimal'] = value
            self.assertIsNone(normalized(data)['records'][0]['decimal_odds'])

    def test_consensus_is_not_an_independent_book(self):
        data = payload(); data['markets'][0]['books'][0]['id'] = 'sr:book:25080'
        result = normalized(data)
        self.assertEqual(len(result['records']), 4)
        self.assertIn('AGGREGATED_CONSENSUS_NOT_A_BOOK', result['issues'])

    def test_alternate_lines_remain_distinct(self):
        data = payload(); alternate = payload()['markets'][1]
        alternate['books'][0]['outcomes'][0]['handicap'] = '-4.5'
        alternate['books'][0]['outcomes'][1]['handicap'] = '4.5'
        data['markets'].append(alternate)
        self.assertEqual(len(normalized(data)['records']), 8)

    def test_duplicate_outcomes_rejected(self):
        data = payload(); data['markets'].append(payload()['markets'][0])
        with self.assertRaises(FeedError): normalized(data)

    def test_negative_total_rejected(self):
        data = payload(); data['markets'][2]['books'][0]['outcomes'][0]['total'] = '-40.5'
        with self.assertRaises(FeedError): normalized(data)

    def test_line_disagreement_rejected(self):
        data = payload(); data['markets'][1]['books'][0]['outcomes'][0]['spread'] = -4.5
        with self.assertRaises(FeedError): normalized(data)

    def test_invalid_json_and_duplicate_keys(self):
        for content in (b'{"markets":[],"markets":[]}', b'[]', b'{"x":NaN}', b'{'):
            with self.assertRaises(FeedError): decode(content)

    def test_credential_bearing_mapping_reference_rejected(self):
        with self.assertRaises(FeedError): replace(binding(), source_ref='https://example.com/?api_key=secret')


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.store = IngestionStore(Path(self.tmp.name) / 'feed.sqlite3')
        self.store.ingest(raw(), binding(), retrieved_at=NOW)

    def tearDown(self):
        self.tmp.cleanup()

    def current(self, **kwargs):
        return self.store.current(binding().event_id, mode='fixture', now=NOW + timedelta(minutes=3), **kwargs)

    def later(self, data, seconds=60):
        when = NOW + timedelta(seconds=seconds)
        data['generated_at'] = when.isoformat()
        return self.store.ingest(raw(data), binding(), retrieved_at=when)

    def test_repoll_dedupes_state_but_records_observation(self):
        result = self.store.ingest(raw(), binding(), retrieved_at=NOW + timedelta(seconds=20))
        self.assertFalse(result['inserted'])
        self.assertEqual(len(self.store.history(binding().event_id, mode='fixture')['items']), 6)
        self.assertEqual(self.current()['last_received_at'], (NOW + timedelta(seconds=20)).isoformat())

    def test_later_removed_market_never_revives_old_open_quote(self):
        data = payload(); data['markets'][0]['books'][0]['removed'] = True
        self.later(data)
        self.assertEqual(self.current()['quotes'][0]['status'], 'suspended')

    def test_new_empty_board_replaces_previous_board(self):
        data = payload(); data['markets'] = []
        self.later(data)
        self.assertEqual(self.current()['quotes'], [])
        self.assertEqual(len(self.store.history(binding().event_id, mode='fixture')['items']), 6)

    def test_out_of_order_response_does_not_overwrite_newer(self):
        data = payload(); data['markets'][0]['books'][0]['outcomes'][0]['odds_decimal'] = '2.4'
        self.later(data, 60)
        self.store.ingest(raw(), binding(), retrieved_at=NOW + timedelta(seconds=120))
        self.assertEqual(self.current()['quotes'][0]['decimal_odds'], 2.4)

    def test_equal_provider_time_conflict_fails_closed(self):
        data = payload(); data['markets'][0]['books'][0]['outcomes'][0]['odds_decimal'] = '2.4'
        self.store.ingest(raw(data), binding(), retrieved_at=NOW)
        self.assertEqual(self.current()['data_status'], 'CONFLICT')
        self.assertEqual(self.current()['quotes'], [])

    def test_equivalent_whitespace_not_a_price_conflict(self):
        self.store.ingest(json.dumps(payload(), indent=2).encode(), binding(), retrieved_at=NOW)
        self.assertNotEqual(self.current()['data_status'], 'CONFLICT')

    def test_fixture_never_appears_as_network_data(self):
        self.assertEqual(self.store.current(binding().event_id, now=NOW)['data_status'], 'DATA_UNAVAILABLE')
        self.assertFalse(self.store.health()['live_verified'])

    def test_quote_clock_never_fabricated_in_edgeboard_view(self):
        board = self.store.edgeboard(binding().event_id, mode='fixture', now=NOW)
        for row in board['quotes']:
            self.assertIsNone(row['observed_at']); self.assertIsNone(row['ev_per_unit'])
            self.assertFalse(row['importable']); self.assertFalse(row['analysis_eligible'])
            self.assertIn('MODEL_UNAVAILABLE', row['exclusion_reasons'])

    def test_failed_refresh_preserves_history_and_marks_degraded(self):
        with self.assertRaises(FeedError): self.store.ingest(b'{', binding(), retrieved_at=NOW + timedelta(seconds=30))
        self.assertEqual(self.current()['data_status'], 'DEGRADED')
        self.assertEqual(len(self.current()['quotes']), 6)
        with self.store.connect() as db:
            self.assertIsNotNone(db.execute('SELECT hash FROM eo_raw WHERE hash=?', (digest(b'{'),)).fetchone())

    def test_stale_feed_does_not_become_fresh_on_refetch(self):
        self.store.ingest(raw(), binding(), retrieved_at=NOW + timedelta(hours=1))
        board = self.store.current(binding().event_id, mode='fixture', now=NOW + timedelta(hours=1))
        self.assertIn('FEED_SNAPSHOT_STALE', board['reasons'])

    def test_future_retrieval_is_blocked(self):
        self.store.ingest(raw(), binding(), retrieved_at=NOW + timedelta(hours=1))
        self.assertIn('FUTURE_OBSERVATION', self.current()['reasons'])

    def test_changed_canonical_mapping_is_rejected(self):
        with self.assertRaises(FeedError):
            self.store.ingest(raw(), replace(binding(), event_id='fixture:other'), retrieved_at=NOW)
        self.assertEqual(len(self.store.events(mode='fixture')), 1)

    def test_bounded_history_pagination(self):
        first = self.store.history(binding().event_id, mode='fixture', limit=2)
        second = self.store.history(binding().event_id, mode='fixture', limit=2, before_id=first['next_before_id'])
        self.assertTrue(set(r['history_id'] for r in first['items']).isdisjoint(r['history_id'] for r in second['items']))
        with self.assertRaises(FeedError): self.current(limit=0)
        with self.assertRaises(FeedError): self.current(limit=True)

    def test_archive_cannot_be_updated_through_sql(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.store.connect() as db: db.execute('UPDATE eo_raw SET body=?', (b'changed',))

    def test_concurrent_duplicate_ingestion_commits_once(self):
        data = payload(); data['generated_at'] = (NOW + timedelta(seconds=30)).isoformat()
        def ingest(_):
            return self.store.ingest(raw(data), binding(), retrieved_at=NOW + timedelta(seconds=30))['inserted']
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(ingest, range(4))), 1)


class FakeResponse(BytesIO):
    def __init__(self, body, headers=None):
        super().__init__(body); self.headers = headers or {}


class FakeOpener:
    def __init__(self, *responses): self.responses, self.requests = list(responses), []
    def open(self, request, timeout):
        self.requests.append(request)
        result = self.responses.pop(0)
        if isinstance(result, Exception): raise result
        return result


class TransportTests(unittest.TestCase):
    def test_missing_key(self):
        with self.assertRaisesRegex(FeedError, 'NOT_CONFIGURED'): SportradarClient('')

    def test_secret_stays_in_header_not_url_or_repr(self):
        opener = FakeOpener(FakeResponse(raw(), {'Date': 'test', 'Set-Cookie': TOKEN}))
        client = SportradarClient(TOKEN, opener=opener, clock=lambda: NOW)
        wire = client.markets(binding().source_event_id)
        self.assertNotIn(TOKEN, repr(client)); self.assertNotIn(TOKEN, wire.endpoint)
        self.assertEqual(opener.requests[0].get_header('X-api-key'), TOKEN)
        self.assertNotIn('set-cookie', wire.headers)

    def test_invalid_id_never_requests(self):
        opener = FakeOpener()
        with self.assertRaises(FeedError): SportradarClient(TOKEN, opener=opener).markets('../secrets')
        self.assertEqual(opener.requests, [])

    def test_auth_error_does_not_echo_upstream_details(self):
        opener = FakeOpener(HTTPError('https://api.sportradar.com', 403, TOKEN, {}, BytesIO(TOKEN.encode())))
        with self.assertRaisesRegex(FeedError, '^UPSTREAM_HTTP_403$'):
            SportradarClient(TOKEN, opener=opener).markets(binding().source_event_id)
        self.assertEqual(len(opener.requests), 1)

    def test_rate_limit_respects_retry_after(self):
        sleeps = []
        opener = FakeOpener(HTTPError('x', 429, 'rate', {'Retry-After': '3'}, BytesIO()), FakeResponse(raw()))
        SportradarClient(TOKEN, opener=opener, sleep=sleeps.append, clock=lambda: NOW).markets(binding().source_event_id)
        self.assertEqual(sleeps, [3])

    def test_long_retry_after_defers_instead_of_early_retry(self):
        opener = FakeOpener(HTTPError('x', 429, 'rate', {'Retry-After': '600'}, BytesIO()))
        with self.assertRaisesRegex(FeedError, 'RATE_LIMIT_RETRY_LATER'):
            SportradarClient(TOKEN, opener=opener, sleep=lambda _: self.fail()).markets(binding().source_event_id)

    def test_redirect_rejected(self):
        opener = FakeOpener(HTTPError('x', 302, 'redirect', {'Location': 'https://other.example'}, BytesIO()))
        with self.assertRaisesRegex(FeedError, 'UPSTREAM_HTTP_302'):
            SportradarClient(TOKEN, opener=opener).markets(binding().source_event_id)

    def test_network_retries_are_bounded_and_sanitized(self):
        opener = FakeOpener(*[URLError(TOKEN) for _ in range(3)])
        sleeps = []
        with self.assertRaisesRegex(FeedError, '^UPSTREAM_NETWORK_UNAVAILABLE$'):
            SportradarClient(TOKEN, opener=opener, sleep=sleeps.append).markets(binding().source_event_id)
        self.assertEqual(len(opener.requests), 3); self.assertEqual(sleeps, [1, 2])

    def test_credential_echo_rejected(self):
        opener = FakeOpener(FakeResponse(TOKEN.encode()))
        with self.assertRaisesRegex(FeedError, 'CREDENTIAL_ECHO_REJECTED'):
            SportradarClient(TOKEN, opener=opener).markets(binding().source_event_id)

    def test_oversized_body_rejected(self):
        opener = FakeOpener(FakeResponse(b'a' * (MAX_BODY + 1)))
        with self.assertRaises(FeedError): SportradarClient(TOKEN, opener=opener).markets(binding().source_event_id)

    def test_schedule_pagination_is_explicit(self):
        opener = FakeOpener(FakeResponse(b'{}'))
        wire = SportradarClient(TOKEN, opener=opener, clock=lambda: NOW).schedule('2030-01-02', start=50)
        self.assertIn('start=50&limit=50', wire.endpoint)

    def test_pagination_metadata_detects_next_page(self):
        opener = FakeOpener(FakeResponse(
            b'{}',
            {
                'X-Max-Results': '120',
                'X-Offset': '0',
                'X-Result': '50',
                'X-Origin-Id': 'MARKET_ORIGIN_MAGIC_CRAWLERS',
                'Cache-Control': 'public, max-age=60',
            },
        ))
        wire = SportradarClient(TOKEN, opener=opener, clock=lambda: NOW).schedule('2030-01-02')
        meta = wire.metadata(requested_start=0, requested_limit=50)
        self.assertEqual(meta.origin_tier, 'oc_us')
        self.assertEqual(meta.cache_ttl_seconds, 60)
        self.assertFalse(meta.pagination.complete)
        self.assertEqual(meta.pagination.next_start, 50)

    def test_pagination_metadata_detects_complete_page(self):
        meta = response_metadata(
            {'x-max-results': '35', 'x-offset': '0', 'x-result': '35'},
            requested_start=0,
            requested_limit=50,
        )
        self.assertTrue(meta.pagination.complete)
        self.assertIsNone(meta.pagination.next_start)

    def test_partial_pagination_headers_fail_closed(self):
        with self.assertRaisesRegex(FeedError, 'INCOMPLETE_PAGINATION_HEADERS'):
            response_metadata({'x-max-results': '100', 'x-result': '50'})

    def test_pagination_offset_mismatch_fails_closed(self):
        with self.assertRaisesRegex(FeedError, 'PAGINATION_OFFSET_MISMATCH'):
            response_metadata(
                {'x-max-results': '100', 'x-offset': '50', 'x-result': '50'},
                requested_start=0,
                requested_limit=50,
            )

    def test_stalled_pagination_fails_closed(self):
        with self.assertRaisesRegex(FeedError, 'PAGINATION_STALLED'):
            response_metadata(
                {'x-max-results': '100', 'x-offset': '0', 'x-result': '0'},
                requested_start=0,
                requested_limit=50,
            )

    def test_origin_tier_is_observed_not_assumed(self):
        self.assertEqual(
            response_metadata({'x-origin-id': 'MARKET_ORIGIN_CORE_CRAWLERS'}).origin_tier,
            'oc_core',
        )
        self.assertEqual(response_metadata({}).origin_tier, 'unknown')
        self.assertEqual(response_metadata({'x-origin-id': 'future-tier'}).origin_tier, 'unrecognized')


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = TemporaryDirectory()
        cls.store = IngestionStore(Path(cls.tmp.name) / 'feed.sqlite3')
        cls.store.ingest(raw(), binding(), retrieved_at=NOW)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), build_handler(cls.store, TOKEN))
        cls.worker = Thread(target=cls.server.serve_forever, daemon=True); cls.worker.start()
        cls.url = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.worker.join(); cls.tmp.cleanup()

    def request(self, path, *, auth=TOKEN, method='GET'):
        request = Request(self.url + path, method=method,
                          headers={'Authorization': 'Bearer ' + auth} if auth else {})
        try: response = urlopen(request, timeout=3)
        except HTTPError as exc: response = exc
        with response: return response.status, json.loads(response.read()), dict(response.headers)

    def test_no_auth(self): self.assertEqual(self.request('/v1/health', auth=None)[0], 401)
    def test_wrong_auth(self): self.assertEqual(self.request('/v1/health', auth='wrong')[0], 401)
    def test_health(self):
        status, body, headers = self.request('/v1/health')
        self.assertEqual(status, 200); self.assertFalse(body['live_verified'])
        self.assertEqual(headers['Cache-Control'], 'no-store')
    def test_events(self):
        self.assertEqual(len(self.request('/v1/events?mode=fixture')[1]['events']), 1)
    def test_network_is_empty(self):
        self.assertEqual(self.request('/v1/odds?event_id=fixture:nfl:one')[1]['data_status'], 'DATA_UNAVAILABLE')
    def test_edgeboard_read_view(self):
        body = self.request('/v1/edgeboard?event_id=fixture:nfl:one&mode=fixture')[1]
        self.assertEqual(body['schema'], 'edgeodds.edgeboard.v1')
        self.assertTrue(body['read_only'])
        self.assertEqual(body['execution'], 'DISABLED')
        self.assertTrue(all(not q['analysis']['eligible'] for q in body['quotes']))
        self.assertTrue(all(q['timestamps']['quote_updated_at'] is None for q in body['quotes']))
        self.assertNotIn(TOKEN, json.dumps(body))
    def test_no_writes_or_execution(self):
        self.assertEqual(self.request('/v1/orders', method='POST')[0], 405)
    def test_bad_query(self):
        for path in ('/v1/events?limit=0', '/v1/events?mode=fixture&mode=network', '/v1/history', '/v1/events?api_key=x'):
            self.assertEqual(self.request(path)[0], 400)
    def test_raw_archive_is_not_exposed(self): self.assertEqual(self.request('/v1/raw')[0], 404)
    def test_requires_strong_server_token(self):
        with self.assertRaises(FeedError): build_handler(self.store, 'short')


class CliTests(unittest.TestCase):
    def test_empty_runtime_reports_not_configured(self):
        with TemporaryDirectory() as tmp, patch.dict('os.environ', {}, clear=True), redirect_stdout(StringIO()) as out:
            result = main(['status', '--db', str(Path(tmp) / 'db')])
            self.assertEqual(result, 0)
            self.assertEqual(json.loads(out.getvalue())['connector_status'], 'NOT_CONFIGURED')

    def test_replay_is_explicitly_fixture_mode(self):
        from dataclasses import asdict
        with TemporaryDirectory() as tmp, redirect_stdout(StringIO()) as out:
            p = Path(tmp); (p / 'mapping').write_text(json.dumps(asdict(binding())))
            (p / 'response').write_bytes(raw())
            result = main(['replay', '--db', str(p / 'db'), '--mapping', str(p / 'mapping'),
                           '--input', str(p / 'response'), '--at', NOW.isoformat()])
            self.assertEqual(result, 0)
            self.assertEqual(json.loads(out.getvalue())['mode'], 'fixture')


if __name__ == '__main__':
    unittest.main()
