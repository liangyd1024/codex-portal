import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest
import os
import time
import json
import struct
import plistlib
from types import SimpleNamespace
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).parents[1] / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

store = load('automation_store', 'automation-store.py')
session = load('desktop_session', 'desktop-session.py')


class AutomationStoreTest(unittest.TestCase):
    def setUp(self):
        self.home = pathlib.Path(tempfile.mkdtemp(prefix='rcm-automation-'))
        self.root = self.home / '.codex'
        (self.root / 'sqlite').mkdir(parents=True)
        self.dbpath = self.root / 'sqlite/codex.db'
        self.db = sqlite3.connect(self.dbpath)
        self.db.execute('CREATE TABLE automations (id TEXT, name TEXT, prompt TEXT, status TEXT, rrule TEXT, kind TEXT, target_thread_id TEXT, project_id TEXT, next_run_at INTEGER, last_run_at INTEGER, updated_at INTEGER, account_id TEXT,user_id TEXT,installation_id TEXT)')
        self.db.execute('CREATE TABLE automation_runs (thread_id TEXT,automation_id TEXT,status TEXT,thread_title TEXT,inbox_title TEXT,inbox_summary TEXT,created_at INTEGER,updated_at INTEGER)')
        self.db.execute("INSERT INTO automations (id,name,status,updated_at) VALUES ('test','test','PAUSED',?)", (int(time.time()*1000),))
        self.db.commit()
        self.config = self.root / 'automations/test/automation.toml'
        self.config.parent.mkdir(parents=True)
        self.config.write_text('name = "test"')

    def tearDown(self):
        self.db.close()  # Fixtures intentionally retained; no recursive deletion.

    def test_read_only_and_missing_native_definition(self):
        before = self.dbpath.read_bytes()
        self.assertEqual(store.read_automations(self.home)['items'][0]['id'], 'test')
        self.assertEqual(before, self.dbpath.read_bytes())
        self.config.rename(self.config.with_suffix('.bak'))
        self.assertEqual(store.read_automations(self.home)['items'], [])

    def test_stale_snapshot_is_not_presented_as_current(self):
        os.utime(self.config, (time.time()+10, time.time()+10))
        result = store.read_automations(self.home)
        self.assertTrue(result['pendingNativeRefresh'])
        self.assertEqual(result['items'], [])

    def test_ambiguous_store_and_account_migration_fail_closed(self):
        self.db.execute("UPDATE automations SET account_id='other'")
        self.db.commit()
        with self.assertRaisesRegex(ValueError, '账户存储迁移'):
            store.read_automations(self.home)
        (self.root / 'sqlite/codex-dev.db').touch()
        with self.assertRaisesRegex(ValueError, '唯一'):
            store.read_automations(self.home)


