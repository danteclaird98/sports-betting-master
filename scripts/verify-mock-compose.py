"""Exercise only local mock ingestion and reads; never contact a provider."""
import argparse
import http.cookiejar
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:18080')
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    if args.base not in ('http://127.0.0.1:18080', 'http://127.0.0.1:3000'):
        parser.error('This verifier only targets loopback on the host or inside the mock container')
    if not re.fullmatch('[a-f0-9]{40}', args.commit):
        parser.error('Expected a full candidate Git SHA')
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(args.base + path, data=data,
                                     headers={'Content-Type': 'application/json'} if body is not None else {})
        with opener.open(req, timeout=10) as response:
            return json.load(response)

    health = request('/health')
    assert health['status'] == 'ok' and health['sourceCommit'] == args.commit, health
    login = urllib.request.Request(args.base + '/login',
        data=urllib.parse.urlencode({'username': 'owner', 'password': 'local-mock-verification-only'}).encode())
    with opener.open(login, timeout=10) as response:
        assert response.status == 200
    initial = request('/api/state')
    assert initial['summary']['snapshots'] == 0, 'Use a clean dedicated mock volume'
    now = datetime.now(timezone.utc)
    common = dict(league='MOCK-NBA', event='Away @ Home', selection='Away', market='moneyline',
                  line=None, period='full_game', rules='mock-overtime-v1', status='open',
                  starts_at=(now + timedelta(hours=1)).isoformat(),
                  updated_at=(now - timedelta(seconds=5)).isoformat(),
                  retrieved_at=(now - timedelta(seconds=2)).isoformat())
    rows = [dict(common, provider='mock-a', bookmaker='Mock A', event_id='book-a-event', decimal_price=1.9),
            dict(common, provider='mock-b', bookmaker='Mock B', event_id='book-b-event',
                 event='  away  @  HOME  ', selection=' away ', decimal_price=2.0)]
    assert request('/api/import', rows)['imported'] == 2
    state = request('/api/state')
    assert len(state['markets']) == 1 and state['markets'][0]['best_book'] == 'Mock B', state
    ids = {row['canonical_event_id'] for row in state['markets'][0]['quotes']}
    assert len(ids) == 1 and None not in ids
    for row in rows:
        row['retrieved_at'] = (now - timedelta(seconds=1)).isoformat()
    assert request('/api/import', rows)['imported'] == 2
    assert request('/api/import', rows)['imported'] == 0  # raw evidence dedup; observation still appends
    summary = request('/api/state')['summary']
    assert summary['canonical_events'] == 1 and summary['capture_observations'] == 6, summary
    assert summary['snapshots'] == 4, summary
    with opener.open(args.base + '/edgeboard/', timeout=10) as response:
        html = response.read().decode()
        assert response.status == 200 and 'id="root"' in html
    asset = re.search(r'src="(/edgeboard/assets/[^\"]+\.js)"', html)
    assert asset, 'Built dashboard JavaScript asset missing'
    with opener.open(args.base + asset.group(1), timeout=10) as response:
        assert response.status == 200 and len(response.read()) > 100
    print(json.dumps({'healthCommit': health['sourceCommit'], 'canonicalEvents': 1,
                      'snapshots': 4, 'captureObservations': 6, 'dashboardAssets': 'served',
                      'providerCredits': 0}))


if __name__ == '__main__':
    main()
