"""Scoped, read-only file streaming. One JSON header followed by binary bytes."""
import base64
import hashlib
import json
import os
import pathlib
import pwd
import re
import sqlite3
import stat
import sys

TEXT_LIMIT = 1024 * 1024
TYPES = {
    '.mp4': ('video/mp4', 'video'), '.webm': ('video/webm', 'video'), '.mov': ('video/quicktime', 'video'),
    '.mp3': ('audio/mpeg', 'audio'), '.m4a': ('audio/mp4', 'audio'), '.wav': ('audio/wav', 'audio'), '.ogg': ('audio/ogg', 'audio'), '.flac': ('audio/flac', 'audio'),
    '.png': ('image/png', 'image'), '.jpg': ('image/jpeg', 'image'), '.jpeg': ('image/jpeg', 'image'), '.gif': ('image/gif', 'image'), '.webp': ('image/webp', 'image'),
    '.pdf': ('application/pdf', 'pdf'),
}
TEXT_EXTENSIONS = {'.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.java', '.sql', '.css', '.html', '.htm', '.svg', '.xml', '.yaml', '.yml', '.toml', '.sh', '.go', '.rs', '.c', '.h', '.cpp'}

class FileError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def references(text):
    # Do not turn fenced/inline examples into file capabilities.
    lines = []
    fence = None
    for line in text.splitlines():
        match = re.match(r'^ {0,3}(`{3,}|~{3,})', line)
        if fence:
            if re.fullmatch(r' {0,3}' + re.escape(fence[0]) + '{' + str(len(fence)) + r',}\s*', line):
                fence = None
            continue
        if match:
            fence = match[1]
            continue
        lines.append(line)
    pattern = r"\\[!\"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|(?P<ticks>`+)[\s\S]*?(?P=ticks)(?!`)|!?\[[^\]\n]+\]\((?P<href><[^>\n]+>|(?:\\.|[^\s()\\]|\([^()\n]*\))+?)\)"
    refs = [match['href'] for match in re.finditer(pattern, '\n'.join(lines)) if match['href'] is not None]
    return [re.sub(r'\\([!"#$%&\'()*+,\-./:;<=>?@[\]\\^_`{|}~])', r'\1', ref[1:-1] if ref.startswith('<') else ref) for ref in refs]



def scoped_path(payload, home):
    reference = payload.get('reference')
    if not isinstance(reference, str) or len(reference) > 8192 or not reference.startswith('/') or reference.startswith('//') or any(ord(c) < 32 for c in reference):
        raise FileError('文件引用无效。')
    db_path = home / '.codex/thread_history_1.sqlite'
    if not db_path.is_file():
        raise FileError('目标机器缺少可核验的历史消息记录，暂时无法读取该文件。', 503)
    db = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True, timeout=2)
    try:
        db.execute('PRAGMA query_only=ON')
        row = db.execute('SELECT item_json FROM thread_items WHERE thread_id=? AND item_id=?', (payload.get('threadId'), payload.get('itemId'))).fetchone()
        if row is None:
            raise FileError('未找到文件所属消息，请等待消息保存后重试。', 404)
        value = json.loads(row[0])
        if value.get('type') not in ('agentMessage', 'plan') or reference not in references(value.get('text') or ''):
            raise FileError('该消息未引用此文件。', 403)
    finally:
        db.close()
    filename = re.sub(r':\d+(?::\d+)?$', '', reference)
    # Exact names take precedence over code line suffixes.
    if pathlib.Path(reference).is_file():
        filename = reference
    path = pathlib.Path(filename).resolve(strict=True)
    # Message membership is necessary, but not sufficient: secrets stay private.
    parts = path.parts
    if any(part.startswith('.') for part in parts) or any(part.lower() in ('library', 'credentials', 'secrets', 'private_keys') for part in parts) or re.search(r'(?i)(?:\.pem|\.key|\.p12|\.pfx|\.keychain(?:-db)?)$', path.name) or path.name in ('id_rsa', 'id_ed25519', 'credentials', 'auth.json'):
        raise FileError('此文件属于受保护路径，不能通过网页读取。', 403)
    roots = [home.resolve(), pathlib.Path('/tmp').resolve()]
    # A project may live outside HOME. Read its recorded cwd, never a client root.
    state = home / '.codex/state_5.sqlite'
    if state.is_file():
        db = sqlite3.connect(state.as_uri() + '?mode=ro', uri=True, timeout=2)
        try:
            row = db.execute('SELECT cwd FROM threads WHERE id=?', (payload.get('threadId'),)).fetchone()
            if row and row[0]:
                cwd = pathlib.Path(row[0]).resolve()
                if cwd != pathlib.Path('/'):
                    roots.append(cwd)
        finally:
            db.close()
    if not any(path == root or root in path.parents for root in roots):
        raise FileError('文件不在目标用户或会话项目的可读取范围内。', 403)
    return path