class DesktopSessionTest(unittest.TestCase):
    def test_observer_answers_discovery_without_claiming_a_thread(self):
        discovery = {'type':'client-discovery-request','requestId':'discovery','request':{'method':'thread-owner-discovery'}}
        reply = {'type':'response','requestId':'own-request','resultType':'success'}
        frames = b''.join(struct.pack('<I',len(data))+data for data in [json.dumps(discovery).encode(),json.dumps(reply).encode()])
        class Socket:
            buffer = frames
            sent = []
            def settimeout(self, _value): pass
            def recv(self, size):
                part, self.buffer = self.buffer[:size], self.buffer[size:]
                return part
            def sendall(self, data): self.sent.append(json.loads(data[4:]))
        client = session.DesktopSession('/fixture');client.client = Socket()
        self.assertEqual(client.receive(time.monotonic()+1),reply)
        self.assertEqual(client.client.sent,[{'type':'client-discovery-response','requestId':'discovery','response':{'canHandle':False}}])

    def test_availability_requires_running_configured_app_and_existing_ipc(self):
        root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-desktop-availability-'))
        app = root/'Fixture.app';(app/'Contents/MacOS').mkdir(parents=True)
        (app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable':'Fixture'}))
        binary = app/'Contents/Resources/codex'
        app_binary = str(app/'Contents/MacOS/Fixture')
        with patch.object(session,'SERVICE_BINARY',str(binary),create=True),patch.object(session.sys,'platform','darwin'),patch.object(session,'DesktopSession') as ipc,patch.object(session.subprocess,'run') as run:
            run.return_value=SimpleNamespace(stdout='/fixture/unrelated\n')
            self.assertEqual(session.run({'action':'availability'}),{'available':False});ipc.assert_not_called()
            run.return_value=SimpleNamespace(stdout=app_binary+'\n')
            self.assertEqual(session.run({'action':'availability'}),{'available':True});ipc.assert_called_once()
            ipc.side_effect=session.DesktopError('socket unavailable')
            with self.assertRaisesRegex(session.DesktopError,'socket unavailable'):session.run({'action':'availability'})

    def test_no_write_retry_after_disconnection(self):
        client = session.DesktopSession('/nonexistent', timeout=.1)
        calls = []
        client.send = lambda message: calls.append(message)
        client.receive = lambda _: (_ for _ in ()).throw(EOFError())
        with self.assertRaises(session.DesktopError) as caught:
            client.request('thread-follower-start-turn', {}, 2, 'owner', mutation=True)
        self.assertEqual(caught.exception.code, 'OUTCOME_UNKNOWN')
        self.assertEqual(len(calls), 1)

    def test_native_protocol_version_error_is_not_a_success(self):
        client = session.DesktopSession('/nonexistent')
        sent = []
        client.send = lambda message: sent.append(message)
        client.receive = lambda _: {'type': 'response', 'requestId': sent[0]['requestId'], 'resultType': 'error', 'error': 'request-version-mismatch'}
        with self.assertRaisesRegex(session.DesktopError, 'request-version-mismatch'):
            client.request('thread-owner-discovery', {}, 1)

    def test_interrupt_preserves_expected_turn_and_send_inherits_settings(self):
        requests = []
        class Fake:
            def __init__(self, *_a, **_kw): pass
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id): return 'owner'
            def settings(self, *_a): raise AssertionError('ordinary sends must inherit settings without a read')
            def request(self, method, params, version, owner, mutation):
                requests.append((method, params, version, owner, mutation))
                return {'result': {}}
        identifier = '00000000-0000-0000-0000-000000000001'
        with patch.object(session, 'DesktopSession', Fake):
            session.run({'action':'send','threadId':identifier,'messageId':identifier,'text':'hello'})
            session.run({'action':'interrupt','threadId':identifier,'turnId':identifier})
        self.assertTrue(requests[0][1]['turnStart']['context']['inheritThreadSettings'])
        self.assertNotIn('model', requests[0][1]['turnStart']['request'])
        self.assertEqual(requests[1][1]['expectedTurnId'], identifier)
        self.assertEqual(requests[1][2], 4)

    def test_running_input_uses_native_steer_and_restore_context(self):
        requests = []
        class Fake:
            def __init__(self, *_a, **_kw): pass
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id): return 'owner'
            def settings(self, *_a): return {}
            def request(self, method, params, version, owner, mutation):
                requests.append((method, params, version, owner, mutation))
                return {'result': {'result': {'turnId': 'turn'}}}
        identifier = '00000000-0000-0000-0000-000000000001'
        with patch.object(session, 'DesktopSession', Fake):
            session.run({'action':'send','threadId':identifier,'messageId':identifier,
                         'text':'answer','steer':True,'cwd':'/test/project','questionReply':True})
        method, params, version, owner, mutation = requests[0]
        self.assertEqual(method, 'thread-follower-steer-turn')
        self.assertEqual(version, 1)
        self.assertEqual(params['clientUserMessageId'], identifier)
        self.assertEqual(params['restoreMessage']['context']['workspaceRoots'], ['/test/project'])
        self.assertEqual(params['restoreMessage']['context']['turnTrigger'], 'send_user_message_async_question')
        self.assertNotIn('turnStart', params)

    def test_router_rejection_is_known_not_sent(self):
        client = session.DesktopSession('/nonexistent')
        sent = []
        client.send = lambda message: sent.append(message)
        client.receive = lambda _: {'type':'response', 'requestId':sent[0]['requestId'],
                                    'resultType':'error', 'error':'no-client-found'}
        with self.assertRaises(session.DesktopError) as caught:
            client.request('thread-follower-steer-turn', {}, 1, 'owner', mutation=True)
        self.assertEqual(caught.exception.code, 'DESKTOP_NOT_SENT')
        self.assertEqual(len(sent), 1)

    def test_recovery_navigates_once_and_retries_only_read_discovery(self):
        calls = []
        class Fake:
            def __init__(self, *_a, **_kw): pass
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id):
                calls.append('discover')
                if len(calls) == 1:
                    raise session.DesktopError('桌面请求未获确认：no-client-found')
                return 'owner'
            def settings(self, *_a): return {}
        identifier = '00000000-0000-0000-0000-000000000001'
        with patch.object(session, 'DesktopSession', Fake), patch.object(session.sys, 'platform', 'darwin'), \
             patch.object(session, 'SERVICE_BINARY', '/Applications/Example.app/Contents/Resources/CLI.app/Contents/MacOS/codex', create=True), \
             patch.object(session.subprocess, 'run') as open_url, patch.object(session.time, 'sleep'):
            result = session.run({'action':'recover','threadId':identifier})
        self.assertTrue(result['available'])
        self.assertEqual(calls, ['discover','discover'])
        self.assertEqual(open_url.call_count, 1)
        self.assertEqual(open_url.call_args.args[0], ['/usr/bin/open','-a','/Applications/Example.app','codex://threads/'+identifier])

    def test_recovery_bounds_read_timeouts_and_closes_each_observer_without_reopening_app(self):
        timeouts, closed = [], []
        class Fake:
            def __init__(self, *_a, **kw): timeouts.append(kw['timeout'])
            def __enter__(self): return self
            def __exit__(self, *_a): closed.append(True)
            def owner(self, _id):
                raise session.DesktopError('timeout') from session.socket.timeout()
        with patch.object(session, 'DesktopSession', Fake), patch.object(session.sys, 'platform', 'darwin'), \
             patch.object(session, 'SERVICE_BINARY', '/Applications/Example.app/Contents/MacOS/codex', create=True), \
             patch.object(session.subprocess, 'run') as open_url, patch.object(session.time, 'sleep'):
            with self.assertRaises(session.DesktopError):
                session.run({'action':'recover','threadId':'00000000-0000-0000-0000-000000000001'})
        self.assertEqual(timeouts, [2,2,2,2])
        self.assertEqual(len(closed), 4)
        self.assertEqual(open_url.call_count, 1)


