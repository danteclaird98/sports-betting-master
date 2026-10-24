"""Regression tests for legacy snapshot connection ownership and rollback."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from edgeodds.models import MarketKey, MarketStatus, MarketType, NormalizedQuote
from edgeodds.store import SnapshotStore


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


if __name__ == '__main__':
    unittest.main()
