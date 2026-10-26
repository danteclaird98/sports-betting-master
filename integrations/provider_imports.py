"""Bounded manual observations, isolated from verified board and wager ledgers."""
import hashlib
import json
import math
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from integrations.adapters import clock, convert
from integrations.movements import significant_moves

MAX_BYTES = 60000
MAX_QUOTES = 500
FORMATS = {'normalized', 'the-odds-api', 'sportsgameodds', 'oddsharvester', 'edgeboard'}
SECRET = re.compile(r'(api.?key|authorization|password|secret|token|cookie|credential)', re.I)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def inspect(value, depth=0):
    if depth > 16:
        raise ValueError('Import nesting exceeds limit')
    if isinstance(value, bool):
        return  # Provider availability flags are legitimate; numeric fields checked separately.
    if isinstance(value, int) and abs(value) > 2**53-1:
        raise ValueError('Invalid numeric value')
    if isinstance(value, float) and (not math.isfinite(value) or abs(value) > 2**53-1):
        raise ValueError('Invalid numeric value')
    if isinstance(value, str) and (len(value) > 4000 or re.search(r'(?:Bearer\s+|sk-[A-Za-z0-9]{12,}|[?&](?:api_?key|token)=)', value, re.I)):
        raise ValueError('Oversized text or credentials are not allowed')
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or SECRET.search(key):
                raise ValueError('Credentials are not allowed in imports')
            if isinstance(item, bool) and key in ('price', 'odds', 'point', 'spread', 'overUnder', 'decimal_price', 'line', '1', '2', 'X', 'odds_over', 'odds_under'):
                raise ValueError('Boolean is not a price or line')
            inspect(item, depth+1)
    elif isinstance(value, list):
        if len(value) > 1000:
            raise ValueError('Import array exceeds limit')
        for item in value:
            inspect(item, depth+1)
    elif value is not None and not isinstance(value, (str, int, float, bool)):
        raise ValueError('Expected JSON values')


def text(row, key, optional=False):
    value = row.get(key)
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 250:
        raise ValueError('Invalid '+key)
    return value.strip()


def number(value, key):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or abs(value) > 1000000 or not math.isfinite(value):
        raise ValueError('Invalid '+key)
    return value


def normalize(row):
    if not isinstance(row, dict):
        raise ValueError('Expected quote object')
    result = {k: text(row, k) for k in ('provider', 'event_id', 'event', 'league', 'bookmaker', 'selection', 'period', 'rules')}
    result['market'] = text(row, 'market')
    if result['market'] not in ('moneyline', 'spread', 'total'):
        raise ValueError('Unsupported market identity')
    result['source_market_id'] = text(row, 'source_market_id', optional=True)
    result['status'] = row.get('status', 'unknown')
    if result['status'] not in ('open', 'suspended', 'closed', 'unknown'):
        raise ValueError('Invalid market status')
    result['decimal_price'] = number(row.get('decimal_price'), 'decimal_price')
    if result['decimal_price'] <= 1:
        raise ValueError('Decimal price must exceed one')
    result['line'] = None if row.get('line') is None else number(row['line'], 'line')
    if result['market'] in ('spread', 'total') and result['line'] is None:
        raise ValueError('Line required for spread or total')
    for key in ('starts_at', 'retrieved_at', 'updated_at'):
        value = row.get(key)
        if key == 'starts_at' and value is None:
            raise ValueError('starts_at required')
        if value is not None and not isinstance(value, str):
            raise ValueError('Invalid timestamp')
        result[key] = clock(value)
    result.update(verification='UNVERIFIED', eligible_for_ev=False, execution_enabled=False)
    return result