class DesktopPlanTest(unittest.TestCase):
    def test_explicit_modes_use_native_model_and_effort_without_changing_global_settings(self):
        requests = []
        class Fake:
            def __init__(self, *_a, **_kw): pass
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id): return 'owner'
            def settings(self, *_a): return {'settings': {'model': 'native-model', 'reasoningEffort': 'high'}}
            def request(self, method, params, version, owner, mutation):
                requests.append((method, params, version))
                return {'result': {}}
        identifier = '00000000-0000-0000-0000-000000000001'
        with patch.object(session, 'DesktopSession', Fake):
            for mode in ['plan', 'default']:
                session.run({'action':'send','threadId':identifier,'messageId':identifier,'text':'test','mode':mode})
            with self.assertRaisesRegex(session.DesktopError, '结束后'):
                session.run({'action':'send','threadId':identifier,'messageId':identifier,'text':'test','mode':'plan','steer':True})
        self.assertEqual(len(requests), 2)
        for index, mode in enumerate(['plan', 'default']):
            self.assertEqual(requests[index][0], 'thread-follower-start-turn')
            self.assertEqual(requests[index][2], 2)
            self.assertEqual(requests[index][1]['turnStart']['request']['collaborationMode'],
                             {'mode':mode,'settings':{'model':'native-model','reasoning_effort':'high'}})