def open_regular(path):
    # Walk the resolved path using directory FDs, preventing symlink substitution.
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        result = os.open(path.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=fd)
    finally:
        os.close(fd)
    if not stat.S_ISREG(os.fstat(result).st_mode):
        os.close(result)
        raise FileError('只支持读取普通文件。', 403)
    return os.fdopen(result, 'rb')


def byte_range(value, size):
    if not value:
        return 0, size - 1, 200
    match = re.fullmatch(r'bytes=(\d{0,18})-(\d{0,18})', value)
    if not match or not any(match.groups()) or size == 0:
        raise FileError('请求的文件范围无效。', 416)
    first, last = match.groups()
    if first:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    else:
        start, end = max(0, size - int(last)), size - 1
    if start >= size or start > end:
        raise FileError('请求的文件范围无效。', 416)
    return start, end, 206


def send_header(value):
    global HEADER_SENT
    HEADER_SENT = True
    sys.stdout.buffer.write(json.dumps(value, ensure_ascii=True).encode() + b'\n')
    sys.stdout.buffer.flush()


def serve(payload, home):
    path = scoped_path(payload, home)
    with open_regular(path) as source:
        info = os.fstat(source.fileno())
        size = info.st_size
        mime, kind = TYPES.get(path.suffix.lower(), ('text/plain; charset=utf-8', 'text') if path.suffix.lower() in TEXT_EXTENSIONS else ('application/octet-stream', 'download'))
        etag = '"' + hashlib.sha256(f'{info.st_dev}:{info.st_ino}:{size}:{info.st_mtime_ns}'.encode()).hexdigest() + '"'
        metadata = {'name': path.name, 'size': size, 'mime': mime, 'kind': kind, 'etag': etag}
        mode = payload.get('mode', 'content')
        if mode == 'meta':
            send_header({'status': 200, **metadata, 'length': 0})
            return
        if mode == 'text':
            if kind != 'text':
                raise FileError('此文件不支持文本预览。')
            content = source.read(TEXT_LIMIT)
            text = content.decode('utf-8', errors='replace')
            data = json.dumps({'text': text, 'truncated': size > TEXT_LIMIT}, ensure_ascii=False).encode('utf-8')
            send_header({'status': 200, **metadata, 'mime': 'application/json; charset=utf-8', 'length': len(data)})
            sys.stdout.buffer.write(data)
            return
        if mode not in ('content', 'download'):
            raise FileError('文件操作无效。')
        requested = payload.get('range') if payload.get('ifRange') in (None, etag) else None
        try:
            start, end, status = byte_range(requested, size)
        except FileError as error:
            send_header({'status': error.status, 'error': str(error), 'size': size})
            return
        send_header({'status': status, **metadata, 'start': start, 'end': end, 'length': max(0, end-start+1)})
        if payload.get('head'):
            return
        source.seek(start)
        remaining = end-start+1
        while remaining > 0:
            chunk = source.read(min(256*1024, remaining))
            if not chunk:
                raise OSError('读取期间文件发生变化。')
            sys.stdout.buffer.write(chunk)
            remaining -= len(chunk)
        sys.stdout.buffer.flush()


def main():
    home = pathlib.Path(SERVICE_HOME)
    if pathlib.Path.home() != home or pwd.getpwuid(os.getuid()).pw_name != SERVICE_USER:
        raise FileError('目标身份不符，已停止文件读取。', 403)
    serve(FILE_PAYLOAD, home)


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as error:
        # Before a header this is an error response; afterwards the parent detects
        # a short/failed transfer. Never append a second JSON header to file data.
        if not globals().get('HEADER_SENT'):
            send_header({'status': getattr(error, 'status', 404 if isinstance(error, FileNotFoundError) else 502), 'error': str(error)})
        sys.exit(1)
