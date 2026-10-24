"""Run python -m edgeodds --help. Provider secrets are environment-only."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3

from .ingestion import IngestionStore
from .read_api import serve
from .sportradar import EventBinding, FeedError, MAX_BODY, SportradarClient, decode, stamp


def read_bounded(path):
    with Path(path).open('rb') as stream:
        value = stream.read(MAX_BODY + 1)
    if len(value) > MAX_BODY:
        raise FeedError('INPUT_TOO_LARGE')
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'discover', 'fetch', 'replay', 'serve'])
    parser.add_argument('--db', default=str(Path.home() / '.edgeodds' / 'edgeodds.sqlite3'))
    parser.add_argument('--mapping', help='Reviewed EventBinding JSON, not a credential file')
    parser.add_argument('--input', help='Response file for offline replay only')
    parser.add_argument('--at', help='Actual capture time with timezone; required for replay')
    parser.add_argument('--date', help='UTC schedule date; inspect adjacent UTC days for Pacific evenings')
    parser.add_argument('--start', type=int, default=0, help='Discovery page offset; one page per invocation')
    parser.add_argument('--access', choices=['trial', 'production'], default='trial')
    parser.add_argument('--authorized-source', action='store_true', help='Confirm permitted source access; does not grant licensing rights')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args(argv)
    key = os.environ.get('SPORTRADAR_API_KEY', '')
    try:
        store = IngestionStore(args.db)
        if args.command == 'status':
            result = store.health(credential_configured=bool(key))
        elif args.command == 'serve':
            if not 1 <= args.port <= 65535:
                raise FeedError('INVALID_PORT')
            serve(store, os.environ.get('EDGEODDS_READ_TOKEN', ''), port=args.port,
                  credential_configured=bool(key))
            return 0
        elif args.command == 'discover':
            if not args.authorized_source or not args.date:
                raise FeedError('AUTHORIZED_SOURCE_AND_DATE_REQUIRED')
            wire = SportradarClient(key, access=args.access).schedule(args.date, start=args.start)
            result = {'data': decode(wire.body), 'headers': wire.headers,
                      'pagination': 'single page only; use --start to continue',
                      'warning': 'American Football includes competitions other than NFL; review native IDs before binding'}
        else:
            if not args.mapping:
                raise FeedError('EVENT_MAPPING_REQUIRED')
            binding = EventBinding(**decode(read_bounded(args.mapping)))
            if args.command == 'replay':
                if not args.input or not args.at:
                    raise FeedError('REPLAY_INPUT_AND_CAPTURE_TIME_REQUIRED')
                result = store.ingest(read_bounded(args.input), binding,
                                      retrieved_at=stamp(args.at), mode='fixture')
            else:
                if not args.authorized_source:
                    raise FeedError('AUTHORIZED_SOURCE_REQUIRED')
                try:
                    wire = SportradarClient(key, access=args.access).markets(binding.source_event_id)
                    result = store.ingest(wire.body, binding, retrieved_at=wire.retrieved_at, mode='network')
                except FeedError as exc:
                    store.failure(binding, at=datetime.now(timezone.utc), mode='network', code=str(exc))
                    raise
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except FeedError as exc:
        # FeedError messages originate only from fixed codes, not response bodies.
        print(json.dumps({'error': str(exc), 'live_verified': False}))
        return 2
    except (OSError, sqlite3.Error, TypeError, ValueError):
        print(json.dumps({'error': 'LOCAL_CONFIGURATION_OR_STORAGE_ERROR', 'live_verified': False}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
