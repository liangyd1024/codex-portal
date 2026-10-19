import importlib.util
import json
import pathlib
import socket
import sqlite3
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('desktop_notify', pathlib.Path(__file__).parents[1] / 'scripts/desktop-notify.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DesktopNotifyTest(unittest.TestCase):
    def setUp(self):
        self.home = pathlib.Path(tempfile.mkdtemp(prefix='rcm-ipc-', dir='/tmp'))
        module.STORE_HOME = str(self.home)
        self.directory = self.home / '.codex/ipc'
        self.directory.mkdir(parents=True, mode=0o700)
        db = sqlite3.connect(self.home / '.codex/state_5.sqlite')
        db.execute('CREATE TABLE threads (id TEXT,archived INTEGER,cwd TEXT)')
        db.execute('INSERT INTO threads VALUES (?,?,?)', ('test', 1, '/project'))
        db.commit()
        db.close()

    def test_persisted_state_required_before_connecting(self):
        with patch.object(module.socket, 'socket') as connect:
            with self.assertRaisesRegex(ValueError, '尚未持久化'):
                module.notify({'threadId': 'test', 'archived': False})
            connect.assert_not_called()

    def test_rejects_insecure_socket_directory(self):
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(str(self.directory / 'ipc.sock'))
            self.directory.chmod(0o777)
            with self.assertRaisesRegex(ValueError, '权限不符'):
                module.notify({'threadId': 'test', 'archived': True})

    def check_notification(self, payload, expected_count):
        received = []
        errors = []
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(str(self.directory / 'ipc.sock'))
            server.listen()
            server.settimeout(5)

            def serve():
                try:
                    with server.accept()[0] as client:
                        client.settimeout(5)

                        def exact(n):
                            data = b''
                            while len(data) < n:
                                part = client.recv(n - len(data))
                                if not part:
                                    raise RuntimeError('unexpected disconnect')
                                data += part
                            return data

                        for _ in range(expected_count):
                            msg = json.loads(exact(struct.unpack('<I', exact(4))[0]))
                            received.append(msg)
                            if msg['method'] == 'initialize':
                                result = json.dumps({'type': 'response', 'requestId': msg['requestId'], 'resultType': 'success', 'result': {'clientId': 'assigned'}}).encode()
                                frame = struct.pack('<I', len(result)) + result
                                client.sendall(frame[:2])
                                client.sendall(frame[2:])
                except Exception as exc:
                    errors.append(exc)

            thread = threading.Thread(target=serve)
            thread.start()
            try:
                self.assertEqual(module.notify(payload), {'status': 'notified'})
            finally:
                thread.join(6)
            self.assertEqual(errors, [])
            return received

    def test_framing_notification_and_ordered_acknowledgement(self):
        received = self.check_notification({'threadId': 'test', 'archived': True}, 3)
        self.assertEqual([m['method'] for m in received], ['initialize', 'thread-archived', 'initialize'])
        self.assertEqual(received[1]['version'], 2)
        self.assertEqual(received[1]['sourceClientId'], 'assigned')
        self.assertEqual(received[1]['params'], {'hostId': 'local', 'conversationId': 'test', 'cwd': '/project'})

    def test_creation_waits_for_persistence(self):
        with patch.object(module.socket, 'socket') as connect:
            self.assertEqual(module.notify({'threadId': 'missing', 'action': 'created'}), {'status': 'pendingPersistence'})
            connect.assert_not_called()

    def test_creation_invalidates_discovery_only(self):
        with sqlite3.connect(self.home / '.codex/state_5.sqlite') as db:
            db.execute('UPDATE threads SET archived=0')
        received = self.check_notification({'threadId': 'test', 'action': 'created'}, 5)
        self.assertEqual([m['method'] for m in received], ['initialize'] + ['query-cache-invalidate'] * 3 + ['initialize'])
        self.assertEqual([m['params']['queryKey'] for m in received[1:-1]], [['recent-conversations'], ['recent-conversations-meta'], ['command-menu-thread-search', 'local']])
        self.assertTrue(all(m['version'] == 0 for m in received[1:-1]))
        with sqlite3.connect(self.home / '.codex/state_5.sqlite') as db:
            self.assertEqual(db.execute('SELECT * FROM threads').fetchall(), [('test', 0, '/project')])
