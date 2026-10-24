"""Read-only Sportradar OC v2 NFL prematch connector; no account/order APIs.

The public schema exposes generated_at, not a per-outcome update timestamp.
That timestamp is kept as feed generation time and NEVER promoted to quote time.
See docs/EDGEODDS_INGESTION.md for sources, limits and activation requirements.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import math
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .models import MarketKey, MarketStatus, MarketType, NormalizedQuote

MAX_BODY = 2 * 1024 * 1024
PROVIDER = 'sportradar_oc_prematch_v2'
BASE = 'https://api.sportradar.com/oddscomparison-prematch/'
MARKETS = {
    'sr:market:219': ('moneyline', 'winner (incl. overtime)'),
    'sr:market:223': ('spread', 'handicap (incl. overtime)'),
    'sr:market:225': ('total', 'total (incl. overtime)'),
}


class FeedError(ValueError):
    """Only allowlisted error codes are returned by the transport/CLI."""


def stamp(value: str | datetime) -> datetime:
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None or result.utcoffset() is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError, AttributeError, OverflowError):
        raise FeedError('INVALID_TIMESTAMP') from None


def text(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 500:
        raise FeedError('INVALID_IDENTIFIER')
    return value.strip()


def number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise FeedError('INVALID_NUMBER')
    try:
        result = float(value)
    except (ValueError, OverflowError):
        raise FeedError('INVALID_NUMBER') from None
    if not math.isfinite(result):
        raise FeedError('INVALID_NUMBER')
    return 0.0 if result == 0 else result


def encode(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def decode(raw: bytes) -> dict:
    if not isinstance(raw, bytes) or len(raw) > MAX_BODY:
        raise FeedError('BODY_TOO_LARGE_OR_INVALID')

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise FeedError('DUPLICATE_JSON_KEY')
            result[key] = value
        return result

    def invalid_constant(_):
        raise FeedError('NONFINITE_JSON_NUMBER')

    try:
        result = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise FeedError('INVALID_JSON') from None
    if not isinstance(result, dict):
        raise FeedError('EXPECTED_JSON_OBJECT')
    return result


@dataclass(frozen=True)
class EventBinding:
    """An explicit native-ID mapping, supplied by a reviewed schedule record."""
    event_id: str
    source_event_id: str
    home_id: str
    away_id: str
    source_home_id: str
    source_away_id: str
    starts_at: str
    source_ref: str
    league: str = 'NFL'
    sport: str = 'american_football'

    def __post_init__(self):
        for name, value in asdict(self).items():
            object.__setattr__(self, name, text(value))
        ref = urlsplit(self.source_ref)
        if not self.source_ref.startswith('fixture:') and (ref.scheme != 'https' or not ref.hostname or ref.username or ref.password or ref.query):
            raise FeedError('PUBLIC_MAPPING_REFERENCE_REQUIRED')
        if self.league != 'NFL' or self.sport != 'american_football':
            raise FeedError('UNSUPPORTED_LEAGUE')
        if not re.fullmatch(r'sr:sport_event:\d+', self.source_event_id):
            raise FeedError('INVALID_EVENT_ID')
        for value in (self.source_home_id, self.source_away_id):
            if not re.fullmatch(r'sr:competitor:\d+', value):
                raise FeedError('INVALID_COMPETITOR_ID')
        if self.home_id == self.away_id or self.source_home_id == self.source_away_id:
            raise FeedError('IDENTICAL_PARTICIPANTS')
        object.__setattr__(self, 'starts_at', stamp(self.starts_at).isoformat())


@dataclass(frozen=True)
class PaginationInfo:
    total_available: int
    offset: int
    returned: int
    next_start: int | None
    complete: bool


@dataclass(frozen=True)
class ResponseMetadata:
    origin_tier: str
    cache_ttl_seconds: int | None
    pagination: PaginationInfo | None


@dataclass(frozen=True)
class WireResponse:
    body: bytes = field(repr=False)
    retrieved_at: datetime
    endpoint: str
    headers: dict

    def metadata(self, *, requested_start: int | None = None,
                 requested_limit: int | None = None) -> ResponseMetadata:
        return response_metadata(
            self.headers,
            requested_start=requested_start,
            requested_limit=requested_limit,
        )




def _header_int(headers: dict, name: str) -> int | None:
    value = headers.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d+", value.strip()):
        raise FeedError('INVALID_PAGINATION_HEADERS')
    result = int(value)
    if result > 10_000_000:
        raise FeedError('INVALID_PAGINATION_HEADERS')
    return result


def _cache_ttl(headers: dict) -> int | None:
    value = headers.get('cache-control')
    if not isinstance(value, str):
        return None
    match = re.search(r"(?:^|,)\s*max-age=(\d+)(?:\s*,|$)", value, flags=re.IGNORECASE)
    if not match:
        return None
    ttl = int(match.group(1))
    return ttl if ttl <= 86400 else None


def response_metadata(headers: dict, *, requested_start: int | None = None,
                      requested_limit: int | None = None) -> ResponseMetadata:
    if not isinstance(headers, dict):
        raise FeedError('INVALID_RESPONSE_HEADERS')

    origin = headers.get('x-origin-id')
    tiers = {
        'MARKET_ORIGIN_MAGIC_CRAWLERS': 'oc_us',
        'MARKET_ORIGIN_CORE_CRAWLERS': 'oc_core',
    }
    origin_tier = tiers.get(origin, 'unknown' if origin is None else 'unrecognized')

    total = _header_int(headers, 'x-max-results')
    offset = _header_int(headers, 'x-offset')
    returned = _header_int(headers, 'x-result')
    present = [total is not None, offset is not None, returned is not None]
    pagination = None
    if any(present):
        if not all(present):
            raise FeedError('INCOMPLETE_PAGINATION_HEADERS')
        if offset > total or returned > total or offset + returned > total:
            raise FeedError('INVALID_PAGINATION_HEADERS')
        if requested_start is not None:
            if type(requested_start) is not int or requested_start < 0:
                raise FeedError('INVALID_PAGE')
            if offset != requested_start:
                raise FeedError('PAGINATION_OFFSET_MISMATCH')
        if requested_limit is not None:
            if type(requested_limit) is not int or requested_limit <= 0:
                raise FeedError('INVALID_PAGE')
            if returned > requested_limit:
                raise FeedError('INVALID_PAGINATION_HEADERS')
        complete = offset + returned >= total
        if returned == 0 and not complete:
            raise FeedError('PAGINATION_STALLED')
        pagination = PaginationInfo(
            total_available=total,
            offset=offset,
            returned=returned,
            next_start=None if complete else offset + returned,
            complete=complete,
        )
    return ResponseMetadata(
        origin_tier=origin_tier,
        cache_ttl_seconds=_cache_ttl(headers),
        pagination=pagination,
    )


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward x-api-key to another URL.


class SportradarClient:
    def __init__(self, api_key: str, *, access: str = 'trial', opener=None,
                 sleep=time.sleep, clock=lambda: datetime.now(timezone.utc)):
        if not isinstance(api_key, str) or not api_key.strip():
            raise FeedError('NOT_CONFIGURED')
        if '\r' in api_key or '\n' in api_key or access not in ('trial', 'production'):
            raise FeedError('INVALID_CONFIGURATION')
        self._key = api_key
        self.access = access
        self.opener = opener or build_opener(NoRedirect())
        self.sleep = sleep
        self.clock = clock

    def __repr__(self):
        return f'SportradarClient(access={self.access!r}, credential=<redacted>)'

    def markets(self, source_event_id: str) -> WireResponse:
        if not re.fullmatch(r'sr:sport_event:\d+', source_event_id):
            raise FeedError('INVALID_EVENT_ID')
        return self._get(f'sport_events/{source_event_id}/sport_event_markets.json?live=false')

    def schedule(self, day: str, *, start: int = 0) -> WireResponse:
        try:
            parsed = date.fromisoformat(day)
        except (ValueError, TypeError):
            raise FeedError('INVALID_DATE') from None
        if type(start) is not int or not 0 <= start <= 100000:
            raise FeedError('INVALID_PAGE')
        # NFL is discovered inside American Football; not every returned event is NFL.
        return self._get(f'sports/sr:sport:16/schedules/{parsed.isoformat()}/schedules.json?start={start}&limit=50&live=false')

    def _get(self, path: str) -> WireResponse:
        url = BASE + self.access + '/v2/en/' + path
        for attempt in range(3):
            request = Request(url, headers={'x-api-key': self._key, 'Accept': 'application/json'})
            try:
                with self.opener.open(request, timeout=12) as response:
                    raw = response.read(MAX_BODY + 1)
                    if len(raw) > MAX_BODY:
                        raise FeedError('BODY_TOO_LARGE_OR_INVALID')
                    if self._key.encode() in raw:
                        raise FeedError('CREDENTIAL_ECHO_REJECTED')
                    headers = {k.lower(): v for k, v in response.headers.items()
                               if k.lower() in ('cache-control', 'date', 'x-origin-id', 'x-max-results', 'x-offset', 'x-result')}
                    # Do not inspect or expose error bodies, request headers, or URLs with keys.
                    return WireResponse(raw, stamp(self.clock()), url, headers)
            except HTTPError as exc:
                code = exc.code
                retry_after = exc.headers.get('Retry-After', '') if exc.headers else ''
                exc.close()
                if code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise FeedError(f'UPSTREAM_HTTP_{code}') from None
                delay = 2 ** attempt
                if retry_after:
                    try:
                        delay = max(delay, float(retry_after))
                    except ValueError:
                        try:
                            delay = max(delay, (stamp(parsedate_to_datetime(retry_after)) - stamp(self.clock())).total_seconds())
                        except (ValueError, TypeError, OverflowError):
                            raise FeedError('RATE_LIMIT_RETRY_LATER') from None
                    if not math.isfinite(delay) or delay > 30:
                        raise FeedError('RATE_LIMIT_RETRY_LATER') from None
                self.sleep(delay)
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    raise FeedError('UPSTREAM_NETWORK_UNAVAILABLE') from None
                self.sleep(2 ** attempt)
        raise FeedError('UPSTREAM_UNAVAILABLE')


def normalize(raw: bytes, binding: EventBinding, retrieved_at: datetime) -> dict:
    data = decode(raw)
    retrieved = stamp(retrieved_at)
    generated = stamp(data.get('generated_at'))
    if (generated - retrieved).total_seconds() > 5:
        raise FeedError('FUTURE_FEED_TIMESTAMP')
    event = data.get('sport_event')
    if not isinstance(event, dict) or event.get('id') != binding.source_event_id:
        raise FeedError('EVENT_ID_MISMATCH')
    if event.get('replaced_by') or event.get('resume_time'):
        raise FeedError('EVENT_RECONCILIATION_REQUIRED')
    if stamp(event.get('start_time')) != stamp(binding.starts_at):
        raise FeedError('EVENT_START_MISMATCH')
    competitors = event.get('competitors')
    if not isinstance(competitors, list) or len(competitors) != 2:
        raise FeedError('INVALID_PARTICIPANTS')
    sides = {}
    for competitor in competitors:
        if not isinstance(competitor, dict) or competitor.get('qualifier') not in ('home', 'away'):
            raise FeedError('INVALID_PARTICIPANTS')
        side = competitor['qualifier']
        if side in sides:
            raise FeedError('INVALID_PARTICIPANTS')
        sides[side] = competitor.get('id')
    if sides != {'home': binding.source_home_id, 'away': binding.source_away_id}:
        raise FeedError('PARTICIPANT_MISMATCH')
    markets = data.get('markets')
    if not isinstance(markets, list):
        raise FeedError('MARKETS_NOT_AN_ARRAY')
    records, issues, keys = [], [], set()
    for market in markets:
        if not isinstance(market, dict):
            raise FeedError('INVALID_MARKET')
        spec = MARKETS.get(market.get('id'))
        if spec is None or market.get('is_live') is not False:
            issues.append('UNSUPPORTED_OR_LIVE_MARKET')
            continue
        family, expected_name = spec
        if not isinstance(market.get('name'), str) or market['name'].strip().casefold() != expected_name:
            issues.append('MARKET_NAME_REVIEW_REQUIRED')
            continue
        if not isinstance(market.get('books'), list):
            raise FeedError('INVALID_BOOKS')
        for book in market['books']:
            if not isinstance(book, dict):
                raise FeedError('INVALID_BOOK')
            book_id = text(book.get('id'))
            if book_id == 'sr:book:25080' or str(book.get('name', '')).casefold() == 'consensus':
                issues.append('AGGREGATED_CONSENSUS_NOT_A_BOOK')
                continue
            if not re.fullmatch(r'sr:book:\d+', book_id):
                raise FeedError('INVALID_BOOK_ID')
            outcomes = book.get('outcomes')
            if not isinstance(outcomes, list):
                raise FeedError('INVALID_OUTCOMES')
            for outcome in outcomes:
                if not isinstance(outcome, dict):
                    raise FeedError('INVALID_OUTCOME')
                side = outcome.get('type')
                if side not in (('over', 'under') if family == 'total' else ('home', 'away')):
                    issues.append('UNSUPPORTED_OUTCOME')
                    continue
                line = None
                if family == 'spread':
                    line = number(outcome.get('handicap', outcome.get('spread')))
                    if 'handicap' in outcome and 'spread' in outcome and number(outcome['spread']) != line:
                        raise FeedError('CONFLICTING_LINE_FIELDS')
                elif family == 'total':
                    line = number(outcome.get('total'))
                if line is not None and (abs(line) > 1000 or (family == 'total' and line < 0)):
                    raise FeedError('LINE_OUTSIDE_REVIEWED_RANGE')
                selection = side if family == 'total' else getattr(binding, side + '_id')
                state = MarketStatus.UNKNOWN
                if book.get('removed') is True or outcome.get('removed') is True:
                    state = MarketStatus.SUSPENDED
                elif event.get('status') in ('ended', 'closed', 'cancelled', 'abandoned'):
                    state = MarketStatus.CLOSED
                elif (book.get('removed') is False and outcome.get('removed') is False
                      and event.get('status') == 'not_started' and event.get('start_time_confirmed') is True):
                    state = MarketStatus.OPEN
                reason = None
                try:
                    price = number(outcome.get('odds_decimal'))
                    if price == 1:
                        reason, state, price = 'UNAVAILABLE_PRICE_SENTINEL', MarketStatus.SUSPENDED, None
                    elif price <= 1 or price > 10000:
                        raise FeedError('PRICE_OUTSIDE_REVIEWED_RANGE')
                except FeedError:
                    reason, state, price = 'INVALID_PRICE_QUARANTINED', MarketStatus.UNKNOWN, None
                key = MarketKey(binding.event_id, MarketType(family), selection, line)
                market_id = text(book.get('external_market_id') or market['id'])
                row_key = encode([book_id, market['id'], market_id, side, line])
                if row_key in keys:
                    raise FeedError('DUPLICATE_OUTCOME_IDENTITY')
                keys.add(row_key)
                quote = None if price is None else NormalizedQuote(
                    PROVIDER, book_id, binding.source_event_id, market_id, key,
                    price, retrieved, None, state, digest(raw),
                )
                records.append({
                    'provider': PROVIDER, 'sportsbook': book_id,
                    'bookmaker_name': text(book.get('name')),
                    'provider_event_id': binding.source_event_id, 'event_id': binding.event_id,
                    'market': family, 'provider_market_type_id': market['id'],
                    'source_market_id': market_id, 'external_market_id': book.get('external_market_id'),
                    'external_event_id': book.get('external_sport_event_id'),
                    'source_outcome_id': text(outcome.get('id')),
                    'external_outcome_id': outcome.get('external_outcome_id'),
                    'selection': selection, 'side': side, 'line': line, 'period': 'full_game',
                    'overtime': 'included', 'rules': 'unknown', 'rules_verified': False,
                    'decimal_odds': quote.decimal_price if quote else None,
                    'status': state.value, 'source_updated_at': None,
                    'source_snapshot_at': generated.isoformat(), 'retrieved_at': retrieved.isoformat(),
                    'timestamp_basis': 'feed_generation_only', 'raw_sha256': digest(raw),
                    'issue': reason, 'scope': 'pregame',
                })
    return {'event': asdict(binding), 'event_status': event.get('status', 'unknown'),
            'source_generated_at': generated.isoformat(), 'retrieved_at': retrieved.isoformat(),
            'records': records, 'issues': sorted(set(issues))}
