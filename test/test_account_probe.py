import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

spec = importlib.util.spec_from_file_location('account_probe', pathlib.Path(__file__).parents[1] / 'scripts/account-probe.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AccountProbeTest(unittest.TestCase):
    def test_native_probe_initializes_and_reads_only_account(self):
        root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-account-probe-'))
        binary = root / 'fake-native'
        calls = root / 'calls.jsonl'
        binary.write_text('''#!/usr/bin/python3
import json,sys
for line in sys.stdin:
 value=json.loads(line)
 with open('calls.jsonl','a') as out: out.write(json.dumps(value)+'\\n')
 if value.get('id')==1: print(json.dumps({'id':1,'result':{}}),flush=True)
 if value.get('id')==2:
  print(json.dumps({'id':2,'result':{'account':{'type':'chatgpt','email':'sample@example.test'},'workspaceRouting':{'chatgptAccountId':'sample'},'requiresOpenaiAuth':True}}),flush=True)
''')
        binary.chmod(0o700)
        result = module.probe(binary, root)
        self.assertEqual(result['account']['type'], 'chatgpt')
        requests = [json.loads(line) for line in calls.read_text().splitlines()]
        self.assertEqual([r['method'] for r in requests], ['initialize', 'initialized', 'account/read'])
        self.assertEqual(requests[-1]['params'], {'refreshToken': False})

    def test_metadata_signal_does_not_read_credentials(self):
        root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-account-metadata-'))
        (root / '.codex').mkdir()
        auth = root / '.codex/auth.json'
        auth.write_text('DO NOT READ CREDENTIAL CONTENT')
        module.SERVICE_HOME = str(root)
        module.PAYLOAD = {'probe': False}
        with patch.object(pathlib.Path, 'read_text', side_effect=AssertionError('credential read')):
            out = StringIO()
            with redirect_stdout(out): module.main()
        value = json.loads(out.getvalue().removeprefix('RCM_JSON:'))
        self.assertEqual(len(value['stamp']), 64)
        self.assertNotIn('DO NOT READ', out.getvalue())
