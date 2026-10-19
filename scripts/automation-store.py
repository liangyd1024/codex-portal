"""Read native desktop automation snapshots; never write or schedule tasks."""
import json
import os
import pathlib
import pwd
import sqlite3
import time


def read_automations(home):
    root = pathlib.Path(home) / '.codex'
    candidates = [p for p in (root / 'sqlite/codex.db', root / 'sqlite/codex-dev.db') if p.is_file()]
    if len(candidates) != 1:
        raise ValueError('未找到唯一的原生桌面任务库，请在目标机器打开 Codex 定时任务页面后重试。')
    db = sqlite3.connect(candidates[0].resolve().as_uri() + '?mode=ro', uri=True, timeout=3)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        required = {'id', 'name', 'prompt', 'status', 'rrule', 'kind', 'target_thread_id', 'project_id',
                    'next_run_at', 'last_run_at', 'updated_at', 'account_id', 'user_id', 'installation_id'}
        columns = {row['name'] for row in db.execute('PRAGMA table_info(automations)')}
        if not required <= columns:
            raise ValueError('当前 Codex 任务库格式尚未支持，请更新 RCM 后重试。')
        # The desktop has separate owner/migration rules. Never guess an account
        # or expose cached rows from a previous sign-in as current tasks.
        if db.execute('SELECT 1 FROM automations WHERE account_id IS NOT NULL OR user_id IS NOT NULL OR installation_id IS NOT NULL LIMIT 1').fetchone():
            raise ValueError('原生任务已启用账户存储迁移，当前只读适配暂不可用；请在桌面查看任务。')
        rows = db.execute('SELECT id,name,prompt,status,rrule,kind,target_thread_id,project_id,next_run_at,last_run_at,updated_at FROM automations WHERE status != ? ORDER BY updated_at DESC LIMIT 501', ('DELETED',)).fetchall()
        items = []
        pending = False
        for row in rows[:500]:
            identifier = row['id']
            if not isinstance(identifier, str) or identifier in ('', '.', '..') or '/' in identifier or '\\' in identifier:
                continue
            config = root / 'automations' / identifier / 'automation.toml'
            if not config.is_file():
                continue
            if not config.resolve().is_relative_to((root / 'automations').resolve()):
                raise ValueError('任务配置路径异常。')
            # Changes external to the native service must be reconciled by it.
            if config.stat().st_mtime * 1000 > row['updated_at'] + 2000:
                pending = True
                continue
            items.append(dict(row))
        ids = {item['id'] for item in items}
        runs = [dict(row) for row in db.execute('SELECT thread_id,automation_id,status,thread_title,inbox_title,inbox_summary,created_at,updated_at FROM automation_runs ORDER BY created_at DESC LIMIT 200') if row['automation_id'] in ids]
        return {'items': items, 'runs': runs, 'pendingNativeRefresh': pending,
                'truncated': len(rows) > 500, 'observedAt': int(time.time() * 1000)}
    finally:
        db.close()


if 'PAYLOAD' in globals():
    try:
        home = pathlib.Path(globals().get('SERVICE_HOME', str(pathlib.Path.home())))
        if home != pathlib.Path.home() or globals().get('SERVICE_USER', pwd.getpwuid(os.getuid()).pw_name) != pwd.getpwuid(os.getuid()).pw_name:
            raise ValueError('目标身份不符。')
        result = read_automations(home)
    except Exception as exc:
        result = {'failure': {'code': 'AUTOMATIONS_UNAVAILABLE', 'message': str(exc)}}
    print('RCM_JSON:' + json.dumps(result, ensure_ascii=False))
