import unittest
import test_goal_history as fixture
store = fixture.store


class CollaborationModeTest(unittest.TestCase):
    setUp = fixture.GoalHistoryTest.setUp
    tearDown = fixture.GoalHistoryTest.tearDown
    record = fixture.GoalHistoryTest.record
    def mode_turn(self, name, mode=None, context_id=None):
        start = self.stream.tell()
        self.record('event_msg', {'type':'task_started', 'turn_id':name})
        if mode is not None:
            self.record('turn_context', {'turn_id':context_id or name, 'collaboration_mode':{'mode':mode}})
        self.db.execute('INSERT INTO thread_turns VALUES (?,?,?,?,?,?,?,?,?,?)', ('thread', name, self.ordinal, 'completed', None, 123, 124, 1000, start, self.stream.tell()))
        self.db.commit()

    def test_native_modes_survive_reload_and_paginate(self):
        for i in range(7): self.mode_turn(str(i), 'plan' if i % 2 == 0 else 'default')
        first = store.read_history({'threadId':'thread'})
        second = store.read_history({'threadId':'thread', 'cursor':first['nextCursor']})
        turns = first['data'] + second['data']
        self.assertEqual([t['collaborationMode']['mode'] for t in turns], ['plan','default','plan','default','plan','default','plan'])
        self.assertEqual(store.read_history({'threadId':'thread', 'preview':True})['data'][0]['collaborationMode'], {'mode':'plan'})

    def test_unknown_mismatched_and_missing_context_are_not_default(self):
        self.mode_turn('first', 'plan')
        self.mode_turn('missing')
        self.mode_turn('mismatch', 'plan', 'first')
        self.mode_turn('invalid', 'other')
        turns = store.read_history({'threadId':'thread'})['data']
        self.assertTrue(all('collaborationMode' not in t for t in turns[:3]))
        self.path.rename(self.root / 'missing.jsonl')
        self.assertTrue(all('collaborationMode' not in t for t in store.read_history({'threadId':'thread'})['data']))

    def test_context_scan_is_bounded(self):
        start = self.stream.tell()
        self.record('event_msg', {'type':'task_started', 'turn_id':'large'})
        self.record('response_item', {'text':'x' * 524288})
        self.record('turn_context', {'turn_id':'large', 'collaboration_mode':{'mode':'plan'}})
        self.db.execute('INSERT INTO thread_turns VALUES (?,?,?,?,?,?,?,?,?,?)', ('thread', 'large', self.ordinal, 'completed', None, 123, 124, 1000, start, self.stream.tell()))
        self.db.commit()
        self.assertNotIn('collaborationMode', store.read_history({'threadId':'thread'})['data'][0])
