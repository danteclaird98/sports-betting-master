"""Conservative imports for the source repositories' actual provider shapes."""
import hashlib
import math
import os
import re
from datetime import datetime, timezone


def american(value):
    number=float(value)
    if not math.isfinite(number) or abs(number)<100:
        raise ValueError('Invalid American odds')
    return 1+number/100 if number>0 else 1+100/-number


def clock(value):
    if value is None:return None
    text=str(value)
    if text.endswith(' UTC'):
        return datetime.strptime(text,'%Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc).isoformat()
    dt=datetime.fromisoformat(text.replace('Z','+00:00'))
    if dt.utcoffset() is None:raise ValueError('Provider timestamps require explicit timezone')
    return dt.astimezone(timezone.utc).isoformat()


def base(provider,event_id,event,league,starts,received,options):
    return dict(provider=provider,event_id=provider+':'+str(event_id),event=event,league=league,
                starts_at=clock(starts),retrieved_at=clock(received),rules=options.get('rules','unknown'))


def convert(kind,payload,options=None):
    options=options or {}
    received=options.get('retrieved_at') or datetime.now(timezone.utc).isoformat()
    result=[]; skipped=[]
    if kind=='sportsgameodds':
        events=payload.get('data',[]) if isinstance(payload,dict) else payload
        for event in events:
            home=event['teams']['home']['names']['long'];away=event['teams']['away']['names']['long']
            common=base(kind,event['eventID'],away+' @ '+home,event.get('leagueID') or options.get('league','UNKNOWN'),event['status']['startsAt'],received,options)
            for odd_id,odd in (event.get('odds') or {}).items():
                market={'ml':'moneyline','sp':'spread','ou':'total'}.get(odd.get('betTypeID'))
                # Player/stat props need a richer identity contract than the game quote board.
                if not market or odd.get('playerID') or odd.get('statEntityID') not in ('home','away','all') or odd.get('statID') not in ('points','goals','runs','score'):
                    skipped.append('Unsupported player/stat market');continue
                side=odd.get('sideID')
                selection={'home':home,'away':away,'over':'Over','under':'Under','draw':'Draw'}.get(side)
                if not selection:skipped.append('Unsupported selection');continue
                for book,row in (odd.get('byBookmaker') or {}).items():
                    if row.get('odds') is None:skipped.append('Missing price');continue
                    line=row.get('spread') if market=='spread' else row.get('overUnder') if market=='total' else None
                    result.append(dict(common,market=market,selection=selection,line=float(line) if line is not None else None,bookmaker=book,
                        decimal_price=american(row['odds']),period=odd.get('periodID') or 'unknown',source_market_id=odd_id,
                        updated_at=clock(row.get('lastUpdatedAt')),status='open' if row.get('available') is True else 'suspended'))
    elif kind=='the-odds-api':
        for event in payload:
            common=base(kind,event['id'],event['away_team']+' @ '+event['home_team'],event.get('sport_title') or options.get('league','UNKNOWN'),event['commence_time'],received,options)
            for book in event.get('bookmakers',[]):
                for market in book.get('markets',[]):
                    family={'h2h':'moneyline','spreads':'spread','totals':'total'}.get(market['key'])
                    if not family:skipped.append('Unsupported market');continue
                    for outcome in market.get('outcomes',[]):
                        price=outcome['price']
                        if options.get('odds_format','decimal')=='american':price=american(price)
                        result.append(dict(common,market=family,selection=outcome['name'],line=outcome.get('point'),bookmaker=book['key'],decimal_price=float(price),
                            period='full_game',source_market_id=market['key'],updated_at=clock(market.get('last_update') or book.get('last_update')),status='open'))
    elif kind=='oddsharvester':
        for event in payload:
            link=event['match_link'];event_id=hashlib.sha256(link.encode()).hexdigest()[:24]
            common=base(kind,event_id,event['away_team']+' @ '+event['home_team'],event.get('league_name') or options.get('league','UNKNOWN'),event['match_date'],event['scraped_date'],options)
            for name,books in event.items():
                if not name.endswith('_market') or not isinstance(books,list):continue
                total=re.fullmatch(r'over_under_(\d+(?:_\d+)?)_market',name)
                if name in ('home_away_market','1x2_market'):
                    market='moneyline';line=None;selections={'1':event['home_team'],'2':event['away_team'],'X':'Draw'}
                elif total:
                    market='total';line=float(total.group(1).replace('_','.'));selections={'odds_over':'Over','odds_under':'Under'}
                else:skipped.append('Unsupported OddsHarvester market '+name);continue
                for book in books:
                    for key,selection in selections.items():
                        if book.get(key) in (None,'','-'):continue
                        result.append(dict(common,market=market,selection=selection,line=line,bookmaker=book['bookmaker_name'],decimal_price=float(book[key]),
                            period=book.get('period') or 'unknown',source_market_id=name,updated_at=None,
                            status='suspended' if key in book.get('blocked_outcomes',[]) else 'open',source_ref=link))
    elif kind=='edgeboard':
        if payload.get('schema')!='edgeodds.edgeboard.v1':raise ValueError('Expected versioned EdgeBoard contract edgeodds.edgeboard.v1')
        event=payload['event']
        for quote in payload.get('quotes',[]):
            # Contract side and provenance are preserved; eligibility is recomputed by EdgeFusion.
            market=quote['market'];source=quote['source'];price=quote['price'];times=quote['timestamps']
            common=base(source.get('provider') or 'edgeboard',event['event_id'],options.get('event') or event['event_id'],event.get('league') or 'UNKNOWN',event['starts_at'],times['retrieved_at'],options)
            result.append(dict(common,market=market['family'],selection=market['selection'],line=market.get('line'),period=market.get('period') or 'unknown',
                rules=market.get('settlement_rules',{}).get('id') or 'unknown',bookmaker=quote['book'],decimal_price=price['decimal'],updated_at=clock(times.get('quote_updated_at')),status=price.get('status') or 'unknown'))
    else:raise ValueError('Unknown import format')
    if not result:raise ValueError('No supported quotes found; unsupported markets remain in the upstream research tools')
    return dict(quotes=result,skipped=len(skipped),warnings=sorted(set(skipped)))


def fetch_sgo(league):
    """Use the official sports-odds-api-python SDK, with bounded explicit requests."""
    if league not in ('NBA','NFL','NHL','MLB','EPL'):raise ValueError('Unsupported league')
    key=os.environ.get('SPORTSGAMEODDS_KEY')
    if not key:raise ValueError('SPORTSGAMEODDS_KEY is not configured on the server')
    try:from sports_odds_api import SportsGameOdds
    except ImportError as exc:raise ValueError('Install requirements-providers.txt to enable the official SDK') from exc
    try:
        with SportsGameOdds(api_key_header=key,timeout=20.0,max_retries=0) as client:
            page=client.events.get(league_id=league,finalized=False,odds_available=True,limit=10)
            events=[event.model_dump(mode='json',by_alias=True) for event in page.data or []]
    except Exception as exc:
        # Provider exception messages may contain credentials or request URLs.
        raise ValueError('SportsGameOdds request failed; check provider access and quota') from None
    return convert('sportsgameodds',events,{'league':league})
