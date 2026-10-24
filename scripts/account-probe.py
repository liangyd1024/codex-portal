"""Observe saved login through native account/read; never read credential bytes."""
import hashlib
import json
import os
import pathlib
import selectors
import subprocess
import time


def probe(binary, home):
    env = dict(os.environ, HOME=str(home), CODEX_HOME=str(home / '.codex'))
    child = subprocess.Popen([str(binary), 'app-server'], cwd=home, env=env,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    def send(value):
        child.stdin.write((json.dumps(value) + '\n').encode())
        child.stdin.flush()
    try:
        send({'id': 1, 'method': 'initialize', 'params': {
            'clientInfo': {'name': 'rcm_account_probe', 'version': '0.1.0'},
            'capabilities': {'experimentalApi': True}}})
        deadline, pending = time.monotonic() + 20, b''
        while time.monotonic() < deadline:
            if not selector.select(max(0, deadline - time.monotonic())):
                break
            chunk = os.read(child.stdout.fileno(), 65536)
            if not chunk:
                break
            pending += chunk
            if len(pending) > 1024 * 1024:
                raise RuntimeError('原生账号读取返回过大。')
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                try:
                    message = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                if message.get('id') in (1, 2) and 'error' in message:
                    raise RuntimeError('原生账号读取失败。')
                if message.get('id') == 1:
                    send({'method': 'initialized'})
                    send({'id': 2, 'method': 'account/read', 'params': {'refreshToken': False}})
                if message.get('id') == 2:
                    result = message.get('result', {})
                    account = result.get('account')
                    # Native response only. No auth/getToken or credential-file read.
                    return {'account': account, 'workspaceRouting': result.get('workspaceRouting'),
                            'requiresOpenaiAuth': result.get('requiresOpenaiAuth')}
        raise RuntimeError('原生账号读取超时。')
    finally:
        selector.close()
        child.terminate()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        child.stdin.close()
        child.stdout.close()


def main():
    home = pathlib.Path(SERVICE_HOME)
    auth = home / '.codex' / 'auth.json'
    def stamp():
        try:
            info = auth.stat()
            return hashlib.sha256(f'{info.st_ino}:{info.st_size}:{info.st_mtime_ns}'.encode()).hexdigest()
        except FileNotFoundError:
            return 'absent'
    result = {'stamp': stamp()}
    if PAYLOAD.get('probe'):
        result['identity'] = probe(pathlib.Path(SERVICE_BINARY), home)
        result['stamp'] = stamp()
    print('RCM_JSON:' + json.dumps(result))


if __name__ == '__main__':
    main()
