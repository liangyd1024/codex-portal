import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('output_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class NullOutputTest(unittest.TestCase):
    def test_null_output_full_preview_and_delta(self):
        store.STORE = pathlib.Path(tempfile.mkdtemp(prefix='rcm-null-output-'))
        directory = store.STORE / 'remote-codex-manager'
        directory.mkdir()
        db = sqlite3.connect(directory / 'output-journal.sqlite')
        db.execute('CREATE TABLE commands (thread TEXT,turn TEXT,item TEXT,value TEXT,updated INTEGER)')
        db.execute('INSERT INTO commands VALUES (?,?,?,?,0)', ('t', 'turn', 'item', json.dumps({'id': 'item', 'type': 'commandExecution', 'aggregatedOutput': None})))
        db.commit()
        db.close()
        for preview in [False, True]:
            request = {'threadId': 't', 'outputEncoding': 'gzip-base64', 'preview': preview}
            item = store.read_outputs(request)['data'][0]['item']
            self.assertEqual(item['aggregatedOutput'], '')
            self.assertTrue(item['outputToken'].startswith('0:'))
            delta = store.read_outputs({**request, 'outputVersions': {'item': item['outputToken']}})['data'][0]['item']
            self.assertEqual(delta['outputDelta'], '')
            self.assertNotIn('aggregatedOutput', delta)
