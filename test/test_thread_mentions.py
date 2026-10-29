import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('desktop_mentions', pathlib.Path(__file__).parents[1] / 'scripts/desktop-session.py')
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)
ID = '00000000-0000-0000-0000-000000000001'
REF = '00000000-0000-0000-0000-000000000002'

class ThreadMentionsTest(unittest.TestCase):
    def test_native_checkpoint_distinguishes_unknown_from_explicitly_unsupported(self):
        home = pathlib.Path(tempfile.mkdtemp(prefix='rcm-reference-'))
        self.assertIsNone(session.reference_capability(home, ID))
        (home / '.codex').mkdir()
        file = home / '.codex/.codex-global-state.json'
        file.write_text(json.dumps({'electron-persisted-atom-state': {'thread-reference-capability:' + ID: True}}))
        before = file.read_bytes()
        self.assertTrue(session.reference_capability(home, ID))
        self.assertIsNone(session.reference_capability(home, REF))
        self.assertEqual(before, file.read_bytes())
        file.write_text(json.dumps({'electron-persisted-atom-state': {'thread-reference-capability:' + REF: False}}))
        self.assertIs(session.reference_capability(home, REF), False)

    def native_catalog(self, records):
        home = pathlib.Path(tempfile.mkdtemp(prefix='rcm-reference-catalog-'))
        root = home / '.codex'
        (root / 'sessions').mkdir(parents=True)
        rollout = root / 'sessions/test.jsonl'
        rollout.write_text(''.join(json.dumps(r) + '\n' for r in records))
        with sqlite3.connect(root / 'state_5.sqlite') as db:
            db.execute('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)')
            db.execute('INSERT INTO threads VALUES (?, ?)', (ID, str(rollout)))
        return home, rollout

    def catalog_record(self, tools):
        return {'type': 'response_item', 'payload': {'type': 'additional_tools', 'role': 'developer', 'tools': tools}}

    def test_missing_checkpoint_uses_exact_native_tool_declaration(self):
        for tools in ([{'type': 'function', 'name': 'read_thread'}],
                      [{'type': 'namespace', 'name': 'functions', 'tools': [{'type': 'custom', 'name': 'exec', 'description':
                        'Native API\ndeclare const tools: { mcp__codex_app__read_thread(args: {\nthreadId: string;'}]}]):
            with self.subTest(tools=tools):
                home, rollout = self.native_catalog([self.catalog_record(tools)])
                before = rollout.read_bytes()
                self.assertIs(session.reference_capability(home, ID), True)
                self.assertIsNone(session.reference_capability(home, REF))
                self.assertEqual(rollout.read_bytes(), before)
                self.assertFalse((home / '.codex/.codex-global-state.json').exists())
                (home / '.codex/.codex-global-state.json').write_text(json.dumps({
                    'electron-persisted-atom-state': {'thread-reference-capability:' + ID: False}}))
                self.assertIs(session.reference_capability(home, ID), False)

    def test_catalog_is_latest_scoped_bounded_and_not_message_text(self):
        declaration = self.catalog_record([{'type': 'function', 'name': 'read_thread'}])
        home, rollout = self.native_catalog([declaration, self.catalog_record([])])
        self.assertIsNone(session.reference_capability(home, ID))
        for fake in ({'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'tools': declaration['payload']['tools']}},
                     self.catalog_record([{'type': 'function', 'name': 'other', 'description': 'read_thread'}])):
            rollout.write_text(json.dumps(fake) + '\n')
            self.assertIsNone(session.reference_capability(home, ID))
        rollout.write_text(json.dumps(declaration) + '\n' + '{"incomplete":')
        self.assertIs(session.reference_capability(home, ID), True)
        rollout.write_text(json.dumps(declaration) + '\n' + 'x' * (8 * 1024 * 1024) + '\n')
        self.assertIsNone(session.reference_capability(home, ID))
        with sqlite3.connect(home / '.codex/state_5.sqlite') as db:
            db.execute('UPDATE threads SET rollout_path = ?', (str(home / 'outside.jsonl'),))
        (home / 'outside.jsonl').write_text(json.dumps(declaration) + '\n')
        self.assertIsNone(session.reference_capability(home, ID))

    def test_native_reference_context_and_unavailable_capability(self):
        requests = []
        class Fake:
            def __init__(self, *_a, **_kw): pass
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id): return 'owner'
            def settings(self, *_a): return {}
            def request(self, method, params, version, owner, mutation):
                requests.append(params)
                return {'result': {}}
        payload = {'action': 'send', 'threadId': ID, 'messageId': ID, 'text': '仅总结引用', 'threadReferences': [{'threadId': REF, 'title': '测试标题'}]}
        with patch.object(session, 'DesktopSession', Fake), patch.object(session, 'reference_capability', return_value=False):
            with self.assertRaises(session.DesktopError): session.run(payload)
        self.assertEqual(requests, [])
        with patch.object(session, 'DesktopSession', Fake), patch.object(session, 'reference_capability', return_value=True):
            session.run(payload)
        request = requests[0]['turnStart']['request']
        text = request['input'][0]['text']
        self.assertIn('MUST call `read_thread`', text)
        self.assertIn('"hostId": "local"', text)
        self.assertIn(REF, text)
        self.assertTrue(text.endswith('## My request:\n仅总结引用\n'))
        self.assertEqual(request['clientUserMessageId'], ID)
        self.assertNotIn('model', request)

    def test_rich_inputs_survive_native_reference_context(self):
        requests = []
        class Fake:
            def __init__(self, *_a, **_kw): pass
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id): return 'owner'
            def settings(self, *_a): return {}
            def request(self, method, params, *args, **kwargs):
                requests.append(params)
                return {'result': {}}
        rich = [{'type': 'image', 'url': 'data:image/png;base64,iVBORw0KGgo='}, {'type': 'skill', 'name': 'sample', 'path': '/skills/sample/SKILL.md'}, {'type': 'mention', 'name': 'Sample', 'path': 'plugin://sample'}]
        payload = {'action': 'send', 'threadId': ID, 'messageId': ID, 'text': '', 'input': rich}
        with patch.object(session, 'DesktopSession', Fake), patch.object(session, 'reference_capability', return_value=True):
            session.run(payload)
            self.assertEqual(requests[-1]['turnStart']['request']['input'], rich)
            payload['threadReferences'] = [{'threadId': REF, 'title': 'sample'}]
            session.run(payload)
            inputs = requests[-1]['turnStart']['request']['input']
            self.assertEqual(inputs[1:], rich)
            self.assertIn(REF, inputs[0]['text'])
            payload['input'] = [{'type': 'localImage', 'path': '/private/file'}]
            with self.assertRaises(session.DesktopError): session.run(payload)