class ProviderImports:
    def __init__(self, path: Path):
        self.path = Path(path)
        with self._connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS provider_import_receipts (
              request_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, receipt TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS provider_import_observations (
              id INTEGER PRIMARY KEY, request_id TEXT NOT NULL REFERENCES provider_import_receipts(request_id),
              observation TEXT NOT NULL);
            CREATE TRIGGER IF NOT EXISTS provider_receipts_no_update BEFORE UPDATE ON provider_import_receipts BEGIN SELECT RAISE(ABORT,'append only'); END;
            CREATE TRIGGER IF NOT EXISTS provider_receipts_no_delete BEFORE DELETE ON provider_import_receipts BEGIN SELECT RAISE(ABORT,'append only'); END;
            CREATE TRIGGER IF NOT EXISTS provider_observations_no_update BEFORE UPDATE ON provider_import_observations BEGIN SELECT RAISE(ABORT,'append only'); END;
            CREATE TRIGGER IF NOT EXISTS provider_observations_no_delete BEFORE DELETE ON provider_import_observations BEGIN SELECT RAISE(ABORT,'append only'); END;
            ''')

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute('PRAGMA foreign_keys=ON')
            with db:
                yield db
        finally:
            db.close()

    def import_payload(self, data: dict) -> dict:
        if not isinstance(data, dict) or set(data)-{'request_id', 'format', 'payload', 'options'}:
            raise ValueError('Invalid import envelope')
        inspect(data)
        try:
            encoded = canonical(data)
        except (ValueError, TypeError):
            raise ValueError('Invalid JSON values') from None
        if len(encoded.encode()) > MAX_BYTES:
            raise ValueError('Import exceeds 60000 bytes')
        request_id = data.get('request_id')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', request_id):
            raise ValueError('request_id must be 8-100 safe characters')
        kind = data.get('format')
        if kind not in FORMATS:
            raise ValueError('Unsupported import format')
        options = data.get('options', {})
        if not isinstance(options, dict) or set(options)-{'retrieved_at', 'league', 'rules', 'event', 'odds_format'}:
            raise ValueError('Unsupported import options')
        if options.get('odds_format', 'decimal') not in ('decimal', 'american'):
            raise ValueError('Invalid odds format')
        digest = hashlib.sha256(canonical({k:v for k,v in data.items() if k != 'request_id'}).encode()).hexdigest()
        with self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT payload_hash,receipt FROM provider_import_receipts WHERE request_id=?', (request_id,)).fetchone()
            if previous:
                if previous[0] != digest:
                    raise ValueError('request_id already used for a different payload')
                return json.loads(previous[1])
            duplicate = db.execute('SELECT request_id,receipt FROM provider_import_receipts WHERE payload_hash=? LIMIT 1', (digest,)).fetchone()
            if duplicate:
                receipt = dict(json.loads(duplicate[1]), request_id=request_id, imported=0, observation_count=0, duplicate_of=duplicate[0])
                db.execute('INSERT INTO provider_import_receipts VALUES (?,?,?)', (request_id, digest, canonical(receipt)))
                return receipt
            try:
                converted = {'quotes': data['payload'], 'warnings': [], 'skipped': 0} if kind == 'normalized' else convert(kind, data['payload'], options)
                raw = converted['quotes']
                if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_QUOTES:
                    raise ValueError('Import must contain 1-500 supported observations')
                rows = [normalize(row) for row in raw]
            except (KeyError, TypeError, AttributeError, OverflowError, ValueError):
                raise ValueError('Invalid provider payload or unsupported quote identity') from None
            receipt = dict(request_id=request_id, payload_hash=digest, format=kind, imported=len(rows), observation_count=len(rows), skipped=converted['skipped'], warnings=converted['warnings'], verification='UNVERIFIED', execution_enabled=False, imported_at=datetime.now(timezone.utc).isoformat())
            db.execute('INSERT INTO provider_import_receipts VALUES (?,?,?)', (request_id, digest, canonical(receipt)))
            db.executemany('INSERT INTO provider_import_observations(request_id,observation) VALUES (?,?)', [(request_id, canonical(row)) for row in rows])
            return receipt

    def summary(self) -> dict:
        with self._connect() as db:
            count = db.execute('SELECT count(*) FROM provider_import_observations').fetchone()[0]
            rows = [json.loads(r[0]) for r in db.execute('SELECT observation FROM provider_import_observations ORDER BY id DESC LIMIT 2000')]
            receipts = [json.loads(r[0]) for r in db.execute('SELECT receipt FROM provider_import_receipts ORDER BY rowid DESC LIMIT 20')]
        movements = significant_moves(rows)
        for move in movements:
            move.update(verification='UNVERIFIED', eligible_for_ev=False)
        return dict(verification='UNVERIFIED', execution_enabled=False, observation_count=count, observations=rows[:100], receipts=receipts, imports=receipts, movements=movements, movement_window_limit=2000)
