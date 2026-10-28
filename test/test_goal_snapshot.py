import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('goal_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)
IDENTIFIER = '00000000-0000-0000-0000-000000000001'


class GoalSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='portal-goal-read-'))
        self.patch = patch.object(store, 'STORE', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def create(self, status='active'):
        self.file = self.root / 'goals_1.sqlite'
        with sqlite3.connect(self.file) as db:
            db.execute('CREATE TABLE thread_goals(thread_id TEXT PRIMARY KEY, objective TEXT, status TEXT, '
                       'created_at_ms INTEGER, updated_at_ms INTEGER, tokens_used INTEGER, '
                       'time_used_seconds INTEGER, token_budget INTEGER)')
            db.execute('INSERT INTO thread_goals VALUES(?,?,?,?,?,?,?,?)',
                       (IDENTIFIER, '专用测试目标', status, 100123, 200456, 50, 90, None))

    def test_missing_legacy_store_does_not_create_a_database(self):
        self.assertEqual(store.read_goal_snapshot({'threadId': IDENTIFIER}), {'goal': None})
        self.assertFalse((self.root / 'goals_1.sqlite').exists())

    def test_native_goal_is_read_without_changing_the_database(self):
        self.create()
        before = self.file.read_bytes()
        result = store.read_goal_snapshot({'threadId': IDENTIFIER})['goal']
        self.assertEqual(result['status'], 'active')
        self.assertEqual(result['createdAt'], 100)
        self.assertEqual(result['updatedAt'], 200)
        self.assertEqual(result['tokensUsed'], 50)
        self.assertEqual(result['timeUsedSeconds'], 90)
        self.assertEqual(self.file.read_bytes(), before)
        self.assertEqual(store.read_goal_snapshot({'threadId': '00000000-0000-0000-0000-000000000002'}), {'goal': None})

    def test_budget_status_uses_the_native_api_spelling(self):
        self.create('budget_limited')
        self.assertEqual(store.read_goal_snapshot({'threadId': IDENTIFIER})['goal']['status'], 'budgetLimited')

    def test_broken_store_is_not_treated_as_no_goal(self):
        self.file = self.root / 'goals_1.sqlite'
        self.file.write_bytes(b'broken database')
        with self.assertRaises(sqlite3.DatabaseError):
            store.read_goal_snapshot({'threadId': IDENTIFIER})

    def test_unknown_goal_status_is_not_treated_as_no_goal(self):
        self.create('future_status')
        with self.assertRaises(ValueError):
            store.read_goal_snapshot({'threadId': IDENTIFIER})

    def test_owner_read_precedes_goal_snapshot_and_retains_identity(self):
        self.create('paused')
        with patch.object(store, 'read_detail', return_value={'thread': {'id': IDENTIFIER, 'activity': {'state': 'running'}}}) as detail:
            result = store.read_takeover_state({'threadId': IDENTIFIER})
        detail.assert_called_once_with({'threadId': IDENTIFIER})
        self.assertEqual(result['thread']['activity']['state'], 'running')
        self.assertEqual(result['goal']['status'], 'paused')


if __name__ == '__main__':
    unittest.main()
