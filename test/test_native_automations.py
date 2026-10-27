import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest
import os
import time
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
            def settings(self, *_a): return {}
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
            def __init__(self, *_a, **_kw): self.count = 0
            def __enter__(self): return self
            def __exit__(self, *_a): pass
            def owner(self, _id):
                self.count += 1
                calls.append('discover')
                if self.count == 1:
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
