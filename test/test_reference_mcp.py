import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('reference_mcp', pathlib.Path(__file__).parents[1] / 'scripts/reference-mcp.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
CALLER = '00000000-0000-0000-0000-000000000001'
TARGET = '00000000-0000-0000-0000-000000000002'


class ReferenceMcpTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-reference-mcp-'))
        self.scope = self.root / 'scope.json'
        self.scope.write_text(json.dumps({'caller': CALLER, 'allowed': [TARGET]}))
        self.calls = []
        calls = self.calls
        class Reader:
            def __init__(self, binary): pass
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def request(self, method, params):
                calls.append((method, params))
                if method == 'thread/read': return {'thread': {'id': TARGET, 'name': '测试会话'}}
                return {'data': [{'turnId': 'turn', 'item': {'type': 'agentMessage', 'text': '原始内容，保持完整。'}}], 'nextCursor': 'native-cursor'}
        self.Reader = Reader

    def test_native_read_only_pagination_preserves_original_messages(self):
        result = m.read_reference('configured-binary', self.scope, {'threadId': TARGET, 'cursor': 'previous-cursor', 'limit': 2}, self.Reader)
        body = json.loads(result['content'][0]['text'])
        self.assertEqual(body['page']['data'][0]['item']['text'], '原始内容，保持完整。')
        self.assertEqual(body['page']['nextCursor'], 'native-cursor')
        self.assertEqual([call[0] for call in self.calls], ['thread/read', 'thread/items/list'])
        self.assertEqual(self.calls[1][1], {'threadId': TARGET, 'cursor': 'previous-cursor', 'limit': 2, 'sortDirection': 'desc'})
        self.assertFalse(result['isError'])

    def test_unknown_targets_self_ids_and_invalid_pagination_never_start_native_reader(self):
        for args in [{'threadId': CALLER}, {'threadId': '00000000-0000-0000-0000-000000000004'}, {'threadId': TARGET, 'limit': 0}, {'threadId': TARGET, 'limit': True}, {'threadId': TARGET, 'host': 'other'}, {'threadId': TARGET, 'cursor': '../path' * 1000}]:
            with self.assertRaises(ValueError): m.read_reference('configured-binary', self.scope, args, self.Reader)
        self.assertEqual(self.calls, [])

    def test_missing_authorization_fails_closed_and_cannot_be_inferred_from_title(self):
        with self.assertRaises(FileNotFoundError): m.read_reference('binary', self.root / 'missing.json', {'threadId': TARGET}, self.Reader)
        self.assertEqual(self.calls, [])

    def test_oversized_native_item_is_reported_instead_of_silently_truncated(self):
        original = self.Reader.request
        def request(reader, method, params):
            result = original(reader, method, params)
            if method == 'thread/items/list': result['data'][0]['item']['text'] = 'x' * (m.MAX_BYTES + 1)
            return result
        self.Reader.request = request
        with self.assertRaisesRegex(ValueError, 'exceeds read limit'):
            m.read_reference('binary', self.scope, {'threadId': TARGET}, self.Reader)
