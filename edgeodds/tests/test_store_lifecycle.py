"""Regression tests for legacy snapshot connection ownership and rollback."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from edgeodds.models import MarketKey, MarketStatus, MarketType, NormalizedQuote
from edgeodds.store import SCHEMA, SnapshotStore


@contextmanager
def tracked_connections():
    original = sqlite3.connect
    connections = []

    def connect(*args, **kwargs):
        db = original(*args, **kwargs)
        connections.append(db)
        return db

    try:
        with patch('edgeodds.store.sqlite3.connect', side_effect=connect):
            yield connections
    finally:
        # Failed assertions must not themselves leave test connections open.
        for db in connections:
            db.close()


def quote():
    now = datetime(2030, 1, 1, tzinfo=timezone.utc)
    return NormalizedQuote('fixture', 'fixture-book', 'fixture-event', 'fixture-market',
                           MarketKey('fixture-event', MarketType.MONEYLINE, 'fixture-home'),
                           1.91, now, now, MarketStatus.OPEN, 'fixture-payload')


class ConnectionLifecycleTests(unittest.TestCase):
    def assert_closed(self, connections):
        self.assertTrue(connections)
        for db in connections:
            with self.assertRaises(sqlite3.ProgrammingError):
                db.execute('SELECT 1')

    def test_successful_store_operations_close_connections(self):
        with TemporaryDirectory() as tmp, tracked_connections() as connections:
            store = SnapshotStore(Path(tmp) / 'test.sqlite3')
            self.assertTrue(store.append(quote()))
            self.assertFalse(store.append(quote()))
            self.assertEqual(len(store.latest()), 1)
            self.assertEqual(len(connections), 4)
            self.assert_closed(connections)

    def test_failed_transaction_rolls_back_and_closes(self):
        with TemporaryDirectory() as tmp, tracked_connections() as connections:
            store = SnapshotStore(Path(tmp) / 'test.sqlite3')
            with store._connect() as db:
                db.execute('CREATE TABLE lifecycle_fixture (value TEXT)')
            with self.assertRaisesRegex(RuntimeError, 'rollback fixture'):
                with store._connect() as db:
                    db.execute('INSERT INTO lifecycle_fixture VALUES (?)', ('not committed',))
                    raise RuntimeError('rollback fixture')
            with store._connect() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM lifecycle_fixture').fetchone()[0], 0)
            self.assert_closed(connections)


class AppendOnlyTests(unittest.TestCase):
    def test_mutations_fail_from_a_separate_connection(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.sqlite3'
            store = SnapshotStore(path)
            self.assertTrue(store.append(quote()))
            before = store.latest()
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('PRAGMA recursive_triggers').fetchone()[0], 0)
                for sql in (
                    'UPDATE odds_snapshots SET decimal_price = 9',
                    'UPDATE odds_snapshots SET id = id + 1',
                    'DELETE FROM odds_snapshots',
                ):
                    with self.assertRaisesRegex(sqlite3.IntegrityError, 'append-only'):
                        db.execute(sql)
            self.assertEqual(store.latest(), before)
            self.assertFalse(store.append(quote()))

    def test_replace_and_upsert_cannot_rewrite_existing_evidence(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.sqlite3'
            store = SnapshotStore(path)
            store.append(quote())
            before = store.latest()
            with sqlite3.connect(path) as db:
                columns = [row[1] for row in db.execute('PRAGMA table_info(odds_snapshots)')]
                original = list(db.execute('SELECT * FROM odds_snapshots').fetchone())
                for collision in ('id', 'fingerprint'):
                    replacement = original.copy()
                    replacement[columns.index('decimal_price')] = 9
                    if collision == 'id':
                        replacement[columns.index('fingerprint')] = 'different-fingerprint'
                    else:
                        replacement[columns.index('id')] = original[0] + 100
                    placeholders = ','.join('?' for _ in columns)
                    db.execute(f'INSERT OR REPLACE INTO odds_snapshots VALUES ({placeholders})', replacement)
                db.execute('''INSERT INTO odds_snapshots SELECT * FROM odds_snapshots WHERE true
                           ON CONFLICT(fingerprint) DO UPDATE SET decimal_price = 9''')
            self.assertEqual(store.latest(), before)

    def test_existing_database_gains_guards_without_rewriting_rows(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'existing.sqlite3'
            # Reproduce an installation created before append-only triggers.
            legacy_schema = SCHEMA.split('CREATE TRIGGER', 1)[0]
            with sqlite3.connect(path) as db:
                db.executescript(legacy_schema)
            store = SnapshotStore(path)
            store.append(quote())
            before = store.latest()
            with sqlite3.connect(path) as db:
                for name in ('odds_snapshots_no_update', 'odds_snapshots_no_delete',
                             'odds_snapshots_preserve_conflicts'):
                    db.execute(f'DROP TRIGGER {name}')
            reopened = SnapshotStore(path)
            self.assertEqual(reopened.latest(), before)
            with sqlite3.connect(path) as db:
                with self.assertRaisesRegex(sqlite3.IntegrityError, 'append-only'):
                    db.execute('DELETE FROM odds_snapshots')
            from dataclasses import replace
            self.assertTrue(reopened.append(replace(quote(), decimal_price=2.1)))
            self.assertEqual(len(reopened.latest()), 2)
            self.assertFalse(reopened.append(quote()))


if __name__ == '__main__':
    unittest.main()
