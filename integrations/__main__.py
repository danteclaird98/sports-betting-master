"""Import provider exports or fetch one bounded SportsGameOdds page."""
import argparse,json
from pathlib import Path
from app import Workspace
from .adapters import convert,fetch_sgo
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--format',choices=['sportsgameodds','the-odds-api','oddsharvester','edgeboard'])
p.add_argument('--file',type=Path)
p.add_argument('--fetch-league',choices=['NBA','NFL','NHL','MLB','EPL'])
p.add_argument('--db',default='data/edgefusion.sqlite3')
a=p.parse_args()
if a.fetch_league:result=fetch_sgo(a.fetch_league)
elif a.file and a.format:result=convert(a.format,json.loads(a.file.read_text()))
else:p.error('Provide --file and --format, or --fetch-league')
Path(a.db).parent.mkdir(parents=True,exist_ok=True)
saved=Workspace(a.db).ingest(result['quotes'])
print(json.dumps(dict(saved,skipped=result['skipped'],warnings=result['warnings'])))
