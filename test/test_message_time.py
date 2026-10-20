import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('time_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class MessageTimeTest(unittest.TestCase):
    def history(self, with_times, preview=False):
        root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-message-time-'))
        store.STORE = root
        db = sqlite3.connect(root / 'thread_history_1.sqlite')
        db.execute('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,error_json TEXT,started_at INTEGER,completed_at INTEGER,duration_ms INTEGER)')
        db.execute("INSERT INTO thread_turns VALUES ('thread','turn',1,'completed',null,100,200,100000)")
        db.execute('CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,item_json TEXT' + (',created_at_ms INTEGER' if with_times else '') + ')')
        for index, time in enumerate([100123,150456]):
            values = ['thread','turn','u'+str(index),index,json.dumps({'id':'u'+str(index),'type':'userMessage','content':[{'type':'text','text':'原文'}]})]
            if with_times:
                values.append(time)
            db.execute('INSERT INTO thread_items VALUES (' + ','.join('?' for _ in values) + ')', values)
        db.commit()
        db.close()
        return store.read_history({'threadId':'thread','preview':preview})['data'][0]

    def test_each_message_keeps_its_native_time_including_preview(self):
        for preview in [False,True]:
            turn = self.history(True,preview)
            self.assertEqual([item['createdAtMs'] for item in turn['items']], [100123,150456])
            self.assertEqual(turn['durationMs'],100000)
            self.assertEqual(turn['items'][0]['content'],[{'type':'text','text':'原文'}])

    def test_old_snapshot_does_not_fabricate_message_times(self):
        turn = self.history(False)
        self.assertTrue(all('createdAtMs' not in item for item in turn['items']))
        self.assertEqual(turn['startedAt'],100)
