"""Conservative event metadata; immutable quote evidence is never rewritten."""
from datetime import datetime
import unicodedata
import uuid

SCHEMA = '''
CREATE TABLE IF NOT EXISTS canonical_events (
 id TEXT PRIMARY KEY, league TEXT NOT NULL, away_team TEXT NOT NULL,
 home_team TEXT NOT NULL, anchor_epoch REAL NOT NULL, venue_key TEXT, neutral_site INTEGER
);
CREATE INDEX IF NOT EXISTS canonical_event_match
 ON canonical_events(league,away_team,home_team,anchor_epoch);
CREATE TABLE IF NOT EXISTS provider_event_bindings (
 provider TEXT NOT NULL, bookmaker TEXT NOT NULL, external_id TEXT NOT NULL,
 canonical_event_id TEXT NOT NULL REFERENCES canonical_events(id),
 PRIMARY KEY(provider,bookmaker,external_id)
);
CREATE TABLE IF NOT EXISTS quote_capture_observations (
 id INTEGER PRIMARY KEY, capture_id TEXT NOT NULL,
 quote_id INTEGER NOT NULL REFERENCES quotes(id),
 canonical_event_id TEXT REFERENCES canonical_events(id),
 captured_at TEXT NOT NULL, identity_status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quote_capture_identity ON quote_capture_observations(quote_id);
'''


def name(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split()) if isinstance(value, str) else ''


def participants(row):
    if 'home_team' in row or 'away_team' in row:
        away, home = name(row.get('away_team')), name(row.get('home_team'))
    else:
        parts = row['event'].split('@')
        if len(parts) != 2:
            return None
        away, home = map(name, parts)
    if not away or not home or away == home or '@' in away or '@' in home:
        return None
    return away, home


def epoch(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.utcoffset() is None:
        raise ValueError('Canonical event timestamps require timezone')
    return dt.timestamp()


def initialize(db):
    db.executescript(SCHEMA)
    for table in ('quotes', 'canonical_events', 'provider_event_bindings', 'quote_capture_observations'):
        for action in ('UPDATE', 'DELETE'):
            db.execute(f'''CREATE TRIGGER IF NOT EXISTS {table}_no_{action.lower()}
                BEFORE {action} ON {table} BEGIN
                SELECT RAISE(ABORT, 'append-only canonical event metadata'); END''')
        keys = ('provider','bookmaker','external_id') if table == 'provider_event_bindings' else ('id',)
        predicate = ' AND '.join(f'{key}=NEW.{key}' for key in keys)
        if table == 'quotes':
            predicate = 'id=NEW.id OR hash=NEW.hash'
        db.execute(f'''CREATE TRIGGER IF NOT EXISTS {table}_no_replace
            BEFORE INSERT ON {table} WHEN EXISTS(SELECT 1 FROM {table} WHERE {predicate})
            BEGIN SELECT RAISE(ABORT, 'append-only canonical event metadata'); END''')


def bind(db, row):
    teams = participants(row)
    prior = db.execute('''SELECT c.id,c.league,c.away_team,c.home_team,c.anchor_epoch,c.venue_key,c.neutral_site
        FROM provider_event_bindings b JOIN canonical_events c ON c.id=b.canonical_event_id
        WHERE b.provider=? AND b.bookmaker=? AND b.external_id=?''',
        (row['provider'], row['bookmaker'], row['event_id'])).fetchone()
    if teams is None:
        if prior:
            raise ValueError('CANONICAL_BINDING_IDENTITY_CHANGED')
        return None, 'UNMAPPED_PARTICIPANTS'
    away, home = teams
    league, start = name(row['league']), epoch(row['starts_at'])
    venue = row.get('venue_id')
    neutral = row.get('neutral_site')
    if venue is not None and (not isinstance(venue, str) or not name(venue) or len(venue)>200):
        raise ValueError('INVALID_EVENT_VENUE')
    venue = name(venue) if venue is not None else None
    if neutral is not None and type(neutral) is not bool:
        raise ValueError('INVALID_EVENT_NEUTRAL_SITE')
    if prior:
        if ((league, away, home) != tuple(prior[1:4]) or abs(start-prior[4]) > 1800
                or (venue, neutral) != (prior[5], prior[6])):
            raise ValueError('CANONICAL_BINDING_IDENTITY_CHANGED')
        return prior[0], 'MAPPED'
    nearby = db.execute('''SELECT id,venue_key,neutral_site FROM canonical_events WHERE league=? AND away_team=?
        AND home_team=? AND anchor_epoch BETWEEN ? AND ?''',
        (league, away, home, start-1800, start+1800)).fetchall()
    # Missing optional identity evidence cannot choose between known venues/sites,
    # nor silently enrich an earlier unknown identity.
    if any((venue is None) != (candidate[1] is None) or
           (neutral is None) != (candidate[2] is None) for candidate in nearby):
        raise ValueError('AMBIGUOUS_EVENT_VENUE_OR_SITE')
    candidates = [candidate for candidate in nearby if (venue, neutral) == tuple(candidate[1:])]
    if len(candidates) > 1:
        raise ValueError('AMBIGUOUS_CANONICAL_EVENT')
    canonical_id = candidates[0][0] if candidates else 'canonical:'+uuid.uuid4().hex
    if candidates and db.execute('''SELECT 1 FROM provider_event_bindings
            WHERE provider=? AND bookmaker=? AND canonical_event_id=?''',
            (row['provider'], row['bookmaker'], canonical_id)).fetchone():
        raise ValueError('AMBIGUOUS_PROVIDER_EVENT_IDS')
    if not candidates:
        db.execute('INSERT INTO canonical_events VALUES(?,?,?,?,?,?,?)',
                   (canonical_id, league, away, home, start, venue, neutral))
    db.execute('INSERT INTO provider_event_bindings VALUES(?,?,?,?)',
               (row['provider'], row['bookmaker'], row['event_id'], canonical_id))
    return canonical_id, 'MAPPED'


def observe(db, capture_id, quote_id, canonical_id, status, captured_at):
    db.execute('''INSERT INTO quote_capture_observations
        (capture_id,quote_id,canonical_event_id,captured_at,identity_status) VALUES(?,?,?,?,?)''',
        (capture_id, quote_id, canonical_id, captured_at, status))


def projection(row, canonical_id, quote_id, source_hash):
    result = dict(row, original_event_id=row['event_id'], original_selection=row['selection'],
                  canonical_event_id=canonical_id, quote_receipt={'id':quote_id,'hash':source_hash},
                  identity_status='MAPPED' if canonical_id else 'UNMAPPED_NO_CANONICAL_BINDING')
    if canonical_id:
        result['event_id'] = canonical_id
        teams = participants(row)
        selection = name(row['selection'])
        if teams and selection in teams:
            result['selection'] = selection
    else:
        # Unmapped sources must not accidentally coalesce across books/providers.
        result['event_id'] = 'unmapped:'+repr((row['provider'],row['bookmaker'],row['event_id']))
    return result
