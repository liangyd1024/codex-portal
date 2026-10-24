"""Run through SSH stdin. Only this application's dedicated service is managed."""
import json, os, pathlib, plistlib, pwd, re, socket, subprocess, time

HOME = pathlib.Path(globals().get('SERVICE_HOME', str(pathlib.Path.home())))
ROOT = HOME / '.codex/remote-codex-manager'
SOCKET = ROOT / 'app-server.sock'
LABEL = 'local.remote-codex-manager.app-server'
BINARY = pathlib.Path(SERVICE_BINARY)
JOB = HOME / 'Library/LaunchAgents' / (LABEL + '.plist')
DOMAIN = 'gui/' + str(os.getuid())

def emit(value):
    print('RCM_JSON:' + json.dumps(value, ensure_ascii=False))

def command(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=20)

def ensure_relay():
    source = globals().get('RELAY_SOURCE')
    if not source: return False
    script = ROOT / 'output-relay-v2.py'
    reader = ROOT / 'output-reader.py'
    reader_source = globals().get('OUTPUT_READER_SOURCE', '')
    label = 'local.remote-codex-manager.output-relay-v2'
    job = HOME / 'Library/LaunchAgents' / (label + '.plist')
    running = command(['/bin/launchctl', 'print', DOMAIN + '/' + label])
    changed = not script.exists() or script.read_text() != source or (reader_source and (not reader.exists() or reader.read_text() != reader_source))
    if changed and running.returncode == 0:
        # Keep the existing collector running; upgrades must be deliberate.
        return True
    if running.returncode == 0: return True
    script.write_text(source); os.chmod(script, 0o600)
    if reader_source: reader.write_text(reader_source); os.chmod(reader, 0o600)
    if running.returncode != 0:
        config = {'Label':label, 'ProgramArguments':['/usr/bin/python3',str(script)], 'RunAtLoad':True, 'KeepAlive':True, 'Umask':0o077, 'WorkingDirectory':str(ROOT)}
        with job.open('wb') as stream: plistlib.dump(config,stream)
        os.chmod(job,0o600)
        result = command(['/bin/launchctl','bootstrap',DOMAIN,str(job)])
        if result.returncode: raise RuntimeError('无法启动输出记录服务：'+result.stderr[-500:])
    for _ in range(50):
        if (ROOT / 'output-relay-v2.sock').exists(): return True
        time.sleep(0.1)
    raise RuntimeError('输出记录服务未就绪。')


