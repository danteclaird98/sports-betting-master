"""Synthetic archive-read measurement; temporary local SQLite, no provider calls."""
import json
import statistics
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import Workspace

for count in (1000, 10000):
    with tempfile.TemporaryDirectory(prefix='edgeboard-benchmark-') as directory:
        workspace = Workspace(Path(directory) / 'mock.sqlite')
        now = datetime.now(timezone.utc)
        rows = [dict(provider='mock', bookmaker='Mock', event_id='mock-event', event='Away @ Home',
                     league='MOCK', selection='Away', market='moneyline', line=None, period='full_game',
                     rules='mock-v1', decimal_price=2.0, status='open',
                     starts_at=(now + timedelta(days=1)).isoformat(),
                     updated_at=(now - timedelta(seconds=1)).isoformat(),
                     retrieved_at=(now - timedelta(microseconds=count-i)).isoformat()) for i in range(count)]
        for offset in range(0, count, 5000):
            workspace.ingest(rows[offset:offset+5000])
        timings = []
        for _ in range(3):
            started = time.perf_counter()
            state = workspace.state()
            timings.append((time.perf_counter() - started) * 1000)
        assert state['summary']['snapshots'] == count
        with workspace.connect() as db:
            plan = db.execute('EXPLAIN QUERY PLAN SELECT body FROM quotes ORDER BY id').fetchall()
        print(json.dumps({'snapshots': count, 'medianStateMs': round(statistics.median(timings), 2),
                          'samplesMs': [round(value, 2) for value in timings], 'queryPlan': plan,
                          'scope': 'synthetic local archive, not production latency'}))
