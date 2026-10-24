"""Authenticated loopback-only EdgeOdds read API. Not an internet server."""
from __future__ import annotations

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sqlite3
from urllib.parse import parse_qs, urlsplit

from .ingestion import IngestionStore
from .integrations.edgeboard import edgeboard_contract
from .sportradar import FeedError


def build_handler(store: IngestionStore, token: str, *, credential_configured=False):
    if not isinstance(token, str) or len(token) < 32 or '\n' in token or '\r' in token:
        raise FeedError('READ_TOKEN_REQUIRED_MINIMUM_32_CHARACTERS')
    expected = ('Bearer ' + token).encode()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_):
            pass  # Neither tokens, source data nor user-supplied paths enter logs.

        def version_string(self):
            return 'EdgeOdds'

        def send(self, status, payload):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), expected):
                self.send(401, {'error': 'AUTHENTICATION_REQUIRED'})
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            try:
                parts = urlsplit(self.path)
                params = parse_qs(parts.query, keep_blank_values=True, max_num_fields=10)
                if any(len(v) != 1 for v in params.values()):
                    raise FeedError('DUPLICATE_QUERY_PARAMETER')
                if set(params) - {'mode', 'event_id', 'limit', 'before_id'}:
                    raise FeedError('UNSUPPORTED_QUERY_PARAMETER')
                args = {k: v[0] for k, v in params.items()}
                mode = args.get('mode', 'network')
                limit = int(args.get('limit', '100'))
                event_id = args.get('event_id')
                if parts.path == '/v1/health':
                    result = store.health(credential_configured=credential_configured)
                elif parts.path in ('/v1/events', '/v1/sports'):
                    events = store.events(mode=mode, limit=limit)
                    result = {'events': events, 'mode': mode, 'live_verified': False}
                    if parts.path == '/v1/sports':
                        result = {'observed_leagues': sorted({e['league'] for e in events}),
                                  'mode': mode, 'live_verified': False}
                elif parts.path in ('/v1/odds', '/v1/history', '/v1/edgeboard'):
                    if not event_id:
                        raise FeedError('EVENT_ID_REQUIRED')
                    if parts.path == '/v1/history':
                        cursor = int(args['before_id']) if 'before_id' in args else None
                        result = store.history(event_id, mode=mode, limit=limit, before_id=cursor)
                    elif parts.path == '/v1/edgeboard':
                        result = edgeboard_contract(
                            store.edgeboard(event_id, mode=mode, limit=limit)
                        )
                    else:
                        result = store.current(event_id, mode=mode, limit=limit)
                else:
                    return self.send(404, {'error': 'NOT_FOUND'})
                self.send(200, result)
            except (FeedError, ValueError, TypeError):
                self.send(400, {'error': 'INVALID_REQUEST'})
            except sqlite3.Error:
                self.send(503, {'error': 'STORAGE_UNAVAILABLE'})

        def do_POST(self):
            if self.authorized():
                self.send(405, {'error': 'READ_ONLY_NO_EXECUTION'})

        do_PUT = do_POST
        do_DELETE = do_POST
        do_PATCH = do_POST

    return Handler


def serve(store: IngestionStore, token: str, *, port=8766, credential_configured=False):
    handler = build_handler(store, token, credential_configured=credential_configured)
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as server:
        server.serve_forever()
