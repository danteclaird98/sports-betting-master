import csv
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('pipeline', ROOT/'pipeline.py')
pipeline = importlib.util.module_from_spec(spec); spec.loader.exec_module(pipeline)


class PipelineTests(unittest.TestCase):
    def test_negative_yards_and_cross_season_history_are_preserved_without_current_label(self):
        with tempfile.TemporaryDirectory() as folder:
            fields = ['player_id','game_id','season','week','season_type','position','receiving_yards']
            for season in range(2021,2026):
                with (Path(folder)/f'stats_player_week_{season}.csv').open('w') as stream:
                    w=csv.DictWriter(stream,fieldnames=fields);w.writeheader()
                    for week,yards in ([(1,-2),(2,60),(3,20)] if season==2021 else [(1,999)] if season==2022 else []):
                        w.writerow(dict(player_id='p',game_id=f'{season}-{week}',season=season,week=week,season_type='REG',position='WR',receiving_yards=yards))
            rows,_,_,negatives=pipeline.cohort(folder)
            self.assertEqual(negatives,1);self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['features'],[26.,26.,1/3,1/3,3])
            self.assertEqual(rows[0]['y'],1)

    def test_artifact_cli_inference_parity_and_hold(self):
        artifact=json.loads((ROOT.parents[1]/'backend/correctedReceivingArtifact.json').read_text())
        features=dict(zip(pipeline.FEATURES,[42,40,.3,.25,12]))
        expected=pipeline.score(artifact,features)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'features.json';path.write_text(json.dumps(features))
            run=subprocess.run([sys.executable,'-B',str(ROOT/'pipeline.py'),'predict','--artifact',str(ROOT.parents[1]/'backend/correctedReceivingArtifact.json'),'--features',str(path)],capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(run.stdout),expected)
        self.assertEqual(expected['status'],'HOLD');self.assertFalse(expected['production_enabled'])
        for invalid in (dict(features,priorgames=2),dict(features,past3avg=float('nan')),dict(features,odds=2)):
            with self.assertRaises(ValueError): pipeline.score(artifact,invalid)


if __name__=='__main__':unittest.main()
