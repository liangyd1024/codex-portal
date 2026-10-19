import importlib.util
import json
import pathlib
import socket
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('activity_store', pathlib.Path(__file__).parents[1] / 'scripts/passive-store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class Client:
    def __init__(self, status='active', version=11, host='local', fail=False):
        self.status, self.version, self.host, self.fail = status, version, host, fail
        self.sent, self.buffer, self.closed = [], b'', False
    def settimeout(self, value): pass
    def connect(self, path): pass
    def close(self): self.closed = True
    def sendall(self, frame):
        message = json.loads(frame[4:]); self.sent.append(message)
        if message.get('method') == 'initialize':
            response = dict(type='response', requestId=message['requestId'], resultType='success', result=dict(clientId='test-observer'))
        elif message['params']['following'] and not self.fail:
            response = dict(type='broadcast', method='thread-stream-state-changed', version=self.version,
                            params=dict(hostId=self.host, conversationId='test', change=dict(type='snapshot', conversationState=dict(id='test', threadRuntimeStatus=dict(type=self.status)))))
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
        self.assertFalse(client.sent[-1]['params']['following'])
        self.assertTrue(all(m['method'] in ('initialize', 'thread-stream-following-changed') for m in client.sent))
        return result
    def test_live_active_and_idle(self):
        self.assertEqual(self.observe(Client())['test']['state'], 'running')
        self.assertEqual(self.observe(Client(status='idle'))['test']['state'], 'idle')
    def test_timeout_wrong_host_and_unsupported_version_do_not_claim_running(self):
        for client in [Client(fail=True), Client(host='other'), Client(version=10), Client(status='unknown')]:
            self.assertEqual(self.observe(client), {})
    def test_unsafe_socket_directory_is_rejected(self):
        (self.root / 'ipc').chmod(0o777)
        with patch('socket.socket') as client:
            self.assertEqual(store.desktop_activity(['test']), {})
            client.assert_not_called()
