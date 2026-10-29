import importlib.util
import json
import pathlib
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