def main():
    if pwd.getpwuid(os.getuid()).pw_name != SERVICE_USER or pathlib.Path.home() != HOME:
        raise RuntimeError('目标身份不符。未启动服务。')
    action = globals().get('ACTION', 'ensure')
    if action == 'projects':
        import sqlite3
        for attempt in range(3):
            conn = None
            try:
                conn = sqlite3.connect((HOME / '.codex/state_5.sqlite').resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
                projects = conn.execute('SELECT id,name FROM projects ORDER BY position').fetchall()
                roots = conn.execute('SELECT project_id,path FROM project_roots ORDER BY position').fetchall()
                emit({'data': [{'id': row[0], 'name': row[1], 'roots': [r[1] for r in roots if r[0] == row[0]]} for row in projects]})
                break
            except sqlite3.OperationalError as exc:
                if attempt == 2 or not any(text in str(exc).lower() for text in ['unable to open database file', 'database is locked']): raise
                time.sleep([0.1, 0.25][attempt])
            finally:
                if conn: conn.close()
        return
    if action in ('release', 'reload-login'):
        marker = ROOT / 'maintenance.json'
        if action == 'reload-login' and marker.exists():
            raise RuntimeError('目标已有维护标记，请先完成原维护流程。未重启引擎。')
        if action == 'reload-login':
            if not BINARY.is_file(): raise RuntimeError('找不到原生引擎，未重启。')
            check_protocol(BINARY, command([str(BINARY), '--version']).stdout.strip().replace('codex-cli ', ''), ROOT)
        marker.write_text(json.dumps({'reason':'reload login' if action == 'reload-login' else 'manual release','createdAt':time.time()})); os.chmod(marker,0o600)
        result = command(['/bin/launchctl', 'bootout', DOMAIN + '/' + LABEL])
        if result.returncode and 'No such process' not in result.stderr and 'Could not find service' not in result.stderr:
            raise RuntimeError('停止专用服务失败：' + result.stderr[-500:])
        for _ in range(30):
            if command(['/bin/launchctl', 'print', DOMAIN + '/' + LABEL]).returncode != 0:
                if action == 'release':
                    emit({'running': False, 'released': True})
                    return
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('专用服务尚未退出。请勿切回桌面。')
        # Preserve this operation's maintenance record. Never clear an existing
        # restore/maintenance marker to force a login refresh.
        marker.rename(ROOT / ('maintenance.login-reloaded-' + str(time.time_ns()) + '.json'))
    if (ROOT / 'maintenance.json').exists(): raise RuntimeError('目标处于维护模式，请在目标机完成维护后恢复。')
    if not BINARY.is_file():
        raise RuntimeError('找不到远端桌面版 Codex。请检查安装路径。')
    version = command([str(BINARY), '--version']).stdout.strip().replace('codex-cli ', '')
    validation = check_protocol(BINARY, version, ROOT)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(ROOT, 0o700)
    JOB.parent.mkdir(parents=True, exist_ok=True)
    running = command(['/bin/launchctl', 'print', DOMAIN + '/' + LABEL])
    if running.returncode != 0:
        if SOCKET.exists():
            # Remove only this dedicated stale socket, never a Codex writer lock.
            SOCKET.unlink()
        entries = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin', '/usr/local/bin']
        nvm = HOME / '.nvm/versions/node'
        if nvm.is_dir():
            entries = [str(p / 'bin') for p in sorted(nvm.iterdir(), reverse=True) if (p / 'bin/node').exists()] + entries
        entries += ['/Applications/ChatGPT.app/Contents/Resources/cua_node/bin', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin']
        delay = globals().get('SERVICE_THREAD_UNLOAD_DELAY_SECS')
        if delay is not None and (type(delay) is not int or not 0 <= delay <= 86400):
            raise RuntimeError('会话释放等待参数无效。')
        delay_args = ['-c', 'thread_unload_delay_secs=' + str(delay)] if delay is not None else []
        config = {
            'Label': LABEL,
            'ProgramArguments': [str(BINARY), 'app-server', *delay_args, '--listen', 'unix://' + str(SOCKET)],
            'WorkingDirectory': str(HOME),
            'RunAtLoad': True,
            'KeepAlive': {'SuccessfulExit': False},
            # Chat requests need interactive CPU/I/O QoS. Background applies a
            # launch-time QoS clamp that taskpolicy -B cannot fully remove.
            'ProcessType': 'Interactive',
            # launchd defaults to 256 descriptors. Persistent native sessions
            # retain tool pipes as well as files; leave room for concurrent work.
            # Applies only at bootstrap, never restart a running engine here.
            'SoftResourceLimits': {'NumberOfFiles': 4096},
            'Umask': 0o077,
            'EnvironmentVariables': {'HOME': str(HOME), 'CODEX_HOME': str(HOME / '.codex'), 'PATH': ':'.join(entries), 'LANG': 'en_US.UTF-8'},
            'StandardOutPath': str(ROOT / 'service.stdout.log'),
            'StandardErrorPath': str(ROOT / 'service.stderr.log'),
        }
        with JOB.open('wb') as stream:
            plistlib.dump(config, stream)
        os.chmod(JOB, 0o600)
        result = command(['/bin/launchctl', 'bootstrap', DOMAIN, str(JOB)])
        if result.returncode:
            raise RuntimeError('专用服务启动失败：' + result.stderr[-800:])
    for _ in range(75):
        if SOCKET.exists():
            status = command(['/bin/launchctl', 'print', DOMAIN + '/' + LABEL])
            pid = next((int(line.split('=')[1].strip()) for line in status.stdout.splitlines() if line.strip().startswith('pid =')), None)
            started = command(['/bin/ps', '-p', str(pid), '-o', 'lstart=']).stdout.strip() if pid else None
            # Read the running job, not a desired config or a rewritten plist.
            delay_match = re.search(r'thread_unload_delay_secs=(\d+)', status.stdout)
            actual_delay = int(delay_match.group(1)) if delay_match else None
            journal = ensure_relay()
            emit({'outputJournal': journal, 'threadUnloadDelaySecs': actual_delay, 'running': True, 'pid': pid, 'startedAt': started, 'version': version, 'socket': str(SOCKET), 'hostname': socket.gethostname(), 'binary': str(BINARY), 'protocolValidation': validation})
            return
        time.sleep(0.2)
    # No credential files or full logs are returned.
    raise RuntimeError('专用服务未就绪。请检查 remote-codex-manager 的服务日志。')

try:
    main()
except Exception as exc:
    emit({'error': str(exc)})
