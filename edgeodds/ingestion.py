"""Transactional raw-response archive and read model for EdgeOdds.

Uses new eo_* tables in the existing SQLite option; no old tables are deleted.
Current quotes come from one complete latest provider snapshot, never a union
of old open prices. Raw responses are private and never returned by the API.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timezone
import os
import json
from pathlib import Path
import sqlite3

from .sportradar import EventBinding, FeedError, MAX_BODY, PROVIDER, digest, encode, normalize, stamp

SCHEMA = '''
CREATE TABLE IF NOT EXISTS eo_raw (
    hash TEXT PRIMARY KEY, body BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS eo_bindings (
    mode TEXT NOT NULL, source_event_id TEXT NOT NULL, event_id TEXT NOT NULL,
    identity TEXT NOT NULL,
    PRIMARY KEY(mode,source_event_id), UNIQUE(mode,event_id)
);
CREATE TABLE IF NOT EXISTS eo_batches (
    id INTEGER PRIMARY KEY, mode TEXT NOT NULL, event_id TEXT NOT NULL,
    raw_hash TEXT NOT NULL REFERENCES eo_raw(hash), source_epoch REAL NOT NULL,
    received_epoch REAL NOT NULL, state_hash TEXT NOT NULL, meta TEXT NOT NULL,
    UNIQUE(mode,event_id,raw_hash)
);
CREATE TABLE IF NOT EXISTS eo_quotes (
    id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES eo_batches(id),
    body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eo_observations (
    id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES eo_batches(id),
    received_epoch REAL NOT NULL, UNIQUE(batch_id,received_epoch)
);
CREATE TABLE IF NOT EXISTS eo_attempts (
    id INTEGER PRIMARY KEY, mode TEXT NOT NULL, event_id TEXT NOT NULL,
    at_epoch REAL NOT NULL, code TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS eo_latest ON eo_batches(mode,event_id,source_epoch DESC);
CREATE INDEX IF NOT EXISTS eo_quote_batch ON eo_quotes(batch_id,id);
CREATE INDEX IF NOT EXISTS eo_attempt_event ON eo_attempts(mode,event_id,at_epoch DESC,id DESC);
'''


def bounded(value: int, ceiling: int) -> int:
    if type(value) is not int or not 1 <= value <= ceiling:
        raise FeedError('INVALID_LIMIT')
    return value


def mode_check(mode: str) -> None:
    if mode not in ('fixture', 'network'):
        raise FeedError('INVALID_CAPTURE_MODE')


class IngestionStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path == ':memory:':
            raise FeedError('FILE_DATABASE_REQUIRED')
        target = Path(path)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
        except FileExistsError:
            pass
        with self.connect() as db:
            db.executescript(SCHEMA)
            for table in ('eo_raw', 'eo_bindings', 'eo_batches', 'eo_quotes', 'eo_observations', 'eo_attempts'):
                for action in ('UPDATE', 'DELETE'):
                    db.execute(f'''CREATE TRIGGER IF NOT EXISTS {table}_no_{action.lower()}
                        BEFORE {action} ON {table} BEGIN
                        SELECT RAISE(ABORT, 'append-only EdgeOdds evidence'); END''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def failure(self, binding: EventBinding, *, at: datetime, mode: str, code: str):
        mode_check(mode)
        # Error descriptions, bodies and credentials never enter operational history.
        allowed = {'NOT_CONFIGURED', 'UPSTREAM_NETWORK_UNAVAILABLE', 'RATE_LIMIT_RETRY_LATER',
                   'UPSTREAM_UNAVAILABLE', 'INGEST_REJECTED', 'CAPTURE_REJECTED'}
        if code not in allowed and code not in {f'UPSTREAM_HTTP_{n}' for n in (400, 401, 403, 404, 429, 500, 502, 503, 504)}:
            code = 'CAPTURE_REJECTED'
        with self.connect() as db:
            db.execute('INSERT INTO eo_attempts(mode,event_id,at_epoch,code) VALUES(?,?,?,?)',
                       (mode, binding.event_id, stamp(at).timestamp(), code))

    def ingest(self, raw: bytes, binding: EventBinding, *, retrieved_at: datetime, mode: str = 'fixture') -> dict:
        mode_check(mode)
        received = stamp(retrieved_at)
        if not isinstance(raw, bytes) or len(raw) > MAX_BODY:
            raise FeedError('BODY_TOO_LARGE_OR_INVALID')
        raw_hash = digest(raw)
        # Preserve rejected provider evidence, but never archive HTTP error responses.
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO eo_raw VALUES(?,?)', (raw_hash, raw))
        try:
            batch = normalize(raw, binding, received)
            identity = asdict(binding)
            identity.pop('source_ref')  # A new citation cannot change event identity.
            binding_json = encode(identity)
            records = batch.pop('records')
            semantic = [{k: v for k, v in r.items() if k not in ('retrieved_at', 'raw_sha256')}
                        for r in records]
            state_hash = digest(encode({'event': identity, 'records': semantic,
                                        'issues': batch['issues'], 'status': batch['event_status']}).encode())
            with self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                prior = db.execute('SELECT * FROM eo_bindings WHERE mode=? AND (source_event_id=? OR event_id=?)',
                                   (mode, binding.source_event_id, binding.event_id)).fetchall()
                if any(r['identity'] != binding_json for r in prior):
                    raise FeedError('BINDING_RECONCILIATION_REQUIRED')
                db.execute('INSERT OR IGNORE INTO eo_bindings VALUES(?,?,?,?)',
                           (mode, binding.source_event_id, binding.event_id, binding_json))
                cursor = db.execute('''INSERT OR IGNORE INTO eo_batches
                    (mode,event_id,raw_hash,source_epoch,received_epoch,state_hash,meta)
                    VALUES(?,?,?,?,?,?,?)''',
                    (mode, binding.event_id, raw_hash, stamp(batch['source_generated_at']).timestamp(),
                     received.timestamp(), state_hash, encode(batch)))
                created = cursor.rowcount == 1
                row = db.execute('SELECT id FROM eo_batches WHERE mode=? AND event_id=? AND raw_hash=?',
                                 (mode, binding.event_id, raw_hash)).fetchone()
                batch_id = row['id']
                if created:
                    db.executemany('INSERT INTO eo_quotes(batch_id,body) VALUES(?,?)',
                                   [(batch_id, encode(r)) for r in records])
                db.execute('INSERT OR IGNORE INTO eo_observations(batch_id,received_epoch) VALUES(?,?)',
                           (batch_id, received.timestamp()))
                db.execute('INSERT INTO eo_attempts(mode,event_id,at_epoch,code) VALUES(?,?,?,?)',
                           (mode, binding.event_id, received.timestamp(), 'SCHEMA_VALID'))
            return {'snapshot_id': batch_id, 'raw_sha256': raw_hash, 'inserted': created,
                    'quotes': len(records), 'mode': mode, 'live_verified': False,
                    'source_quote_timestamp_available': False, 'issues': batch['issues']}
        except (FeedError, TypeError, KeyError, ValueError):
            self.failure(binding, at=received, mode=mode, code='INGEST_REJECTED')
            raise FeedError('INGEST_REJECTED') from None

    def events(self, *, mode='network', limit=100) -> list[dict]:
        mode_check(mode)
        bounded(limit, 500)
        with self.connect() as db:
            rows = db.execute('SELECT event_id,source_event_id,identity FROM eo_bindings WHERE mode=? ORDER BY event_id LIMIT ?',
                              (mode, limit)).fetchall()
        return [dict(json.loads(r['identity']), mode=mode) for r in rows]

    def current(self, event_id: str, *, mode='network', now=None, limit=500,
                max_feed_age_seconds=300) -> dict:
        mode_check(mode)
        bounded(limit, 500)
        bounded(max_feed_age_seconds, 86400)
        clock = stamp(now or datetime.now(timezone.utc))
        with self.connect() as db:
            db.execute('BEGIN')
            latest = db.execute('SELECT * FROM eo_batches WHERE mode=? AND event_id=? ORDER BY source_epoch DESC,id DESC LIMIT 1',
                                (mode, event_id)).fetchone()
            attempt = db.execute('SELECT * FROM eo_attempts WHERE mode=? AND event_id=? ORDER BY at_epoch DESC,id DESC LIMIT 1',
                                 (mode, event_id)).fetchone()
            base = {'event_id': event_id, 'mode': mode, 'live_verified': False,
                    'checked_at': clock.isoformat(), 'model_status': 'MODEL_UNAVAILABLE',
                    'model_probability': None, 'ev_per_unit': None, 'quotes': [],
                    'last_attempt': attempt['code'] if attempt else None}
            if latest is None:
                return dict(base, data_status='DATA_UNAVAILABLE', reasons=['NO_ACCEPTED_CAPTURE'])
            conflicts = db.execute('SELECT COUNT(DISTINCT state_hash) FROM eo_batches WHERE mode=? AND event_id=? AND source_epoch=?',
                                   (mode, event_id, latest['source_epoch'])).fetchone()[0]
            if conflicts > 1:
                return dict(base, data_status='CONFLICT', reasons=['CONFLICTING_PROVIDER_SNAPSHOT'])
            rows = db.execute('SELECT body FROM eo_quotes WHERE batch_id=? ORDER BY id LIMIT ?',
                              (latest['id'], limit + 1)).fetchall()
            seen = db.execute('SELECT MAX(received_epoch) FROM eo_observations WHERE batch_id=?',
                              (latest['id'],)).fetchone()[0]
            meta = json.loads(latest['meta'])
        reasons = ['SOURCE_QUOTE_TIMESTAMP_UNAVAILABLE', 'SETTLEMENT_RULES_UNVERIFIED',
                   'ACCOUNT_AVAILABILITY_UNCONFIRMED']
        if mode == 'fixture':
            reasons.append('SYNTHETIC_FIXTURE_NOT_LIVE_DATA')
        if clock.timestamp() - latest['source_epoch'] > max_feed_age_seconds:
            reasons.append('FEED_SNAPSHOT_STALE')
        if seen > clock.timestamp() + 5 or latest['source_epoch'] > clock.timestamp() + 5:
            reasons.append('FUTURE_OBSERVATION')
        if stamp(meta['event']['starts_at']) <= clock:
            reasons.append('PREGAME_EVENT_STARTED')
        if attempt and attempt['code'] != 'SCHEMA_VALID':
            reasons.append('LAST_FETCH_UNAVAILABLE')
        quotes = []
        for row in rows[:limit]:
            quote = json.loads(row['body'])
            row_reasons = list(reasons)
            if quote['status'] != 'open':
                row_reasons.append('MARKET_NOT_OPEN')
            if quote['issue']:
                row_reasons.append(quote['issue'])
            quotes.append(dict(quote, analysis_eligible=False, price_fresh=False,
                               exclusion_reasons=row_reasons, model_probability=None, ev_per_unit=None))
        degraded = any(r in reasons for r in ('LAST_FETCH_UNAVAILABLE', 'FEED_SNAPSHOT_STALE', 'FUTURE_OBSERVATION'))
        return dict(base, data_status='DEGRADED' if degraded else 'OBSERVED_UNVERIFIED',
                    event=meta['event'], snapshot_id=latest['id'], raw_sha256=latest['raw_hash'],
                    source_generated_at=meta['source_generated_at'], last_received_at=datetime.fromtimestamp(seen, timezone.utc).isoformat(),
                    quotes=quotes, reasons=reasons, truncated=len(rows) > limit,
                    issues=meta['issues'], empty_response_is_not_no_edge=True)

    def history(self, event_id: str, *, mode='network', limit=100, before_id=None) -> dict:
        mode_check(mode)
        bounded(limit, 500)
        if before_id is not None:
            bounded(before_id, 2**63 - 1)
        sql = '''SELECT q.id,q.batch_id,q.body FROM eo_quotes q
                 JOIN eo_batches b ON b.id=q.batch_id WHERE b.mode=? AND b.event_id=?'''
        args = [mode, event_id]
        if before_id is not None:
            sql += ' AND q.id<?'
            args.append(before_id)
        sql += ' ORDER BY q.id DESC LIMIT ?'
        args.append(limit + 1)
        with self.connect() as db:
            rows = db.execute(sql, args).fetchall()
        items = [dict(json.loads(r['body']), history_id=r['id'], snapshot_id=r['batch_id'], mode=mode) for r in rows[:limit]]
        return {'items': items, 'order': 'ingestion_desc',
                'next_before_id': items[-1]['history_id'] if len(rows) > limit else None}

    def health(self, *, credential_configured=False) -> dict:
        with self.connect() as db:
            counts = {r['mode']: r['n'] for r in db.execute('SELECT mode,COUNT(*) n FROM eo_batches GROUP BY mode')}
            attempt = db.execute("SELECT code,at_epoch FROM eo_attempts WHERE mode='network' ORDER BY at_epoch DESC,id DESC LIMIT 1").fetchone()
        return {'provider': PROVIDER, 'credential_configured': bool(credential_configured),
                'connector_status': ('CONFIGURED' if credential_configured else 'NOT_CONFIGURED'),
                'last_network_attempt': dict(attempt) if attempt else None,
                'capture_counts': counts, 'live_verified': False, 'execution': 'DISABLED',
                'models': [], 'poller_running': False, 'schema_version': 1,
                'quote_timestamp_policy': 'missing; generated_at is not quote update time'}

    def edgeboard(self, event_id: str, **kwargs) -> dict:
        board = self.current(event_id, **kwargs)
        event = board.get('event', {})
        for row in board['quotes']:
            row.update(sport=event.get('sport'), league=event.get('league'),
                       start_at=event.get('starts_at'), observed_at=row['source_updated_at'],
                       source_ref='edgeodds:sha256:' + row['raw_sha256'],
                       qualification='unevaluable', provenance='demonstration' if board['mode'] == 'fixture' else 'unverified_capture',
                       importable=False)
            row['exclusion_reasons'].append('MODEL_UNAVAILABLE')
        board['compatibility'] = 'read-only research view; legacy quote import blocked until required evidence exists'
        return board
