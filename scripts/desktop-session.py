"""Use the existing same-user desktop session owner. Never start or claim it."""
import json
import os
import pathlib
import pwd
import socket
import stat
import struct
import time
import uuid


class DesktopError(Exception):
    def __init__(self, message, code='DESKTOP_UNAVAILABLE'):
        super().__init__(message)
        self.code = code


class DesktopSession:
    def __init__(self, home, timeout=15):
        self.home = pathlib.Path(home)
        self.timeout = timeout
        self.client = None
        self.client_id = 'initializing-client'

    def __enter__(self):
        candidates = [self.home / '.codex/ipc/ipc.sock',
                      pathlib.Path('/tmp/codex-ipc') / ('ipc-' + str(os.getuid()) + '.sock')]
        for endpoint in candidates:
            try:
                info, parent = endpoint.lstat(), endpoint.parent.lstat()
            except FileNotFoundError:
                continue
            if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid()
                    or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid()
                    or info.st_mode & 0o077 or parent.st_mode & 0o022):
                raise DesktopError('桌面协调通道身份或权限不符。', 'DESKTOP_IDENTITY')
            self.client = socket.socket(socket.AF_UNIX)
            self.client.settimeout(self.timeout)
            try:
                self.client.connect(str(endpoint))
                reply = self.request('initialize', {'clientType': 'remote-codex-manager'}, 0)
                self.client_id = reply['result']['clientId']
                return self
            except Exception:
                self.client.close()
                raise
        raise DesktopError('请先在目标机器打开 Codex 桌面端及管理会话。')

    def __exit__(self, *_):
        if self.client:
            self.client.close()

    def send(self, message):
        data = json.dumps(message).encode('utf-8')
        self.client.sendall(struct.pack('<I', len(data)) + data)

    def receive(self, deadline):
        def exact(size):
            result = bytearray()
            while len(result) < size:
                self.client.settimeout(max(0.001, deadline - time.monotonic()))
                part = self.client.recv(size - len(result))
                if not part:
                    raise EOFError('桌面连接已断开。')
                result.extend(part)
            return result
        size = struct.unpack('<I', exact(4))[0]
        if not 0 < size <= 16 * 1024 * 1024:
            raise DesktopError('桌面响应格式不受支持。', 'DESKTOP_PROTOCOL')
        return json.loads(exact(size))

    def request(self, method, params, version, target=None, mutation=False):
        identifier = str(uuid.uuid4())
        message = {'type': 'request', 'requestId': identifier,
                   'sourceClientId': self.client_id, 'version': version,
                   'method': method, 'params': params}
        if target:
            message['targetClientId'] = target
        try:
            self.send(message)
            deadline = time.monotonic() + self.timeout
            while time.monotonic() < deadline:
                reply = self.receive(deadline)
                if reply.get('type') != 'response' or reply.get('requestId') != identifier:
                    continue
                if reply.get('resultType') == 'success':
                    return reply
                reason = str(reply.get('error', 'unknown'))
                # A forwarded write may already have run when its reply is lost.
                code = 'OUTCOME_UNKNOWN' if mutation else 'DESKTOP_UNAVAILABLE'
                raise DesktopError('桌面请求未获确认：' + reason, code)
            raise TimeoutError()
        except (OSError, EOFError, TimeoutError) as exc:
            raise DesktopError('桌面响应中断，请核对原始会话记录后再操作。',
                               'OUTCOME_UNKNOWN' if mutation else 'DESKTOP_UNAVAILABLE') from exc

    def owner(self, thread_id):
        reply = self.request('thread-owner-discovery', {'hostId': 'local', 'conversationId': thread_id}, 1)
        owner = reply.get('handledByClientId')
        if not owner:
            raise DesktopError('该会话未由桌面托管，请先在桌面打开它。')
        return owner

    def settings(self, thread_id, owner):
        return self.request('thread-follower-read-model-settings', {'conversationId': thread_id}, 1, owner)['result']


def run(payload):
    home = pathlib.Path(globals().get('SERVICE_HOME', str(pathlib.Path.home())))
    if home != pathlib.Path.home() or globals().get('SERVICE_USER', pwd.getpwuid(os.getuid()).pw_name) != pwd.getpwuid(os.getuid()).pw_name:
        raise DesktopError('目标身份不符。', 'DESKTOP_IDENTITY')
    identifier = str(uuid.UUID(payload.get('threadId', '')))
    action = payload.get('action')
    if action not in ('probe', 'send', 'interrupt'):
        raise DesktopError('不支持此桌面操作。', 'INVALID_REQUEST')
    with DesktopSession(home, timeout=45 if action == 'send' else 15) as desktop:
        owner = desktop.owner(identifier)
        settings = desktop.settings(identifier, owner)
        if action == 'probe':
            return {'available': True, 'threadId': identifier, 'settings': settings}
        if action == 'interrupt':
            turn_id = str(uuid.UUID(payload.get('turnId', '')))
            reply = desktop.request('thread-follower-interrupt-turn', {
                'conversationId': identifier, 'mode': 'user-stop', 'expectedTurnId': turn_id
            }, 4, owner, mutation=True)
            return {'threadId': identifier, 'result': reply['result']}
        text = payload.get('text')
        if not isinstance(text, str) or not text.strip() or len(text) > 100000:
            raise DesktopError('请输入不超过 100000 字的消息。', 'INVALID_REQUEST')
        message_id = str(uuid.UUID(payload.get('messageId', '')))
        reply = desktop.request('thread-follower-start-turn', {
            'conversationId': identifier,
            'turnStart': {
                'request': {'threadId': identifier,
                            'input': [{'type': 'text', 'text': text, 'text_elements': []}],
                            'clientUserMessageId': message_id,
                            'approvalPolicy': 'never', 'sandboxPolicy': {'type': 'dangerFullAccess'}},
                'context': {'inheritThreadSettings': True}
            }
        }, 2, owner, mutation=True)
        return {'threadId': identifier, 'messageId': message_id, 'result': reply['result']}


if 'PAYLOAD' in globals():
    try:
        result = run(PAYLOAD)
    except Exception as exc:
        result = {'failure': {'message': str(exc), 'code': getattr(exc, 'code', 'DESKTOP_UNAVAILABLE')}}
    print('RCM_JSON:' + json.dumps(result, ensure_ascii=False))
