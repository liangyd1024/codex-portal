"""Validate this client's actual request contract, independent of Codex release numbers."""
import json
import pathlib
import subprocess
import tempfile
import os

PROTOCOL_POLICY = 12
REQUEST_FIELDS = {
    'thread/fork': {'threadId','ephemeral','excludeTurns','developerInstructions','approvalPolicy','sandbox','model','config'},
    'thread/items/list': {'threadId','limit','sortDirection','cursor'},
    'mcpServerStatus/list': {'threadId','serverName','detail'},
    'mcpServer/tool/call': {'threadId','server','tool','arguments'},
    'fs/getMetadata': {'path'},
    'fs/readDirectory': {'path'},
    'fs/createDirectory': {'path','recursive'},
    'project/list': {'cursor','limit'},
    'project/create': {'idempotencyKey','name','roots'},
    'account/read': set(),
    'thread/archive': {'threadId'},
    'thread/unarchive': {'threadId'},
    'thread/metadata/update': {'threadId','projectId'},
    'thread/section/move': {'threadId','sectionId','beforeThreadId'},
    'thread/readState/update': {'threadId','expectedRevision','operation'},
    'threadSection/create': {'name'},
    'threadSection/update': {'sectionId','name'},
    'threadSection/delete': {'sectionId'},
    'initialize': {'clientInfo', 'capabilities'},
    'model/list': {'limit', 'cursor', 'includeHidden'},
    'thread/list': {'limit', 'cursor', 'sortKey', 'sortDirection', 'useStateDbOnly', 'sourceKinds', 'searchTerm', 'cwd', 'archived'},
    'thread/read': {'threadId', 'includeTurns'},
    'thread/start': {'cwd', 'model', 'approvalPolicy', 'approvalsReviewer', 'sandbox', 'serviceName', 'projectId', 'config'},
    'thread/resume': {'threadId', 'excludeTurns'},
    'thread/unsubscribe': {'threadId'},
    'thread/name/set': {'threadId', 'name'},
    'thread/loaded/list': {'cursor'},
    'thread/goal/get': {'threadId'},
    'thread/goal/clear': {'threadId','origin'},
    'thread/backgroundTerminals/list': {'threadId', 'limit'},
    'thread/backgroundTerminals/terminate': {'threadId','processId'},
    'thread/queue/list': {'threadId', 'limit', 'cursor'},
    'thread/queue/add': {'threadId', 'input', 'clientUserMessageId'},
    'thread/queue/delete': {'threadId', 'queuedSubmissionId'},
    'thread/queue/start': {'threadId', 'queuedSubmissionId'},
    'turn/start': {'threadId', 'input', 'model', 'effort', 'approvalPolicy', 'sandboxPolicy', 'collaborationMode'},
    'thread/turns/list': {'threadId','limit','sortDirection','itemsView'},
    'collaborationMode/list': set(),
    'skills/list': {'cwds'},
    'plugin/installed': {'cwds'},
    'thread/goal/set': {'threadId','objective','status','tokenBudget','origin'},
    'turn/steer': {'threadId', 'expectedTurnId', 'input', 'clientUserMessageId'},
    'turn/interrupt': {'threadId', 'turnId'},
}
FEATURE_METHODS = {
    'sideChat': ['thread/fork','thread/read','turn/start','turn/interrupt'],
    'threadReferences': ['thread/start','thread/resume','thread/read','thread/items/list','mcpServerStatus/list','mcpServer/tool/call'],
    'projectFolders': ['fs/getMetadata','fs/readDirectory','fs/createDirectory','project/list','project/create'],
    'capacityRetry': ['turn/start','thread/read','thread/turns/list'],
    'plan': ['collaborationMode/list','turn/start'],
    'skills': ['skills/list','turn/start'],
    'plugins': ['plugin/installed','turn/start'],
    'goal': ['thread/goal/set','thread/goal/get'],
    'goalClear': ['thread/goal/clear'],
    'create': ['thread/start', 'thread/name/set', 'turn/start'],
    'takeover': ['thread/resume'],
    'message': ['turn/start'],
    'steer': ['turn/steer'],
    'stop': ['turn/interrupt','thread/backgroundTerminals/list','thread/backgroundTerminals/terminate'],
    'queue': ['thread/queue/list'],
    'queueWrite': ['thread/queue/list','thread/queue/add','thread/queue/delete','thread/queue/start','turn/steer'],
    'release': ['thread/loaded/list', 'thread/read', 'thread/goal/get', 'thread/backgroundTerminals/list', 'thread/queue/list'],
    'handoff': ['thread/unsubscribe', 'thread/loaded/list', 'thread/read', 'thread/goal/get', 'thread/backgroundTerminals/list', 'thread/queue/list'],
}


