import importlib.util
import json
import pathlib
import sqlite3
import socket
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('activity_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class Client:
    def __init__(self, status='active', version=11, host='local', fail=False, stale=None, owner=True, source='test-owner', extra=None):
        self.status, self.version, self.host, self.fail = status, version, host, fail
        self.sent, self.buffer, self.closed = [], b'', False
        self.stale, self.owner, self.source = stale, owner, source
        self.extra = extra or {}
    def settimeout(self, value): pass
    def connect(self, path): pass
    def close(self): self.closed = True
    def sendall(self, frame):
        message = json.loads(frame[4:]); self.sent.append(message)
        if message.get('type') == 'client-discovery-response': return
        if message.get('method') == 'initialize':
            response = dict(type='response', requestId=message['requestId'], resultType='success', result=dict(clientId='test-observer'))
        elif message.get('method') == 'thread-owner-discovery':
            response = dict(type='response', requestId=message['requestId'], resultType='success' if self.owner else 'error',
                            handledByClientId='test-owner' if self.owner else None, result={})
        elif message['params']['following'] and not self.fail:
            if self.stale is not None:
                old = dict(type='broadcast', method='thread-stream-state-changed', sourceClientId='old-window', version=11,
                           params=dict(hostId='local', conversationId='test', change=dict(type='snapshot', conversationState=dict(id='test', threadRuntimeStatus=dict(type=self.stale)))))
                data = json.dumps(old).encode(); self.buffer += struct.pack('<I', len(data)) + data
            response = dict(type='broadcast', method='thread-stream-state-changed', sourceClientId=self.source, version=self.version,
                            params=dict(hostId=self.host, conversationId='test', change=dict(type='snapshot', conversationState=dict(id='test', threadRuntimeStatus=dict(type=self.status), **self.extra))))
        else: return
        data = json.dumps(response).encode(); self.buffer += struct.pack('<I', len(data)) + data
    def recv(self, size):
        if not self.buffer: raise TimeoutError()
        part, self.buffer = self.buffer[:size], self.buffer[size:]; return part


class DesktopActivityTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-activity-'))
        (self.root / 'ipc').mkdir(mode=0o700)
        self.endpoint = socket.socket(socket.AF_UNIX)
        self.endpoint.bind(str(self.root / 'ipc/ipc.sock'))
        self.previous = store.STORE; store.STORE = self.root
    def tearDown(self):
        self.endpoint.close(); store.STORE = self.previous
    def observe(self, client):
        with patch('socket.socket', return_value=client):
            result = store.desktop_activity(['test'])
        self.assertTrue(client.closed)
        following = [m for m in client.sent if m.get('method') == 'thread-stream-following-changed']
        if following:
            self.assertFalse(following[-1]['params']['following'])
            self.assertEqual(sum(not m['params']['following'] for m in following), 1)
            self.assertTrue(all(m.get('targetClientIds') == ['test-owner'] for m in following))
        self.assertTrue(all(m.get('method') in ('initialize', 'thread-owner-discovery', 'thread-stream-following-changed') or m.get('type')=='client-discovery-response' for m in client.sent))
        return result
    def test_observer_declines_owner_discovery_while_reading_activity(self):
        client=Client()
        request={'type':'client-discovery-request','requestId':'discovery','request':{'method':'thread-owner-discovery'}}
        data=json.dumps(request).encode();client.buffer=struct.pack('<I',len(data))+data
        self.assertEqual(self.observe(client)['test']['state'],'running')
        self.assertIn({'type':'client-discovery-response','requestId':'discovery','response':{'canHandle':False}},client.sent)
    def test_sidebar_question_flag_does_not_expose_request_contents(self):
        request = {'method': 'item/tool/requestUserInput', 'params': {'threadId': 'test', 'questions': [{'question': 'fixture'}]}}
        result = self.observe(Client(extra={'requests': [request]}))['test']
        self.assertTrue(result['needsAnswer'])
        self.assertNotIn('pendingRequests', result)
        request['params']['threadId'] = 'other'
        self.assertFalse(self.observe(Client(extra={'requests': [request]}))['test']['needsAnswer'])

    def test_sidebar_missing_live_candidate_is_unknown(self):
        from unittest.mock import MagicMock
        db = MagicMock()
        db.execute.return_value.__iter__.return_value = iter([('candidate',)])
        db.execute.return_value.fetchone.return_value = None
        rows = [{'id': 'candidate'}, {'id': 'done'}]
        with patch.object(store, 'connect_store', return_value=db), patch.object(store, 'desktop_activity', return_value={}):
            store.sidebar_activity(rows)
        self.assertEqual(rows[0]['activity'], {'state': 'unknown'})
        self.assertNotIn('activity', rows[1])
        with patch.object(store, 'connect_store', side_effect=RuntimeError('unavailable')):
            store.sidebar_activity(rows)
        self.assertTrue(all(t['activity']['state'] == 'unknown' for t in rows))

    def test_live_active_and_idle(self):
        self.assertEqual(self.observe(Client())['test']['state'], 'running')
        self.assertEqual(self.observe(Client(status='idle'))['test']['state'], 'idle')
    def test_timeout_wrong_host_and_unsupported_version_do_not_claim_running(self):
        for client in [Client(fail=True), Client(host='other'), Client(version=10), Client(status='unknown'), Client(status='notLoaded'), Client(status='systemError'), Client(source='stale-window'), Client(owner=False)]:
            self.assertEqual(self.observe(client), {})
    def test_unsafe_socket_directory_is_rejected(self):
        (self.root / 'ipc').chmod(0o777)
        with patch('socket.socket') as client:
            self.assertEqual(store.desktop_activity(['test']), {})
            client.assert_not_called()

    def test_stale_window_cannot_override_the_actual_owner_in_either_state(self):
        self.assertEqual(self.observe(Client(status='idle', stale='active'))['test']['state'], 'idle')
        self.assertEqual(self.observe(Client(status='active', stale='idle'))['test']['state'], 'running')

    def test_missing_owner_does_not_follow_or_trust_a_stale_window(self):
        client = Client(owner=False, stale='active')
        self.assertEqual(self.observe(client), {})
        self.assertFalse(any(m['method'] == 'thread-stream-following-changed' for m in client.sent))

    def test_active_turn_only_uses_current_canonical_entries(self):
        old = '00000000-0000-0000-0000-000000000001'
        current = '00000000-0000-0000-0000-000000000002'
        history = {'entitiesByKey': {'old': {'turnId': old, 'status': 'inProgress'},
                                    'current': {'turnId': current, 'status': 'inProgress'}},
                   'islands': [{'entries': [{'value': 'current'}]}]}
        state = {'turnHistory': {'kind': 'canonical', 'history': history}}
        self.assertEqual(store.desktop_active_turn(state), current)
        history['islands'][0]['entries'].append({'value': 'old'})
        self.assertIsNone(store.desktop_active_turn(state))
        history['entitiesByKey']['old']['status'] = 'completed'
        self.assertEqual(store.desktop_active_turn(state), current)

    def test_legacy_turn_snapshot_requires_unique_real_turn_id(self):
        current = '00000000-0000-0000-0000-000000000002'
        self.assertEqual(store.desktop_active_turn({'turns': [{'turnId': current, 'status': 'inProgress'}]}), current)
        self.assertIsNone(store.desktop_active_turn({'turns': [{'turnId': 'optimistic-id', 'status': 'inProgress'}]}))
        self.assertIsNone(store.desktop_active_turn({'turns': [{'turnId': current, 'status': 'completed'}]}))

    def test_detail_reuses_snapshot_for_questions_and_accepted_steering_only(self):
        turn = '00000000-0000-0000-0000-000000000002'
        request = {'id':7,'method':'item/tool/requestUserInput','params':{'threadId':'test','turnId':turn}}
        accepted = {'id':'s','type':'steeringUserMessage','status':'accepted','input':[{'type':'text','text':'原文'}]}
        extra = {'requests':[request,{**request,'method':'other'}],
                 'turns':[{'turnId':turn,'status':'inProgress','items':[accepted,{**accepted,'id':'rejected','status':'rejected'}]}]}
        client = Client(extra=extra)
        with patch('socket.socket', return_value=client):
            detail = store.desktop_activity(['test'], include_requests=True)['test']
        self.assertEqual(detail['pendingRequests'],[request])
        self.assertEqual(detail['steeringMessages'],[accepted])
        self.assertEqual(detail['ownerClientId'],'test-owner')
        self.assertNotIn('pendingRequests', self.observe(Client(extra=extra))['test'])

    def test_idle_owner_reports_only_current_canonical_terminal_turn(self):
        history = {'entitiesByKey': {
            'old': {'turnId': 'old', 'status': 'inProgress'},
            'current': {'turnId': 'current', 'status': 'completed'}},
            'islands': [{'entries': [{'value': 'current'}]}]}
        extra = {'turnHistory': {'kind': 'canonical', 'history': history},
                 'turns': [{'turnId': 'stale-legacy', 'status': 'failed'}]}
        idle = self.observe(Client(status='idle', extra=extra))['test']
        self.assertEqual(idle['latestTurn'], {'id': 'current', 'status': 'completed'})
        self.assertNotIn('latestTurn', self.observe(Client(status='active', extra=extra))['test'])
        history['islands'] = []
        self.assertNotIn('latestTurn', self.observe(Client(status='idle', extra=extra))['test'])


class CompletionSnapshotTest(unittest.TestCase):
    def test_latest_turn_status_is_read_without_items(self):
        import sqlite3
        root = pathlib.Path(tempfile.mkdtemp(prefix='portal-completion-'))
        db = sqlite3.connect(root / 'thread_history_1.sqlite')
        db.execute('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,rollout_ordinal INTEGER)')
        db.executemany('INSERT INTO thread_turns VALUES(?,?,?,?)', [('chat','old','completed',1),('chat','new','failed',2),('done','last','completed',1)])
        db.commit(); db.close()
        rows = [{'id':'chat'},{'id':'done'},{'id':'empty'}]
        with patch.object(store,'STORE',root), patch.object(store,'desktop_activity',return_value={}):
            store.sidebar_activity(rows)
        self.assertEqual(rows[0]['latestTurn'], {'id':'new','status':'failed'})
        self.assertEqual(rows[1]['latestTurn'], {'id':'last','status':'completed'})
        self.assertNotIn('latestTurn',rows[2])
        live = {'chat': {'source': 'desktop', 'state': 'idle',
                         'latestTurn': {'id': 'live-newest', 'status': 'completed'}}}
        with patch.object(store, 'STORE', root), patch.object(store, 'desktop_activity', return_value=live):
            store.sidebar_activity(rows)
        self.assertEqual(rows[0]['latestTurn'], live['chat']['latestTurn'])



class CliTurnsTest(unittest.TestCase):
    def test_only_latest_requested_turn_is_read_without_modifying_store(self):
        root = pathlib.Path(tempfile.mkdtemp(prefix='rcm-cli-turns-'))
        identifier = '00000000-0000-0000-0000-000000000001'
        database = root / 'thread_history_1.sqlite'
        with sqlite3.connect(database) as db:
            db.execute('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,rollout_ordinal INTEGER)')
            db.executemany('INSERT INTO thread_turns VALUES(?,?,?,?,?)', [(identifier,'old','inProgress',100,1),(identifier,'new','completed',200,2)])
        before = database.read_bytes()
        with patch.object(store, 'STORE', root):
            self.assertEqual(store.read_cli_turns({'threadIds':[identifier]})['data'], [{'threadId':identifier,'id':'new','status':'completed','startedAt':200}])
            for invalid in ['bad', ['bad'], [identifier]*201]:
                with self.assertRaises(ValueError): store.read_cli_turns({'threadIds':invalid})
        self.assertEqual(before, database.read_bytes())
