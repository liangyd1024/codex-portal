"""Run through SSH stdin. Only this application's dedicated service is managed."""
import json, os, pathlib, plistlib, pwd, socket, subprocess, time

HOME = pathlib.Path(globals().get('SERVICE_HOME', '/Users/marco'))
ROOT = HOME / '.codex/remote-codex-manager'
SOCKET = ROOT / 'app-server.sock'
LABEL = 'local.remote-codex-manager.app-server'
BINARY = pathlib.Path('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
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
        raise RuntimeError('输出记录服务需要更新。请先结束本工作台的运行命令，再重启输出记录服务。')
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
    if pwd.getpwuid(os.getuid()).pw_name != globals().get('SERVICE_USER', 'marco') or pathlib.Path.home() != HOME:
        raise RuntimeError('目标身份不符。未启动服务。')
    action = globals().get('ACTION', 'ensure')
    if action == 'projects':
        import sqlite3
        conn = sqlite3.connect('file:' + str(HOME / '.codex/state_5.sqlite') + '?mode=ro', uri=True, timeout=5)
        try:
            projects = conn.execute('SELECT id,name FROM projects ORDER BY position').fetchall()
            roots = conn.execute('SELECT project_id,path FROM project_roots ORDER BY position').fetchall()
            emit({'data': [{'id': row[0], 'name': row[1], 'roots': [r[1] for r in roots if r[0] == row[0]]} for row in projects]})
        finally:
            conn.close()
        return
    if action == 'release':
        result = command(['/bin/launchctl', 'bootout', DOMAIN + '/' + LABEL])
        if result.returncode and 'No such process' not in result.stderr and 'Could not find service' not in result.stderr:
            raise RuntimeError('停止专用服务失败：' + result.stderr[-500:])
        for _ in range(30):
            if command(['/bin/launchctl', 'print', DOMAIN + '/' + LABEL]).returncode != 0:
                emit({'running': False, 'released': True})
                return
            time.sleep(0.2)
        raise RuntimeError('专用服务尚未退出。请勿切回桌面。')
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
        config = {
            'Label': LABEL,
            'ProgramArguments': [str(BINARY), 'app-server', '--listen', 'unix://' + str(SOCKET)],
            'WorkingDirectory': str(HOME),
            'RunAtLoad': True,
            'KeepAlive': {'SuccessfulExit': False},
            'ProcessType': 'Background',
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
            journal = ensure_relay()
            emit({'outputJournal': journal, 'running': True, 'pid': pid, 'startedAt': started, 'version': version, 'socket': str(SOCKET), 'hostname': socket.gethostname(), 'binary': str(BINARY), 'protocolValidation': validation})
            return
        time.sleep(0.2)
    # No credential files or full logs are returned.
    raise RuntimeError('专用服务未就绪。请检查 remote-codex-manager 的服务日志。')

try:
    main()
except Exception as exc:
    emit({'error': str(exc)})
