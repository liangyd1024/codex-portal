"""Notify the target user's existing Codex IPC router after a persisted change.

No desktop process is started and no Codex database is modified here.
"""
import json
import os
import pathlib
import socket
import sqlite3
import stat
import struct
import time
import uuid


def notify(payload):
    home = pathlib.Path(globals().get('STORE_HOME', str(pathlib.Path.home())))
    identifier = payload['threadId']
    created = payload.get('action') == 'created'
    archived = False if created else payload.get('archived')
    if not isinstance(identifier, str) or not identifier or type(archived) is not bool:
        raise ValueError('归档通知参数无效。')
    db = sqlite3.connect((home / '.codex/state_5.sqlite').as_uri() + '?mode=ro', uri=True)
    try:
        row = db.execute('SELECT archived,cwd FROM threads WHERE id=?', (identifier,)).fetchone()
    finally:
        db.close()
    if row is None or bool(row[0]) != archived:
        if created:
            return {'status': 'pendingPersistence'}
        raise ValueError('归档状态尚未持久化，未通知桌面端。')
    candidates = [home / '.codex/ipc/ipc.sock', pathlib.Path('/tmp/codex-ipc') / ('ipc-' + str(os.getuid()) + '.sock')]
    endpoint = None
    for candidate in candidates:
        try:
            info, parent = candidate.lstat(), candidate.parent.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o022:
            raise ValueError('桌面通知 socket 身份或权限不符。')
        endpoint = candidate
        break
    if endpoint is None:
        return {'status': 'notRunning'}
    deadline = time.monotonic() + 4
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(4)
        client.connect(str(endpoint))

        def send(value):
            data = json.dumps(value).encode('utf-8')
            client.sendall(struct.pack('<I', len(data)) + data)

        def read_exact(size):
            data = b''
            while len(data) < size:
                client.settimeout(max(0.001, deadline - time.monotonic()))
                chunk = client.recv(size - len(data))
                if not chunk:
                    raise RuntimeError('桌面通知连接已断开。')
                data += chunk
            return data

        def initialize(source):
            request = str(uuid.uuid4())
            send({'type': 'request', 'requestId': request, 'sourceClientId': source,
                  'version': 0, 'method': 'initialize', 'params': {'clientType': 'remote-codex-manager'}})
            while time.monotonic() < deadline:
                size = struct.unpack('<I', read_exact(4))[0]
                if not 0 < size <= 8 * 1024 * 1024:
                    raise ValueError('桌面通知帧长度无效。')
                message = json.loads(read_exact(size))
                if message.get('type') == 'response' and message.get('requestId') == request:
                    if message.get('resultType') != 'success':
                        raise RuntimeError('桌面通知协议初始化失败。')
                    return message['result']['clientId']
            raise TimeoutError('桌面通知超时。')

        source = initialize('initializing-client')
        if created:
            # Native renderer queries, verified in Desktop 26.1013.40934.
            # Invalidate only discovery caches; never forge a lifecycle event or
            # write project membership. The desktop reads its own source of truth.
            for key in [['recent-conversations'], ['recent-conversations-meta'],
                        ['command-menu-thread-search', 'local']]:
                send({'type': 'broadcast', 'sourceClientId': source,
                      'method': 'query-cache-invalidate', 'version': 0,
                      'params': {'queryKey': key}})
        else:
            send({'type': 'broadcast', 'sourceClientId': source,
                  'method': 'thread-archived' if archived else 'thread-unarchived',
                  'version': 2 if archived else 1,
                  'params': {'hostId': 'local', 'conversationId': identifier, 'cwd': row[1]}})
        # Ordered response confirms router processing, not a rendered desktop frame.
        initialize(source)
    return {'status': 'notified'}


if __name__ == '__main__' or 'PAYLOAD' in globals():
    try:
        print('RCM_JSON:' + json.dumps(notify(PAYLOAD)))
    except Exception as exc:
        print('RCM_JSON:' + json.dumps({'error': str(exc)}))