def dereference(schema, value):
    while '$ref' in value:
        ref = value['$ref']
        if not ref.startswith('#/'):
            raise ValueError('协议引用格式不受支持：' + ref)
        value = schema
        for part in ref[2:].split('/'):
            value = value[part.replace('~1', '/').replace('~0', '~')]
    return value


def validate_request_schema(schema):
    methods = {}
    for entry in schema.get('oneOf', []):
        properties = entry.get('properties', {})
        for name in properties.get('method', {}).get('enum', []):
            methods[name] = dereference(schema, properties.get('params', {}))
    failures = {}
    for method, fields in REQUEST_FIELDS.items():
        if method not in methods:
            failures[method] = method + ' 接口缺失'
            continue
        params = methods[method]
        missing = fields - set(params.get('properties', {}))
        new_required = set(params.get('required', [])) - fields
        if missing:
            failures[method] = method + ' 缺少参数：' + ', '.join(sorted(missing))
        if new_required:
            failures[method] = method + ' 新增必填参数：' + ', '.join(sorted(new_required))
    core = [failures[method] for method in ('initialize', 'model/list') if method in failures]
    if core:
        raise RuntimeError('远端核心协议不兼容：' + '；'.join(core))
    features = {}
    for feature, required in FEATURE_METHODS.items():
        reasons = [failures[method] for method in required if method in failures]
        features[feature] = {'supported': not reasons, 'reason': '；'.join(reasons)}
    if 'config' not in methods.get('thread/resume', {}).get('properties', {}) or 'additionalContext' not in methods.get('turn/start', {}).get('properties', {}):
        features['threadReferences'] = {'supported': False, 'reason': 'thread/resume 缺少会话配置参数'}
    retry_fields = {'clientUserMessageId', 'turnTrigger'}
    if not retry_fields.issubset(methods.get('turn/start', {}).get('properties', {})):
        features['capacityRetry'] = {'supported': False, 'reason': 'turn/start 缺少原生重试标识参数'}
    return {'status': 'limited' if failures else 'validated', 'methods': len(REQUEST_FIELDS)-len(failures), 'features': features, 'unsupportedMethods': list(failures), 'policy': PROTOCOL_POLICY}


def check_protocol(binary, version, root):
    stat = binary.stat()
    identity = {'version': version, 'size': stat.st_size, 'mtimeNs': stat.st_mtime_ns, 'policy': PROTOCOL_POLICY}
    cache = root / 'protocol-validation.json'
    try:
        previous = json.loads(cache.read_text())
        if isinstance(previous, dict) and previous.get('identity') == identity and isinstance(previous.get('validation'),dict) and previous['validation'].get('status') in ('validated','limited'):
            return {**previous['validation'], 'version': version, 'cached': True}
    except (OSError, ValueError, TypeError):
        pass
    # Keep generated schemas for inspection; never recursively remove directories.
    directory = tempfile.mkdtemp(prefix='rcm-protocol-')
    result = subprocess.run([str(binary), 'app-server', 'generate-json-schema', '--experimental', '--out', directory], capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError('无法核验远端协议：' + result.stderr[-600:])
    schema = json.loads((pathlib.Path(directory) / 'ClientRequest.json').read_text())
    validation = validate_request_schema(schema)
    # Cache successful validation only. Interrupted writes never replace the previous result.
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='.protocol-', delete=False) as file:
        temporary = pathlib.Path(file.name)
        json.dump({'identity': identity, 'validation': validation}, file)
    try:
        os.replace(temporary, cache)
    finally:
        temporary.unlink(missing_ok=True)
    return {**validation, 'version': version, 'cached': False}
