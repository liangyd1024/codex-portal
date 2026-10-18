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
    roots = sorted(connection.execute('SELECT project_id, path FROM project_roots'), key=lambda r: len(r['path']), reverse=True)
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
            cwd = hints.get(thread['id'], thread.get('cwd', '')).rstrip('/')
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
        rows = connection.execute('SELECT id, project_id, cwd, thread_section_id FROM threads WHERE id IN (' + ','.join('?' for _ in identifiers) + ')', identifiers)
        return {'data': {row['id']: {'projectId': resolve({'id': row['id'], 'projectId': row['project_id'], 'cwd': row['cwd'], 'sectionId': row['thread_section_id']})} for row in rows}}
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
        sql = 'SELECT ' + ', '.join(THREAD_COLUMNS) + ' FROM threads WHERE ' + ' AND '.join(conditions)
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


def read_detail(payload):
    connection = connect_store('state_5.sqlite')
    try:
        require_columns(connection, 'state_5.sqlite', 'threads', THREAD_COLUMNS)
        identifier = thread_id(payload)
        row = connection.execute('SELECT ' + ', '.join(THREAD_COLUMNS) + ' FROM threads WHERE id = ?', (identifier,)).fetchone()
        if row is None:
            raise ValueError('未找到会话：' + identifier)
        return {'thread': normalized_thread(row), 'historySource': 'snapshot'}
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
    # Image bytes remain available through a separate media request. History keeps
    # every item and all text, without transferring multi-megabyte base64 previews.
    if value.get('type') == 'imageGeneration' and isinstance(value.get('result'), str) and len(value['result']) > 100000:
        value['imageRef'] = {'threadId': identifier, 'itemId': item['item_id'], 'base64Length': len(value['result'])}
        value['result'] = None
    return value


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
        if value.get('type') != 'imageGeneration' or not isinstance(value.get('result'), str):
            raise ValueError('该记录不是生成图片。')
        content = base64.b64decode(value['result'], validate=True)
        if content.startswith(b'\x89PNG\r\n\x1a\n'):
            mime, extension = 'image/png', 'png'
        elif content.startswith(b'\xff\xd8\xff'):
            mime, extension = 'image/jpeg', 'jpg'
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


def read_history(payload):
    connection = connect_store('thread_history_1.sqlite')
    try:
        require_columns(connection, 'thread_history_1.sqlite', 'thread_turns', TURN_COLUMNS)
        require_columns(connection, 'thread_history_1.sqlite', 'thread_items', ITEM_COLUMNS)
        identifier = thread_id(payload)
        before = cursor_number(payload)
        conditions = ['thread_id = ?']
        parameters = [identifier]
        if before is not None:
            conditions.append('rollout_ordinal < ?')
            parameters.append(before)
        sql = 'SELECT ' + ', '.join(TURN_COLUMNS) + ' FROM thread_turns WHERE ' + ' AND '.join(conditions)
        sql += ' ORDER BY rollout_ordinal DESC, turn_id DESC LIMIT ?'
        rows = connection.execute(sql, parameters + [6]).fetchall()
        outputs = read_outputs({**payload, 'turnIds': [row['turn_id'] for row in rows[:5]]})['data'] if payload.get('withOutputs') else []
        journal_ids = [entry['item']['id'] for entry in outputs]
        item_sql = "CASE WHEN json_extract(item_json,'$.type')='commandExecution' THEN json_set(item_json,'$.aggregatedOutput',substr(coalesce(json_extract(item_json,'$.aggregatedOutput'),''),1,16384),'$.outputPartial',json('true')) ELSE item_json END" if payload.get('preview') else 'item_json'
        # Do not decode and transmit the same large command twice. Keep fallback
        # history intact when no authoritative private journal entry exists.
        if journal_ids:
            item_sql = 'CASE WHEN item_id IN (' + ','.join('?' for _ in journal_ids) + ') THEN json_remove(item_json, \'$.aggregatedOutput\') ELSE ' + item_sql + ' END'
        turns = []
        for row in rows[:5]:
            items = connection.execute(
                'SELECT item_id, ' + item_sql + ' AS item_json FROM thread_items WHERE thread_id = ? AND turn_id = ? '
                'ORDER BY rollout_ordinal ASC, item_id ASC',
                [*journal_ids, identifier, row['turn_id']],
            ).fetchall()
            turns.append({
                'id': row['turn_id'],
                'status': row['status'],
                'error': decode_json(row['error_json'], 'thread_turns.error_json', row['turn_id']),
                'startedAt': row['started_at'],
                'completedAt': row['completed_at'],
                'durationMs': row['duration_ms'],
                'items': [history_item(item, identifier) for item in items],
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
            'nextCursor': 'db:' + str(rows[4]['rollout_ordinal']) if len(rows) > 5 else None,
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


def main():
    payload = globals().get('PAYLOAD')
    if not isinstance(payload, dict):
        raise ValueError('PAYLOAD 必须是 JSON 对象。')
    action = payload.get('action')
    handlers = {'sidebarMetadata': read_sidebar_metadata, 'notices':read_notices, 'threads': read_threads, 'detail': read_detail, 'history': read_history, 'image': read_image, 'outputs': read_outputs}
    if action not in handlers:
        raise ValueError('不支持的只读操作。')
    return handlers[action](payload)


if __name__ == '__main__' or 'PAYLOAD' in globals():
    try:
        emit(main())
    except Exception as exc:
        emit({'error': str(exc)})
