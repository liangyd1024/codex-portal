"""Read Codex history snapshots. PAYLOAD is provided by the local SSH adapter."""
import json
import pathlib
import re
import sqlite3
import base64
import zlib
import hashlib
import gzip


HOME = pathlib.Path(globals().get('STORE_HOME', str(pathlib.Path.home())))
STORE = HOME / '.codex'
MAX_SQLITE_INTEGER = 9223372036854775807
THREAD_COLUMNS = (
    'id', 'name', 'title', 'cwd', 'created_at', 'updated_at', 'preview',
    'archived', 'model', 'reasoning_effort', 'cli_version', 'source', 'project_id', 'thread_source', 'thread_section_id',
)
TURN_COLUMNS = (
    'thread_id', 'turn_id', 'rollout_ordinal', 'status', 'error_json',
    'started_at', 'completed_at', 'duration_ms',
)
ITEM_COLUMNS = ('thread_id', 'turn_id', 'item_id', 'rollout_ordinal', 'item_json')


def emit(value):
    content = json.dumps(value, ensure_ascii=False).encode('utf-8')
    print('RCM_ZJSON:' + base64.b64encode(zlib.compress(content, 6)).decode('ascii'))


def connect_store(filename):
    path = STORE / filename
    try:
        connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
    except sqlite3.Error as exc:
        raise RuntimeError('无法以只读方式打开 ' + filename + '：' + str(exc)) from exc
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA query_only=ON')
    # PRAGMA schema checks and every query share this action's read snapshot.
    connection.execute('BEGIN')
    return connection


def require_columns(connection, filename, table, required):
    # Table names are application constants. User values never enter SQL text.
    columns = {row['name'] for row in connection.execute('PRAGMA table_info("' + table + '")')}
    if not columns:
        raise RuntimeError(filename + ' 缺少数据表：' + table)
    missing = [name for name in required if name not in columns]
    if missing:
        raise RuntimeError(filename + ' 的 ' + table + ' 缺少字段：' + ', '.join(missing))


def optional_text(payload, name):
    value = payload.get(name)
    if value is not None and not isinstance(value, str):
        raise ValueError(name + ' 必须是字符串。')
    return value


def thread_id(payload):
    value = optional_text(payload, 'threadId')
    if not value:
        raise ValueError('threadId 不能为空。')
    return value


def cursor_number(payload):
    cursor = payload.get('cursor')
    if cursor is None or cursor == '':
        return None
    if not isinstance(cursor, str) or not re.fullmatch(r'db:[0-9]+', cursor):
        raise ValueError('cursor 无效。请使用 db:非负整数。')
    # Bound the input before int() so malformed requests cannot force large parsing.
    number = cursor[3:]
    if len(number) > 19 or int(number) > MAX_SQLITE_INTEGER:
        raise ValueError('cursor 超出 SQLite 整数范围。')
    return int(number)


def archived_flag(payload):
    value = payload.get('archived', False)
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ('true', 'false', '1', '0'):
        return value.lower() in ('true', '1')
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    raise ValueError('archived 必须是布尔值。')


def desktop_turns(state):
    history = state.get('turnHistory', {})
    if history.get('kind') == 'canonical':
        data = history.get('history', {})
        entities = data.get('entitiesByKey', {})
        # Only referenced entries are current. The entity map can retain old tails.
        turns = [entities.get(entry.get('value'), {})
                 for island in data.get('islands', []) for entry in island.get('entries', [])]
    else:
        turns = state.get('turns', [])
    return [turn for turn in turns if isinstance(turn, dict)]


