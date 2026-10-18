import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('empty_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class EmptyThreadTest(unittest.TestCase):
    def test_only_known_new_threads_allow_absent_history_and_do_not_mask_broken_schema(self):
        store.STORE = pathlib.Path(tempfile.mkdtemp(prefix='rcm-empty-history-'))
        with self.assertRaises(RuntimeError):
            store.read_history({'threadId': 'new'})
        self.assertEqual(store.read_history({'threadId': 'new', 'allowMissingStore': True})['data'], [])
        db = sqlite3.connect(store.STORE / 'thread_history_1.sqlite')
        db.close()
        with self.assertRaisesRegex(RuntimeError, '缺少数据表'):
            store.read_history({'threadId': 'new', 'allowMissingStore': True})