class DesktopSettingsTest(unittest.TestCase):
    def test_conditional_native_settings_and_readback(self):
        requests = []
        class Fake:
            native = {'model': 'old', 'reasoningEffort': None}
            applied = True
            def __init__(self, *_a, **_kw): pass
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id): return 'owner'
            def settings(self, *_a): return {'settings': dict(self.native)}
            def request(self, method, params, version, owner, mutation):
                requests.append((method, params, version, mutation))
                if self.applied: Fake.native = {'model':'next','reasoningEffort':'high'}
                return {'result': {'applied': self.applied}}
        payload = {'action':'settings','threadId':'00000000-0000-0000-0000-000000000001','model':'next','effort':'high','expected':dict(Fake.native)}
        with patch.object(session, 'DesktopSession', Fake):
            result = session.run(payload)
            self.assertEqual(result['settings'], {'model':'next','reasoningEffort':'high'})
            with self.assertRaises(session.DesktopError) as stale:
                session.run(payload)
            self.assertEqual(stale.exception.code, 'STALE_SETTINGS')
            Fake.native = dict(payload['expected']); Fake.applied = False
            with self.assertRaises(session.DesktopError): session.run(payload)
        self.assertEqual(len(requests), 2)
        method, params, version, mutation = requests[0]
        self.assertEqual(method, 'thread-follower-update-thread-settings')
        self.assertEqual(version, 2); self.assertTrue(mutation)
        self.assertEqual(params['condition'], {'ifModelEquals':'old','ifEffortEquals':None})
        self.assertEqual(params['threadSettings'], {'model':'next','effort':'high'})
        self.assertNotIn('activeTurnId', params)

class DesktopBlockingQuestionTest(unittest.TestCase):
    def test_live_request_validation_and_native_response(self):
        identifier = '00000000-0000-0000-0000-000000000001'
        payload = {'threadId': identifier, 'turnId': 'turn', 'itemId': 'call', 'requestId': 0,
                   'ownerClientId': 'owner', 'answers': {'q': {'answers': ['中文答案']}}}
        calls = []
        class Fake:
            def snapshot(self, *_):
                return {'threadRuntimeStatus': {'type':'active'}, 'requests': [
                    {'id':0,'method':'item/tool/requestUserInput','params':{
                        'threadId':identifier,'turnId':'turn','itemId':'call','questions':[{'id':'q'}]}}]}
            def request(self, *args, **kwargs):
                calls.append((args, kwargs)); return {'result': {'ok': True}}
        for patch_data in [{'ownerClientId':'other'}, {'requestId':'0'}, {'turnId':'old'}, {'itemId':'old'},
                           {'answers':{}}, {'answers':{'q':{'answers':['']}}}]:
            with self.assertRaises(session.DesktopError):
                session.answer_question(Fake(), identifier, 'owner', {**payload, **patch_data})
        self.assertEqual(calls, [])
        self.assertEqual(session.answer_question(Fake(), identifier, 'owner', payload), {'resolved':True})
        args, kwargs = calls[0]
        self.assertEqual(args, ('thread-follower-submit-user-input', {
            'conversationId':identifier,'requestId':0,'response':{'answers':payload['answers']}},1,'owner'))
        self.assertTrue(kwargs['mutation'])

    def test_snapshot_only_accepts_current_owner_version_and_unfollows_on_failure(self):
        client = session.DesktopSession('/unused', timeout=.1);sent=[]
        client.send=lambda message:sent.append(message)
        base={'type':'broadcast','method':'thread-stream-state-changed','version':11,'sourceClientId':'owner',
              'params':{'hostId':'local','conversationId':'thread','change':{'type':'snapshot','conversationState':{'id':'thread','requests':[]}}}}
        replies=iter([{**base,'sourceClientId':'old'},{**base,'version':10},base])
        client.receive=lambda _:next(replies)
        self.assertEqual(client.snapshot('thread','owner')['requests'],[])
        self.assertEqual([m['params']['following'] for m in sent],[True,False])
        client.receive=lambda _:(_ for _ in ()).throw(EOFError())
        with self.assertRaises(session.DesktopError):client.snapshot('thread','owner')
        self.assertFalse(sent[-1]['params']['following'])