def desktop_active_turn(state):
    """Extract a unique native turn ID from the owner's versioned snapshot."""
    turns = desktop_turns(state)
    identifiers = {turn.get('turnId') or turn.get('id') for turn in turns
                   if isinstance(turn, dict) and turn.get('status') == 'inProgress'}
    identifiers = {identifier for identifier in identifiers if isinstance(identifier, str)
                   and re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', identifier)}
    return next(iter(identifiers)) if len(identifiers) == 1 else None


def desktop_activity(identifiers, include_requests=False):
    """Observe existing desktop owners briefly; never resume or claim a thread.

    Only a versioned live snapshot is evidence. Missing owners, old versions and
    timeouts remain unknown, regardless of persisted inProgress history.
    """
    import os
    import socket
    import stat
    import struct
    import time
    import uuid
    identifiers = set(identifiers)
    if not identifiers:
        return {}
    result = {}
    owners = {}
    following_ids = set()
    discoveries = {}
    client = None
    source = None
    try:
        endpoint = None
        for candidate in [STORE / 'ipc/ipc.sock', pathlib.Path('/tmp/codex-ipc') / ('ipc-' + str(os.getuid()) + '.sock')]:
            try:
                info, parent = candidate.lstat(), candidate.parent.lstat()
            except FileNotFoundError:
                continue
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o022:
                return {}
            endpoint = candidate
            break
        if endpoint is None:
            return {}
        deadline = time.monotonic() + 1.2
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(1.2)
        client.connect(str(endpoint))

        def send(value):
            data = json.dumps(value).encode('utf-8')
            client.sendall(struct.pack('<I', len(data)) + data)

        def exact(size):
            data = bytearray()
            while len(data) < size:
                client.settimeout(max(0.001, deadline - time.monotonic()))
                part = client.recv(size - len(data))
                if not part:
                    raise EOFError()
                data.extend(part)
            return data

        def receive():
            while True:
                size = struct.unpack('<I', exact(4))[0]
                if not 0 < size <= 16 * 1024 * 1024:
                    raise ValueError('Invalid activity frame')
                message = json.loads(exact(size))
                if message.get('type') != 'client-discovery-request':
                    return message
                send({'type': 'client-discovery-response', 'requestId': message['requestId'],
                      'response': {'canHandle': False}})

        def following(identifier, value):
            if identifier not in owners:
                return
            send({'type': 'broadcast', 'sourceClientId': source, 'targetClientIds': [owners[identifier]], 'version': 1,
                  'method': 'thread-stream-following-changed',
                  'params': {'hostId': 'local', 'conversationId': identifier, 'following': value}})
            if value:
                following_ids.add(identifier)
            else:
                following_ids.discard(identifier)

        request = str(uuid.uuid4())
        send({'type': 'request', 'requestId': request, 'sourceClientId': 'initializing-client',
              'version': 0, 'method': 'initialize', 'params': {'clientType': 'remote-codex-manager'}})
        while time.monotonic() < deadline:
            message = receive()
            if message.get('type') == 'response' and message.get('requestId') == request:
                if message.get('resultType') != 'success':
                    return {}
                source = message['result']['clientId']
                break
        if source is None:
            return {}
        for identifier in identifiers:
            request = str(uuid.uuid4())
            discoveries[request] = identifier
            send({'type': 'request', 'requestId': request, 'sourceClientId': source,
                  'version': 1, 'method': 'thread-owner-discovery',
                  'params': {'hostId': 'local', 'conversationId': identifier}})
        while time.monotonic() < deadline and (discoveries or len(result) < len(owners)):
            message = receive()
            if message.get('type') == 'response' and message.get('requestId') in discoveries:
                identifier = discoveries.pop(message['requestId'])
                owner = message.get('handledByClientId')
                if message.get('resultType') == 'success' and isinstance(owner, str) and owner:
                    owners[identifier] = owner
                    following(identifier, True)
                continue
            if message.get('type') != 'broadcast' or message.get('method') != 'thread-stream-state-changed' or message.get('version') != 11:
                continue
            params = message.get('params', {})
            identifier = params.get('conversationId')
            change = params.get('change', {})
            # Other windows may retain stale snapshots for the same thread. Only
            # the discovered native owner is authoritative, in either arrival order.
            if identifier not in owners or message.get('sourceClientId') != owners[identifier] or params.get('hostId') != 'local' or change.get('type') != 'snapshot':
                continue
            state = change.get('conversationState', {})
            status = state.get('threadRuntimeStatus', {}).get('type')
            if state.get('id') == identifier and status in ('active', 'idle'):
                result[identifier] = {'source': 'desktop', 'state': 'running' if status == 'active' else 'idle', 'observedAt': int(time.time() * 1000),
                                      'needsAnswer': any(isinstance(request, dict) and request.get('method') == 'item/tool/requestUserInput' and request.get('params', {}).get('threadId') == identifier for request in state.get('requests', []))}
                if status == 'active':
                    result[identifier]['activeTurnId'] = desktop_active_turn(state)
                if include_requests:
                    result[identifier]['ownerClientId'] = owners[identifier]
                    result[identifier]['pendingRequests'] = [request for request in state.get('requests', [])
                        if isinstance(request, dict) and request.get('method') == 'item/tool/requestUserInput'
                        and request.get('params', {}).get('threadId') == identifier]
                    result[identifier]['steeringMessages'] = [item for turn in desktop_turns(state)
                        if turn.get('turnId', turn.get('id')) == result[identifier].get('activeTurnId')
                        for item in turn.get('items', []) if item.get('type') == 'steeringUserMessage'
                        and item.get('status') == 'accepted']
                following(identifier, False)
    except (OSError, EOFError, ValueError, KeyError, TypeError, AttributeError):
        pass
    finally:
        if client is not None:
            if source is not None:
                for identifier in list(following_ids):
                    try:
                        following(identifier, False)
                    except OSError:
                        break
            client.close()
    return result


def sidebar_activity(threads):
    # The persisted latest turn selects candidates only; it never proves activity.
    try:
        db = connect_store('thread_history_1.sqlite')
        try:
            candidates = {r[0] for r in db.execute("SELECT t.thread_id FROM thread_turns t WHERE t.status='inProgress' AND NOT EXISTS (SELECT 1 FROM thread_turns newer WHERE newer.thread_id=t.thread_id AND newer.rollout_ordinal>t.rollout_ordinal)")}
            # Read only the latest turn for each listed thread, without loading items.
            for thread in threads:
                row = db.execute('SELECT turn_id,status FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC,turn_id DESC LIMIT 1', [thread['id']]).fetchone()
                if row:
                    thread['latestTurn'] = {'id': row['turn_id'], 'status': row['status']}
        finally:
            db.close()
        activity = desktop_activity([t['id'] for t in threads if t['id'] in candidates])
        for thread in threads:
            if thread['id'] in activity:
                thread['activity'] = activity[thread['id']]
            elif thread['id'] in candidates:
                thread['activity'] = {'state': 'unknown'}
    except (RuntimeError, sqlite3.Error):
        for thread in threads:
            thread['activity'] = {'state': 'unknown'}


def thread_select_columns(connection):
    columns = {r['name'] for r in connection.execute('PRAGMA table_info(threads)')}
    return ', '.join(THREAD_COLUMNS) + (', originator' if 'originator' in columns else '')


def normalized_thread(row):
    return {
        'id': row['id'],
        'name': row['name'] or row['title'],
        'preview': row['preview'] or '',
        'cwd': row['cwd'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
        'archived': bool(row['archived']),
        'model': row['model'],
        'reasoningEffort': row['reasoning_effort'],
        'cliVersion': row['cli_version'],
        'source': row['source'],
        'originator': row['originator'] if 'originator' in row.keys() else None,
        'projectId': row['project_id'],
        'threadSource': row['thread_source'],
        'sectionId': row['thread_section_id'],
        # Persisted history does not establish another process's live status.
        'status': {'type': 'notLoaded'},
    }


# Codex Desktop uses the default interactive thread/list sources. Background exec
# and all subagent variants belong to storage, not the user's sidebar.
INTERACTIVE_SOURCES = ('cli', 'vscode', 'appServer', 'unknown')


def desktop_membership(connection):
    try:
        state = json.loads((STORE / '.codex-global-state.json').read_text())
    except FileNotFoundError:
        state = {}
    # Do not silently infer memberships from cwd when the desktop state is broken.
    projects = {row['id'] for row in connection.execute('SELECT id FROM projects')}
    host_key = 'local:' + str(STORE)
    mapping = state.get('app-server-project-id-by-legacy-project-id-by-host', {}).get(host_key, {})
    migration = state.get('app-server-projects-migration-by-host', {}).get(host_key, {})
    assignments = state.get('thread-project-assignments', {})
    hints = state.get('thread-workspace-root-hints', {})
    roots = sorted((r for r in connection.execute('SELECT project_id, path FROM project_roots') if isinstance(r['path'], str) and r['path'].startswith('/')), key=lambda r: len(r['path']), reverse=True)
    projectless = set(state.get('projectless-thread-ids', []))

    def resolve(thread):
        if thread.get('sectionId'):
            return None
        project = thread.get('projectId')
        if project is not None:
            return project if project in projects else None
        if thread['id'] in projectless:
            return None
        if not migration.get('threadAssignmentsMigrated', False):
            assignment = assignments.get(thread['id'], {})
            if assignment.get('projectKind') == 'local':
                legacy = assignment.get('projectId')
                project = mapping.get(legacy, legacy)
                return project if project in projects else None
            # Legacy desktop chats can belong to a saved root before assignment
            # migration. Only registered roots qualify; never invent a project.
            cwd = (hints.get(thread['id']) or thread.get('cwd') or '').rstrip('/')
            for root in roots:
                path = root['path'].rstrip('/')
                if cwd == path or cwd.startswith(path + '/'):
                    return root['project_id']
        return None
    return resolve


def read_sidebar_metadata(payload):
    identifiers = payload.get('threadIds', [])
    if not isinstance(identifiers, list) or len(identifiers) > 100 or not all(isinstance(i, str) for i in identifiers):
        raise ValueError('threadIds 必须为至多 100 个会话 ID。')
    connection = connect_store('state_5.sqlite')
    try:
        resolve = desktop_membership(connection)
        origin_column = 'originator' if 'originator' in {r['name'] for r in connection.execute('PRAGMA table_info(threads)')} else 'NULL AS originator'
        rows = connection.execute('SELECT id, project_id, cwd, thread_section_id, ' + origin_column + ' FROM threads WHERE id IN (' + ','.join('?' for _ in identifiers) + ')', identifiers)
        return {'data': {row['id']: {'originator': row['originator'], 'projectId': resolve({'id': row['id'], 'projectId': row['project_id'], 'cwd': row['cwd'], 'sectionId': row['thread_section_id']})} for row in rows}}
    finally:
        connection.close()


def literal_like(value):
    return '%' + value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def read_threads(payload):
    connection = connect_store('state_5.sqlite')
    try:
        require_columns(connection, 'state_5.sqlite', 'threads', THREAD_COLUMNS)
        offset = cursor_number(payload) or 0
        conditions = ['archived = ?', 'source IN (?, ?, ?, ?)', "COALESCE(thread_source, '') != 'ambient_suggestions'"]
        parameters = [int(archived_flag(payload)), *INTERACTIVE_SOURCES]
        cwd = optional_text(payload, 'cwd')
        search = optional_text(payload, 'search')
        if cwd:
            conditions.append('cwd = ?')
            parameters.append(cwd)
        if search:
            conditions.append("(COALESCE(name, '') LIKE ? ESCAPE '\\' OR COALESCE(title, '') LIKE ? ESCAPE '\\')")
            parameters.extend([literal_like(search), literal_like(search)])
        sql = 'SELECT ' + thread_select_columns(connection) + ' FROM threads WHERE ' + ' AND '.join(conditions)
        sql += ' ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?'
        rows = connection.execute(sql, parameters + [51, offset]).fetchall()
        resolve = desktop_membership(connection)
        data = [normalized_thread(row) for row in rows[:50]]
        for thread in data:
            thread['projectId'] = resolve(thread)
        return {
            'data': data,
            'nextCursor': 'db:' + str(offset + 50) if len(rows) > 50 else None,
            'historySource': 'snapshot',
        }
    finally:
        connection.close()


def read_goal_snapshot(payload):
    identifier = thread_id(payload)
    # Older installations have no goal store. Never create or migrate it.
    try:
        (STORE / 'goals_1.sqlite').stat()
    except FileNotFoundError:
        return {'goal': None}
    connection = connect_store('goals_1.sqlite')
    try:
        require_columns(connection, 'goals_1.sqlite', 'thread_goals',
                        ('thread_id', 'objective', 'status', 'created_at_ms', 'updated_at_ms',
                         'tokens_used', 'time_used_seconds', 'token_budget'))
        row = connection.execute('SELECT * FROM thread_goals WHERE thread_id = ?', (identifier,)).fetchone()
        if row is None:
            return {'goal': None}
        statuses = {'active': 'active', 'paused': 'paused', 'blocked': 'blocked', 'complete': 'complete',
                    'budget_limited': 'budgetLimited', 'usage_limited': 'usageLimited'}
        if row['status'] not in statuses:
            raise ValueError('目标状态无法识别。')
        return {'goal': {'threadId': identifier, 'objective': row['objective'], 'status': statuses[row['status']],
                         'createdAt': row['created_at_ms'] // 1000, 'updatedAt': row['updated_at_ms'] // 1000,
                         'tokensUsed': row['tokens_used'], 'timeUsedSeconds': row['time_used_seconds'],
                         'tokenBudget': row['token_budget']}}
    finally:
        connection.close()


def read_takeover_state(payload):
    # Keep the native goal read after owner discovery to narrow the handoff race.
    detail = read_detail(payload)
    return {**detail, **read_goal_snapshot(payload)}


def read_detail(payload):
    connection = connect_store('state_5.sqlite')
    try:
        require_columns(connection, 'state_5.sqlite', 'threads', THREAD_COLUMNS)
        identifier = thread_id(payload)
        row = connection.execute('SELECT ' + thread_select_columns(connection) + ' FROM threads WHERE id = ?', (identifier,)).fetchone()
        if row is None:
            raise ValueError('未找到会话：' + identifier)
        thread = normalized_thread(row)
        activity = desktop_activity([identifier], include_requests=True) if payload.get('includeActivity', True) else {}
        if identifier in activity:
            thread['activity'] = activity[identifier]
        return {'thread': thread, 'historySource': 'snapshot'}
    finally:
        connection.close()


def decode_json(value, column, identifier):
    if value is None:
        return None
    try:
        return json.loads(value)
    except (ValueError, TypeError) as exc:
        raise RuntimeError(column + ' 不是有效 JSON。记录 ID：' + str(identifier)) from exc


def history_item(item, identifier):
    value = decode_json(item['item_json'], 'thread_items.item_json', item['item_id'])
    if value.get('type') == 'userMessage' and 'created_at_ms' in item.keys() and item['created_at_ms'] is not None:
        value['createdAtMs'] = item['created_at_ms']
    # Image bytes remain available through a separate media request. History keeps
    # every item and all text, without transferring multi-megabyte base64 previews.
    if value.get('type') == 'imageGeneration' and isinstance(value.get('result'), str) and len(value['result']) > 100000:
        value['imageRef'] = {'threadId': identifier, 'itemId': item['item_id'], 'base64Length': len(value['result'])}
        value['result'] = None
    return value


MAX_IMAGE_BYTES = 24 * 1024 * 1024


def stored_image_bytes(value, payload):
    # Client selects a part/reference within this persisted item, never a free file.
    part = payload.get('part')
    reference = payload.get('reference')
    if part is not None and reference is not None:
        raise ValueError('图片来源不能同时指定。')
    if part is not None:
        if not isinstance(part, str) or not re.fullmatch(r'\d{1,5}', part):
            raise ValueError('图片附件序号无效。')
        parts = value.get('content', [])
        if value.get('type') != 'userMessage' or not isinstance(parts, list) or int(part) >= len(parts):
            raise ValueError('未找到图片附件。')
        source = parts[int(part)]
        if source.get('type') == 'localImage':
            image_path = source.get('path')
        elif source.get('type') == 'image' and isinstance(source.get('url'), str):
            match = re.fullmatch(r'data:image/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)', source['url'])
            if not match or len(match[1]) > MAX_IMAGE_BYTES * 4 // 3 + 4:
                raise ValueError('该附件不包含可读取的图片。')
            return base64.b64decode(match[1], validate=True)
        else:
            raise ValueError('该附件不是本地图片。')
    elif reference is not None:
        if value.get('type') not in ('agentMessage', 'plan') or not isinstance(reference, str):
            raise ValueError('图片引用无效。')
        # Match only Markdown image destinations, not ordinary links or tool output.
        text = value.get('text') or ''
        refs = re.findall(r'!\[[^\]\n]*\]\((<[^>\n]+>|(?:\\.|[^\s()\\]|\([^()\n]*\))+?)\)', text)
        refs = [re.sub(r'\\([!"#$%&\'()*+,\-./:;<=>?@[\]\\^_`{|}~])', r'\1', ref[1:-1] if ref.startswith('<') else ref) for ref in refs]
        if reference not in refs:
            raise ValueError('图片未在该消息中引用。')
        image_path = reference
    elif value.get('type') == 'imageGeneration' and isinstance(value.get('result'), str):
        if len(value['result']) > MAX_IMAGE_BYTES * 4 // 3 + 4:
            raise ValueError('图片超过 24 MiB 限制。')
        return base64.b64decode(value['result'], validate=True)
    else:
        raise ValueError('该记录不包含可读取的图片。')
    if not isinstance(image_path, str) or not pathlib.Path(image_path).is_absolute():
        raise ValueError('仅支持目标机器上的绝对图片路径。')
    import os
    import stat
    # Do not read device files, FIFOs or a replacement symlink.
    fd = os.open(image_path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as image_file:
        info = os.fstat(image_file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_IMAGE_BYTES:
            raise ValueError('图片不是普通文件或超过 24 MiB 限制。')
        content = image_file.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise ValueError('图片超过 24 MiB 限制。')
    return content


def read_image(payload):
    connection = connect_store('thread_history_1.sqlite')
    try:
        require_columns(connection, 'thread_history_1.sqlite', 'thread_items', ITEM_COLUMNS)
        identifier = thread_id(payload)
        item_id = optional_text(payload, 'itemId')
        row = connection.execute('SELECT item_json FROM thread_items WHERE thread_id=? AND item_id=?', (identifier, item_id)).fetchone()
        if row is None:
            raise ValueError('未找到图片记录。')
        value = decode_json(row['item_json'], 'thread_items.item_json', item_id)
        content = stored_image_bytes(value, payload)
        if content.startswith(b'\x89PNG\r\n\x1a\n'):
            mime, extension = 'image/png', 'png'
        elif content.startswith(b'\xff\xd8\xff'):
            mime, extension = 'image/jpeg', 'jpg'
        elif content.startswith((b'GIF87a', b'GIF89a')):
            mime, extension = 'image/gif', 'gif'
        elif content.startswith(b'RIFF') and content[8:12] == b'WEBP':
            mime, extension = 'image/webp', 'webp'
        else:
            raise ValueError('暂不支持此图片格式。')
        if payload.get('preview'):
            import tempfile
            import subprocess
            with tempfile.TemporaryDirectory(prefix='rcm-image-') as directory:
                source = pathlib.Path(directory) / ('source.' + extension)
                output = pathlib.Path(directory) / 'preview.png'
                source.write_bytes(content)
                converted = subprocess.run(['/usr/bin/sips', '-s', 'format', 'png', '--resampleHeightWidthMax', '800', str(source), '--out', str(output)], capture_output=True, timeout=20)
                if converted.returncode:
                    raise RuntimeError('生成图片预览失败。原图仍可下载。')
                content = output.read_bytes()
            mime, extension = 'image/png', 'png'
        return {'data': base64.b64encode(content).decode('ascii'), 'mime': mime, 'extension': extension}
    finally:
        connection.close()


def startup_outputs(identifier, wanted):
    """Read only startup tool results for the requested live processes.

    Some engine versions consume the first bytes into the exec result before
    subscribing outputDelta. The rollout retains those bytes during execution.
    Poll results must never be mistaken for startup prefixes.
    """
    found = {}
    if not wanted: return found
    try:
        connection = connect_store('state_5.sqlite')
        try:
            row = connection.execute('SELECT rollout_path FROM threads WHERE id=?', (identifier,)).fetchone()
        finally: connection.close()
        if not row or not row[0]: return found
        path = pathlib.Path(row[0]).resolve()
        if not path.is_relative_to(STORE.resolve()): return found
        with path.open('rb') as stream:
            stream.seek(0, 2)
            start = max(0, stream.tell() - 8 * 1024 * 1024)
            stream.seek(start)
            if start: stream.readline()
            lines = stream.read().splitlines()
        calls = set()
        for line in lines:
            try: entry = json.loads(line)
            except (ValueError, UnicodeError): continue
            p = entry.get('payload') or {}
            kind = p.get('type')
            if kind in ('custom_tool_call', 'function_call'):
                code = p.get('input') or p.get('arguments') or ''
                if 'exec_command' in str(code) or p.get('name') == 'exec_command':
                    calls.add(p.get('call_id'))
            if kind not in ('custom_tool_call_output', 'function_call_output') or p.get('call_id') not in calls: continue
            turn = (p.get('internal_chat_message_metadata_passthrough') or {}).get('turn_id')
            content = p.get('output')
            blocks = content if isinstance(content, list) else [{'text':content}]
            for block in blocks:
                text = block.get('text') if isinstance(block, dict) else None
                if not isinstance(text, str): continue
                try: value = json.loads(text)
                except ValueError: continue
                if not isinstance(value, dict): continue
                key = (turn, str(value.get('session_id')))
                output = value.get('output')
                if key in wanted and isinstance(output, str) and not value.get('original_token_count', 0) > 100000:
                    found.setdefault(key, output)
    except (OSError, sqlite3.Error, RuntimeError):
        pass  # The live journal remains usable if no startup result is available.
    return found


def restore_startup(prefix, output):
    if not prefix or output.startswith(prefix): return output
    # Preserve repeated lines within both records. Only reconcile their boundary.
    for size in range(min(len(prefix), len(output)), 0, -1):
        if prefix.endswith(output[:size]): return prefix + output[size:]
    return prefix + output


def read_outputs(payload):
    path = STORE / 'remote-codex-manager/output-journal.sqlite'
    if not path.exists(): return {'data': []}
    # Only our private journal cache is writable. Codex databases stay read-only.
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=rw', uri=True, timeout=5)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS startup_prefixes (item TEXT PRIMARY KEY, prefix TEXT)')
        conditions = 'thread=?'; args = [thread_id(payload)]
        if 'turnIds' in payload:
            if not payload['turnIds']: return {'data': []}
            conditions += ' AND turn IN (' + ','.join('?' for _ in payload['turnIds']) + ')'
            args.extend(payload['turnIds'])
        preview = bool(payload.get('preview'))
        # Bound data before Python decoding and transport. The prefix token can
        # later be used by the normal hash-checked delta reader.
        limit = 16384
        value_sql = "json_set(value, '$.aggregatedOutput', substr(coalesce(json_extract(value, '$.aggregatedOutput'), ''),1,16384))" if preview else 'value'
        rows = db.execute('SELECT turn,' + value_sql + ' FROM commands WHERE ' + conditions + ' ORDER BY updated', args).fetchall()
        data = [{'turnId': turn, 'item': json.loads(value)} for turn,value in rows]
        items = {r['item']['id']:r['item'] for r in data}
        has_chunks = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='output_chunks'").fetchone()
        if has_chunks:
            if preview:
                for identifier,item in items.items():
                    output = item.get('aggregatedOutput') or ''
                    if len(output) < limit:
                        for (delta,) in db.execute('SELECT substr(delta,1,?) FROM output_chunks WHERE item=? ORDER BY seq',(limit,identifier)):
                            output += delta[:limit-len(output)]
                            if len(output) >= limit: break
                    item['aggregatedOutput'] = output
            else:
                chunks = {}
                for item,delta in db.execute('SELECT item,delta FROM output_chunks WHERE item IN (' + ','.join('?' for _ in items) + ') ORDER BY seq',list(items)):
                    chunks.setdefault(item,[]).append(delta)
                for item,parts in chunks.items():
                    if item in items: items[item]['aggregatedOutput'] = (items[item].get('aggregatedOutput') or '') + ''.join(parts)
        cached = dict(db.execute('SELECT item,prefix FROM startup_prefixes'))
        wanted = {(r['turnId'], str(r['item'].get('processId'))) for r in data if r['item']['id'] not in cached}
        prefixes = startup_outputs(thread_id(payload), wanted)
        for r in data:
            item = r['item']; prefix = cached.get(item['id'])
            if prefix is None:
                prefix = prefixes.get((r['turnId'], str(item.get('processId'))))
                if prefix is not None:
                    db.execute('INSERT OR IGNORE INTO startup_prefixes VALUES (?,?)',(item['id'],prefix))
            if prefix:
                item['aggregatedOutput'] = restore_startup(prefix, item.get('aggregatedOutput') or '')
        db.commit()
        for entry in data:
            item = entry['item']; output = item.get('aggregatedOutput') or ''
            # Engine command records may explicitly contain JSON null until output arrives.
            item['aggregatedOutput'] = output
            if preview:
                output = output[:limit]
                item['aggregatedOutput'] = output
            item['outputPartial'] = preview
            token = str(len(output)) + ':' + hashlib.sha256(output.encode('utf-8')).hexdigest()
            previous = (payload.get('outputVersions') or {}).get(item['id'], '')
            if isinstance(previous, str) and re.fullmatch(r'[0-9]{1,12}:[a-f0-9]{64}', previous):
                length = int(previous.split(':')[0])
                if length <= len(output) and hashlib.sha256(output[:length].encode('utf-8')).hexdigest() == previous.split(':')[1]:
                    item.pop('aggregatedOutput', None)
                    item['outputBaseToken'] = previous
                    item['outputDelta'] = output[length:]
            item['outputToken'] = token
            if payload.get('outputEncoding') == 'gzip-base64' and not preview:
                field = 'outputDelta' if 'outputDelta' in item else 'aggregatedOutput'
                text = item.get(field, '')
                if len(text) >= 65536:
                    packed = base64.b64encode(gzip.compress(text.encode('utf-8'), compresslevel=1, mtime=0)).decode('ascii')
                    if len(packed) < len(text):
                        item['outputCompressed'] = {'field': field, 'data': packed}
                        item.pop(field, None)
        return {'data': data}
    finally: db.close()


def goal_input_items(connection, identifier, turn_ids):
    """Read explicit user goal records between native turns, without replaying them.

    goal/set starts execution without a userMessage item. Like Desktop's goal
    transcript entry, display the objective from the native acknowledgement.
    Automatic goal continuations and status-only changes are not user inputs.
    """
    columns = {row['name'] for row in connection.execute('PRAGMA table_info(thread_turns)')}
    if not {'rollout_byte_offset', 'rollout_end_byte_offset'} <= columns or not turn_ids:
        return {}
    try:
        state = connect_store('state_5.sqlite')
        try:
            row = state.execute('SELECT rollout_path FROM threads WHERE id=?', (identifier,)).fetchone()
        finally:
            state.close()
        if not row or not row[0]: return {}
        path = pathlib.Path(row[0]).resolve()
        if not path.is_relative_to(STORE.resolve()): return {}
        result = {}
        with path.open('rb') as stream:
            for turn_id in turn_ids:
                turn = connection.execute('SELECT rollout_ordinal,rollout_byte_offset FROM thread_turns WHERE thread_id=? AND turn_id=?', (identifier, turn_id)).fetchone()
                if not turn or turn['rollout_byte_offset'] is None: continue
                previous = connection.execute('SELECT rollout_end_byte_offset FROM thread_turns WHERE thread_id=? AND rollout_ordinal<? ORDER BY rollout_ordinal DESC LIMIT 1', (identifier, turn['rollout_ordinal'])).fetchone()
                start = previous[0] if previous else 0
                end = turn['rollout_byte_offset']
                if start is None or start < 0 or start > end: continue
                stream.seek(start)
                explicit = None
                items = []
                while stream.tell() < end:
                    line = stream.readline()
                    if not line: break
                    try: record = json.loads(line)
                    except (ValueError, UnicodeDecodeError): continue
                    value = record.get('payload') or {}
                    if record.get('type') == 'response_item' and value.get('type') == 'message' and value.get('role') == 'user':
                        parts = value.get('content') or []
                        text = '\n'.join(part.get('text', '') for part in parts if part.get('type') == 'input_text')
                        kinds = (value.get('internal_chat_message_metadata_passthrough') or {}).get('content_item_kinds') or []
                        explicit = value.get('id') if 'user.goal' in kinds and text.startswith('<codex_internal_context source="user_goal">\nUser set the goal: ') else None
                    elif record.get('type') == 'event_msg' and value.get('type') == 'thread_goal_updated' and explicit:
                        goal = value.get('goal') or {}
                        if value.get('threadId') == identifier and isinstance(goal.get('objective'), str) and isinstance(goal.get('updatedAt'), (int, float)):
                            items.append({'id': explicit, 'type': 'goalMessage', 'objective': goal['objective'], 'createdAtMs': goal['updatedAt'] * 1000})
                        explicit = None
                if items: result[turn_id] = items
        return result
    except (OSError, sqlite3.Error, RuntimeError):
        # Optional native rollout may be unavailable; preserve ordinary history.
        return {}



def turn_collaboration_modes(connection, identifier, turn_ids):
    """Read bounded native turn contexts using snapshot offsets; never infer a mode."""
    columns = {row['name'] for row in connection.execute('PRAGMA table_info(thread_turns)')}
    if not {'rollout_byte_offset', 'rollout_end_byte_offset'} <= columns or not turn_ids:
        return {}
    result = {}
    try:
        state = connect_store('state_5.sqlite')
        try:
            row = state.execute('SELECT rollout_path FROM threads WHERE id=?', (identifier,)).fetchone()
        finally:
            state.close()
        if not row or not row[0]: return result
        path = pathlib.Path(row[0]).resolve()
        if not path.is_relative_to(STORE.resolve()): return result
        with path.open('rb') as stream:
            for turn_id in turn_ids:
                turn = connection.execute('SELECT rollout_byte_offset,rollout_end_byte_offset FROM thread_turns WHERE thread_id=? AND turn_id=?', (identifier, turn_id)).fetchone()
                if not turn or turn[0] is None or turn[0] < 0: continue
                start, end = turn
                end = min(end if end is not None else start + 524288, start + 524288)
                stream.seek(start)
                while stream.tell() < end:
                    line = stream.readline(end - stream.tell())
                    if not line or not line.endswith(b'\n'): break
                    try: record = json.loads(line)
                    except (ValueError, UnicodeDecodeError): continue
                    if not isinstance(record, dict): continue
                    value = record.get('payload')
                    if not isinstance(value, dict): continue
                    if record.get('type') == 'event_msg' and value.get('type') == 'task_started' and value.get('turn_id') != turn_id: break
                    if record.get('type') != 'turn_context': continue
                    if value.get('turn_id') != turn_id: break
                    mode = value.get('collaboration_mode')
                    if isinstance(mode, dict) and mode.get('mode') in ('plan', 'default'):
                        result[turn_id] = {'mode': mode['mode']}
                    break
    except (OSError, sqlite3.Error, RuntimeError):
        pass  # Missing context means unknown, not default; history remains readable.
    return result


def read_turn_directory(payload):
    """Presentation-only projection; native IDs and original input order are preserved."""
    identifier = thread_id(payload)
    db = connect_store('thread_history_1.sqlite')
    try:
        rows = db.execute('SELECT turn_id,status,started_at FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal,turn_id', [identifier]).fetchall()
        goals = goal_input_items(db, identifier, [r['turn_id'] for r in rows])
        turns = {r['turn_id']: {'id': r['turn_id'], 'status': r['status'], 'startedAt': r['started_at'], 'items': goals.get(r['turn_id'], [])} for r in rows}
        # Do not return tool arguments, results, screenshots or command output.
        items = db.execute("""SELECT turn_id, item_id, json_extract(item_json,'$.type') AS type,
            CASE WHEN json_extract(item_json,'$.type')='userMessage' THEN json_extract(item_json,'$.content') END AS content,
            substr(json_extract(item_json,'$.text'),1,1000) AS text, json_extract(item_json,'$.phase') AS phase
            FROM thread_items WHERE thread_id=? AND json_extract(item_json,'$.type') IN ('userMessage','agentMessage')
            ORDER BY rollout_ordinal,item_id""", [identifier])
        for item in items:
            turn = turns.get(item['turn_id'])
            if turn is None: continue
            values = turn['items']
            if item['type'] == 'userMessage' and not any(v['type'] in ('userMessage','goalMessage') for v in values):
                parts = json.loads(item['content'] or '[]')
                content = [{'type':'text','text':v.get('text','')[:180]} if v.get('type')=='text' else {'type':'image','url':'preview'} for v in parts if v.get('type') in ('text','image','localImage')]
                values.insert(0, {'id':item['item_id'],'type':'userMessage','content':content})
            elif item['type'] == 'agentMessage' and (item['text'] or '').strip():
                prior = next((v for v in values if v['type']=='agentMessage'), None)
                if prior is None or (prior.get('phase')!='final_answer' and item['phase']=='final_answer'):
                    if prior is not None: values.remove(prior)
                    values.append({'id':item['item_id'],'type':'agentMessage','text':item['text'],'phase':item['phase']})
        for turn in turns.values():
            for item in turn['items']:
                if item['type']=='goalMessage': item['objective']=item['objective'][:180]
        return {'data':list(turns.values()),'historySource':'snapshot'}
    finally:
        db.close()


def read_tool_item(payload):
    identifier = thread_id(payload)
    item_id = optional_text(payload, 'itemId')
    if not item_id: raise ValueError('缺少工具记录 ID。')
    db = connect_store('thread_history_1.sqlite')
    try:
        row = db.execute('SELECT item_id,item_json FROM thread_items WHERE thread_id=? AND item_id=?', [identifier,item_id]).fetchone()
        if not row: raise ValueError('未找到工具记录。')
        item = history_item(row, identifier)
        if item.get('type')!='mcpToolCall': raise ValueError('此记录不是工具调用。')
        return {'item':item}
    finally:
        db.close()


def read_history(payload):
    # On a new installation even the history database is absent until the first
    # turn. Only the manager's successful new-thread path may allow that absence.
    if payload.get('allowMissingStore') is True and not (STORE / 'thread_history_1.sqlite').exists():
        return {'data': [], 'nextCursor': None, 'historySource': 'snapshot', 'totalTurns': 0}
    connection = connect_store('thread_history_1.sqlite')
    try:
        require_columns(connection, 'thread_history_1.sqlite', 'thread_turns', TURN_COLUMNS)
        require_columns(connection, 'thread_history_1.sqlite', 'thread_items', ITEM_COLUMNS)
        item_columns = {column['name'] for column in connection.execute('PRAGMA table_info(thread_items)')}
        # Older native snapshots lack this column. Do not substitute a turn's
        # start time: steered user messages can arrive much later in that turn.
        item_time = ', created_at_ms' if 'created_at_ms' in item_columns else ''
        identifier = thread_id(payload)
        total_turns = connection.execute('SELECT COUNT(*) FROM thread_turns WHERE thread_id = ?', [identifier]).fetchone()[0]
        before = cursor_number(payload)
        conditions = ['thread_id = ?']
        parameters = [identifier]
        if before is not None:
            conditions.append('rollout_ordinal < ?')
            parameters.append(before)
        sql = 'SELECT ' + ', '.join(TURN_COLUMNS) + ' FROM thread_turns WHERE ' + ' AND '.join(conditions)
        sql += ' ORDER BY rollout_ordinal DESC, turn_id DESC LIMIT ?'
        limit = 1 if payload.get('preview') else 5
        rows = connection.execute(sql, parameters + [limit + 1]).fetchall()
        goal_inputs = goal_input_items(connection, identifier, [row['turn_id'] for row in rows[:limit]])
        modes = turn_collaboration_modes(connection, identifier, [row['turn_id'] for row in rows[:limit]])
        outputs = read_outputs({**payload, 'turnIds': [row['turn_id'] for row in rows[:limit]]})['data'] if payload.get('withOutputs') else []
        journal_ids = [entry['item']['id'] for entry in outputs]
        item_sql = "CASE WHEN json_extract(item_json,'$.type')='commandExecution' THEN json_set(item_json,'$.aggregatedOutput',substr(coalesce(json_extract(item_json,'$.aggregatedOutput'),''),1,16384),'$.outputPartial',json('true')) ELSE item_json END" if payload.get('preview') else 'item_json'
        if payload.get('lazyTools'):
            item_sql = "CASE WHEN json_extract(item_json,'$.type')='mcpToolCall' AND json_extract(item_json,'$.status') IN ('completed','failed') THEN json_set(json_remove(item_json,'$.arguments','$.result'),'$.detailsDeferred',json('true')) ELSE " + item_sql + ' END'
        # Do not decode and transmit the same large command twice. Keep fallback
        # history intact when no authoritative private journal entry exists.
        if journal_ids:
            item_sql = 'CASE WHEN item_id IN (' + ','.join('?' for _ in journal_ids) + ') THEN json_remove(item_json, \'$.aggregatedOutput\') ELSE ' + item_sql + ' END'
        turns = []
        for row in rows[:limit]:
            items = connection.execute(
                'SELECT item_id' + item_time + ', ' + item_sql + ' AS item_json FROM thread_items WHERE thread_id = ? AND turn_id = ? '
                'ORDER BY rollout_ordinal ASC, item_id ASC',
                [*journal_ids, identifier, row['turn_id']],
            ).fetchall()
            turns.append({
                'id': row['turn_id'],
                **({'collaborationMode': modes[row['turn_id']]} if row['turn_id'] in modes else {}),
                'status': row['status'],
                'error': decode_json(row['error_json'], 'thread_turns.error_json', row['turn_id']),
                'startedAt': row['started_at'],
                'completedAt': row['completed_at'],
                'durationMs': row['duration_ms'],
                'items': goal_inputs.get(row['turn_id'], []) + [history_item(item, identifier) for item in items],
            })
        if not payload.get('preview'):
            for turn in turns:
                for item in turn['items']:
                    if item.get('type') == 'commandExecution': item['outputPartial'] = False
        for entry in outputs:
            turn = next(t for t in turns if t['id'] == entry['turnId'])
            old = next((i for i in turn['items'] if i['id'] == entry['item']['id']), None)
            if old is None: turn['items'].append(entry['item'])
            else: old.update(entry['item'])
        return {
            'data': turns,
            'totalTurns': total_turns,
            'nextCursor': 'db:' + str(rows[limit - 1]['rollout_ordinal']) if len(rows) > limit else None,
            'historySource': 'snapshot',
        }
    finally:
        connection.close()


def read_notices(payload):
    journal=STORE/'remote-codex-manager'/'output-journal.sqlite'
    if not journal.exists(): return {'data':[]}
    db=sqlite3.connect(journal.resolve().as_uri()+'?mode=ro',uri=True,timeout=5)
    try:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_events'").fetchone():return {'data':[]}
        rows=db.execute('SELECT event FROM notification_events WHERE thread=? AND observed>=? ORDER BY observed', (payload['threadId'],payload['since'])).fetchall()
        return {'data':[json.loads(row[0]) for row in rows]}
    finally: db.close()


PINNED_SECTION = '01984de2-8f74-7c91-a3b2-5c5e937cf318'


def sidebar_revision(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]


def read_sidebar(payload):
    """One read transaction; only desktop-owned metadata is returned, never credentials."""
    db = connect_store('state_5.sqlite')
    try:
        try:
            state = json.loads((STORE / '.codex-global-state.json').read_text())
        except FileNotFoundError:
            state = {}
        account = payload.get('accountId')
        atoms = state.get('electron-persisted-atom-state', {})
        buckets = atoms.get('sidebar-custom-sections-v3', {})
        layout = buckets.get(account, {}) if account else {}
        prefs = atoms.get('flat-project-sidebar-preferences-v1', {})
        # Desktop normalizes obsolete/manual-v0 preferences before using them.
        def sort_mode(key):
            return 'manual' if prefs.get(key) == 'manual' and prefs.get('manualSortVersion') == 1 and atoms.get('codex-sidebar-sort-mode-v1') is None else 'updated_at'
        preferences = {'grouping': prefs.get('mode') if prefs.get('mode') in ('project','list','connection') else 'project',
                       'chats': sort_mode('chatSortMode'), 'projects': sort_mode('projectSortMode'),
                       'pinned': 'manual' if atoms.get('pinned-sidebar-sort-mode-v1', 'manual') == 'manual' else 'updated_at'}
        host_key = 'local:' + str(STORE)
        mapping = state.get('app-server-project-id-by-legacy-project-id-by-host', {}).get(host_key, {})
        reverse = {server: legacy for legacy, server in mapping.items()}
        def item_key(key):
            if key.startswith('codex:project:'): return 'project:' + mapping.get(key[14:], key[14:])
            if key.startswith('codex:thread:local:'): return 'thread:' + key[19:]
            return key
        projects = [dict(row) for row in db.execute('SELECT id,name,position FROM projects ORDER BY position,id')]
        roots = [r for r in db.execute('SELECT project_id,path FROM project_roots ORDER BY position') if isinstance(r['path'], str) and r['path'].startswith('/')]
        project_ids = {p['id'] for p in projects}
        project_orders = state.get('sidebar-project-thread-orders', {})
        for project in projects:
            project.update(roots=[r['path'] for r in roots if r['project_id'] == project['id']],
                           legacyId=reverse.get(project['id'], project['id']), recencyAt=0, threadIds=[])
        project_by_id = {p['id']: p for p in projects}
        sections_db = {r['id']: dict(r) for r in db.execute('SELECT id,name FROM thread_sections')}
        sections = []
        for section in layout.get('sections', []):
            server_id = section.get('hostSectionIds', {}).get('local')
            # A removed server section must not be revived by stale desktop metadata.
            if server_id not in sections_db or server_id == PINNED_SECTION:
                continue
            sections.append({'id': server_id, 'desktopId': section['id'], 'name': sections_db[server_id]['name'],
                             'itemKeys': section.get('itemKeys', []), 'itemOrder': [item_key(k) for k in section.get('itemKeys', [])], 'projectIds': [], 'threadIds': []})
        sections_by_id = {s['id']: s for s in sections}
        placed_projects = set()
        pinned_projects = []
        for legacy in state.get('pinned-project-ids', []) if account else []:
            pid = mapping.get(legacy, legacy)
            if pid in project_ids and pid not in placed_projects:
                pinned_projects.append(pid); placed_projects.add(pid)
        for section in sections:
            for key in section['itemKeys']:
                if key.startswith('codex:project:'):
                    pid = mapping.get(key[14:], key[14:])
                    if pid in project_ids and pid not in placed_projects:
                        section['projectIds'].append(pid); placed_projects.add(pid)
        resolve = desktop_membership(db)
        columns = {r['name'] for r in db.execute('PRAGMA table_info(threads)')}
        optional = ['originator', 'recency_at', 'is_pinned', 'section_position', 'section_entered_at_ms']
        query_columns = list(THREAD_COLUMNS) + [c for c in optional if c in columns]
        rows = db.execute('SELECT ' + ','.join(query_columns) + " FROM threads WHERE source IN (?, ?, ?, ?) AND COALESCE(thread_source,'') != 'ambient_suggestions'", INTERACTIVE_SOURCES).fetchall()
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        receipts = {r['thread_id']: dict(r) for r in db.execute('SELECT thread_id,first_unread_turn,revision FROM thread_read_receipts')} if 'thread_read_receipts' in tables else {}
        migrated_pins = set(state.get('app-server-migrated-pinned-thread-ids-by-host', {}).get(host_key, []))
        legacy_pin_order = state.get('pinned-thread-ids', []) if account else []
        legacy_pin_positions = {tid:i for i,tid in enumerate(legacy_pin_order)}
        legacy_pins = set(legacy_pin_order) - migrated_pins
        threads = []
        for row in rows:
            values = dict(row)
            t = normalized_thread(row)
            # Keep membership and placement distinct. Section placement wins only in rendering.
            t['projectId'] = resolve({**t, 'sectionId': None})
            t['preview'] = t['preview'][:200]
            t['recencyAt'] = values.get('recency_at') or t['updatedAt']
            t['isPinned'] = t['sectionId'] == PINNED_SECTION or bool(values.get('is_pinned')) or t['id'] in legacy_pins
            t['sectionPosition'] = values.get('section_position')
            receipt = receipts.get(t['id'])
            t['readRevision'] = receipt['revision'] if receipt else None
            # Desktop uses identity-scoped host read state, not the engine receipt.
            # Without the desktop read-state API, do not display a guessed unread dot.
            t['isUnread'] = None
            t['revision'] = sidebar_revision([t['id'],t['name'],t['projectId'],t['sectionId'],t['archived'],t['isPinned'],t['sectionPosition'],t['readRevision']])
            threads.append(t)
            if not t['archived'] and t['projectId'] in project_by_id:
                p = project_by_id[t['projectId']]
                p['recencyAt'] = max(p['recencyAt'], t['recencyAt'])
        if payload.get('includeActivity') is not False:
            sidebar_activity(threads)
        by_id = {t['id']: t for t in threads}
        for s in sections:
            s['revision'] = sidebar_revision([s['name'],sorted(t['id'] for t in threads if t['sectionId'] == s['id'])])
        # Preserve manual ordering, including legacy project thread order during migration.
        def recent(t): return (-t['recencyAt'], t['id'])
        def section_order(t): return (t['sectionPosition'] if t['sectionPosition'] is not None else legacy_pin_positions.get(t['id'], MAX_SQLITE_INTEGER), t['id'])
        active = sorted((t for t in threads if not t['archived']), key=recent)
        pinned = [t for t in active if t['isPinned']]
        pinned.sort(key=recent if preferences['pinned'] == 'updated_at' else section_order)
        root_threads = []
        for t in active:
            if t['isPinned']: continue
            if t['sectionId'] in sections_by_id:
                sections_by_id[t['sectionId']]['threadIds'].append(t['id'])
            elif t['projectId'] in project_by_id:
                project_by_id[t['projectId']]['threadIds'].append(t['id'])
            else: root_threads.append(t['id'])
        for p in projects:
            order = project_orders.get(p['legacyId'], {}).get('threadIds', [])
            if preferences['chats'] == 'manual':
                positions = {tid: index for index, tid in enumerate(order)}
                p['threadIds'].sort(key=lambda tid: (positions.get(tid, MAX_SQLITE_INTEGER), section_order(by_id[tid])))
            p['revision'] = sidebar_revision([p['name'],p['roots'],p['position']])
        for s in sections:
            s['threadIds'].sort(key=lambda tid: section_order(by_id[tid]))
        if preferences['chats'] == 'manual':
            order = {item_key(key): i for i,key in enumerate(atoms.get('unified-sidebar-chat-order-v1', []))}
            root_threads.sort(key=lambda tid: (order.get('thread:'+tid, MAX_SQLITE_INTEGER), section_order(by_id[tid])))
        if preferences['projects'] == 'updated_at': projects.sort(key=lambda p: (-p['recencyAt'],p['position'],p['id']))
        else:
            order = {item_key(key): i for i,key in enumerate(atoms.get('unified-sidebar-project-order-v1', []))}
            projects.sort(key=lambda p: (order.get('project:'+p['id'], MAX_SQLITE_INTEGER),p['position'],p['id']))
        ordered_sections = layout.get('sectionOrder', [])
        section_positions = {key: index for index,key in enumerate(ordered_sections)}
        sections.sort(key=lambda s: section_positions.get('custom:' + s['desktopId'], MAX_SQLITE_INTEGER))
        archived = archived_flag(payload)
        search = (optional_text(payload, 'search') or '').casefold()
        visible = [t for t in (threads if archived else active) if t['archived'] == archived and (not search or search in (t['name'] or t['preview']).casefold())]
        visible.sort(key=recent)
        offset = cursor_number(payload) or 0
        page = visible[offset:offset+50] if archived else visible
        return {'data': page, 'nextCursor': 'db:' + str(offset+50) if archived and len(visible)>offset+50 else None,
                'projects': projects, 'sections': sections, 'pinnedThreadIds': [t['id'] for t in pinned], 'pinnedProjectIds': pinned_projects,
                'rootThreadIds': root_threads, 'rootProjectIds': [p['id'] for p in projects if p['id'] not in placed_projects],
                'sectionOrder': ordered_sections, 'pinnedOrder': [item_key(k) for k in atoms.get('unified-sidebar-pinned-order-v1', [])] if account else [],
                'chatOrder': [item_key(k) for k in atoms.get('unified-sidebar-chat-order-v1', [])] if account else [], 'preferences': preferences, 'archived': archived,
                'accountScope': sidebar_revision(account) if account else None, 'accountLayoutAvailable': bool(account),
                'historySource': 'snapshot', 'total': len(visible), 'selectedThread': by_id.get(payload.get('selectedId'))}
    finally:
        db.close()


def read_cli_turns(payload):
    identifiers = payload.get('threadIds', [])
    if not isinstance(identifiers, list) or len(identifiers) > 200 or any(not isinstance(i, str) or not re.fullmatch(r'[a-fA-F0-9-]{36}', i) for i in identifiers):
        raise ValueError('会话标识无效。')
    db = connect_store('thread_history_1.sqlite')
    try:
        data = []
        for identifier in identifiers:
            row = db.execute('SELECT turn_id,status,started_at FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1', [identifier]).fetchone()
            if row:
                data.append({'threadId': identifier, 'id': row['turn_id'], 'status': row['status'], 'startedAt': row['started_at']})
        return {'data': data}
    finally:
        db.close()


def read_sidebar_activity(payload):
    identifiers = payload.get('threadIds', [])
    if not isinstance(identifiers, list) or len(identifiers) > 200 or any(not isinstance(i, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', i) for i in identifiers):
        raise ValueError('会话标识无效。')
    rows = [{'id': identifier} for identifier in identifiers]
    sidebar_activity(rows)
    account = payload.get('accountId')
    return {'data': rows, 'accountScope': sidebar_revision(account) if account else None}


def main():
    payload = globals().get('PAYLOAD')
    if not isinstance(payload, dict):
        raise ValueError('PAYLOAD 必须是 JSON 对象。')
    action = payload.get('action')
    handlers = {'cliTurns': read_cli_turns, 'goal': read_goal_snapshot, 'takeoverState': read_takeover_state, 'turnDirectory': read_turn_directory, 'toolItem': read_tool_item, 'sidebar': read_sidebar, 'sidebarActivity': read_sidebar_activity, 'sidebarMetadata': read_sidebar_metadata, 'notices':read_notices, 'threads': read_threads, 'detail': read_detail, 'history': read_history, 'image': read_image, 'outputs': read_outputs}
    if action not in handlers:
        raise ValueError('不支持的只读操作。')
    return handlers[action](payload)


if __name__ == '__main__' or 'PAYLOAD' in globals():
    try:
        emit(main())
    except Exception as exc:
        emit({'error': str(exc)})
