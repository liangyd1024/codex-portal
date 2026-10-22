import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('goal_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class GoalHistoryTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-goal-history-'))
        store.STORE = self.root
        self.path = self.root / 'rollout.jsonl'
        self.db = sqlite3.connect(self.root / 'thread_history_1.sqlite')
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,error_json TEXT,started_at INTEGER,completed_at INTEGER,duration_ms INTEGER,rollout_byte_offset INTEGER,rollout_end_byte_offset INTEGER)')
        self.db.execute('CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,item_json TEXT)')
        with sqlite3.connect(self.root / 'state_5.sqlite') as db:
            db.execute('CREATE TABLE threads(id TEXT,rollout_path TEXT)')
            db.execute('INSERT INTO threads VALUES (?,?)', ('thread', str(self.path)))
        self.stream = self.path.open('wb')
        self.ordinal = 0

    def tearDown(self):
        self.stream.close()
        self.db.close()

    def record(self, kind, value):
        self.ordinal += 1
        self.stream.write((json.dumps({'type': kind, 'payload': value}) + '\n').encode())
        self.stream.flush()

    def goal(self, objective, explicit=True, status_only=False):
        if explicit:
            self.record('response_item', {'type':'message', 'role':'user', 'id':'goal-' + str(self.ordinal), 'content':[{'type':'input_text', 'text':'<codex_internal_context source="user_goal">\n' + ('User set goal status: "active".' if status_only else 'User set the goal: "' + objective + '"')}], 'internal_chat_message_metadata_passthrough':{'content_item_kinds':['user.goal']}})
        self.record('event_msg', {'type':'thread_goal_updated', 'threadId':'thread', 'goal':{'objective':objective, 'updatedAt':123}})

    def turn(self, name):
        start = self.stream.tell()
        self.record('event_msg', {'type':'task_started', 'turn_id':name})
        self.db.execute('INSERT INTO thread_turns VALUES (?,?,?,?,?,?,?,?,?,?)', ('thread', name, self.ordinal, 'completed', None, 123, 124, 1000, start, self.stream.tell()))
        self.db.commit()

    def test_original_goal_survives_reload_without_repeating_on_continuations(self):
        objective = '原始目标\n第二行 <内容> "引号"'
        self.goal(objective)
        self.turn('first')
        self.goal(objective, explicit=False)
        self.turn('continued')
        self.goal(objective, status_only=True)
        self.turn('resumed')
        for _ in range(2):
            turns = store.read_history({'threadId':'thread'})['data']
            self.assertEqual([len(t['items']) for t in turns], [0, 0, 1])
            self.assertEqual(turns[2]['items'][0]['objective'], objective)
            self.assertEqual(turns[2]['items'][0]['type'], 'goalMessage')

    def test_updates_and_pagination_keep_each_goal_with_its_own_turn(self):
        for i in range(7):
            self.goal('目标' + str(i))
            self.turn(str(i))
        first = store.read_history({'threadId':'thread', 'preview':True})
        self.assertEqual(len(first['data']), 1)
        turns = first['data']
        cursor = first['nextCursor']
        while cursor:
            page = store.read_history({'threadId':'thread', 'cursor':cursor})
            turns += page['data']
            cursor = page['nextCursor']
        self.assertEqual([t['items'][0]['objective'] for t in turns], ['目标'+str(i) for i in reversed(range(7))])

    def test_missing_rollout_preserves_normal_history(self):
        self.turn('first')
        self.path.rename(self.root / 'unavailable.jsonl')
        self.assertEqual(store.read_history({'threadId':'thread'})['data'][0]['items'], [])
