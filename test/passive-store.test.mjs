import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { decodeRemoteResult } from '../lib/ssh.mjs';

const adapter = await readFile(new URL('../scripts/passive-store.py', import.meta.url), 'utf8');
const python = '/usr/bin/python3';
const buildFixture = `
import sys,json,pathlib,sqlite3
p=json.load(sys.stdin)
root=pathlib.Path(p['home'])/'.codex'
root.mkdir()
s=sqlite3.connect(str(root/'state_5.sqlite'))
s.execute('CREATE TABLE threads (id TEXT PRIMARY KEY,name TEXT,title TEXT,cwd TEXT,created_at INTEGER,updated_at INTEGER,preview TEXT,archived INTEGER,model TEXT,reasoning_effort TEXT,cli_version TEXT,source TEXT DEFAULT "cli",project_id TEXT,thread_source TEXT,thread_section_id TEXT)')
s.execute('CREATE TABLE projects(id TEXT PRIMARY KEY)')
s.execute('CREATE TABLE project_roots(project_id TEXT,path TEXT)')
s.executemany('INSERT INTO threads(id,name,title,cwd,created_at,updated_at,preview,archived,model,reasoning_effort,cli_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[[r[k] for k in ['id','name','title','cwd','created_at','updated_at','preview','archived','model','reasoning_effort','cli_version']] for r in p['threads']])
if p.get('missingThreadColumn'):
    s.execute('ALTER TABLE threads DROP COLUMN '+p['missingThreadColumn'])
s.commit();s.close()
h=sqlite3.connect(str(root/'thread_history_1.sqlite'))
h.execute('CREATE TABLE thread_turns (thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,error_json TEXT,started_at INTEGER,completed_at INTEGER,duration_ms INTEGER,PRIMARY KEY(thread_id,turn_id))')
h.execute('CREATE TABLE thread_items (thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,item_json TEXT,item_type TEXT,PRIMARY KEY(thread_id,item_id))')
h.executemany('INSERT INTO thread_turns VALUES (?,?,?,?,?,?,?,?)',[[r[k] for k in ['thread_id','turn_id','rollout_ordinal','status','error_json','started_at','completed_at','duration_ms']] for r in p['turns']])
h.executemany('INSERT INTO thread_items VALUES (?,?,?,?,?,?)',[[r['thread_id'],r['turn_id'],r['item_id'],r['rollout_ordinal'],json.dumps(r['item'],ensure_ascii=False),r['item'].get('type')] for r in p['items']])
if p.get('missingItemColumn'):
    h.execute('ALTER TABLE thread_items DROP COLUMN '+p['missingItemColumn'])
h.commit();h.close()
`;

function runPython(code, input) {
  const result = spawnSync(python, ['-c', code], { input, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const thread = (id, overrides = {}) => ({
  id, name: `会话 ${id}`, title: `旧标题 ${id}`, cwd: '/Users/example/project',
  created_at: 100, updated_at: 100, preview: `预览 ${id}`, archived: 0,
  model: 'model-a', reasoning_effort: 'high', cli_version: '0.162.test', ...overrides,
});
const turn = (ordinal, overrides = {}) => ({
  thread_id: 'original', turn_id: `turn-${ordinal}`, rollout_ordinal: ordinal,
  status: 'completed', error_json: null, started_at: 1000 + ordinal,
  completed_at: 2000 + ordinal, duration_ms: 1000, ...overrides,
});
const item = (turnOrdinal, ordinal, content) => ({
  thread_id: 'original', turn_id: `turn-${turnOrdinal}`, item_id: `item-${turnOrdinal}-${ordinal}`,
  rollout_ordinal: ordinal, item: { id: `item-${turnOrdinal}-${ordinal}`, type: 'agentMessage', text: content },
});

async function fixture(t, values = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'rcm-passive-'));
  t.diagnostic('Retained isolated fixture: '+home);
  runPython(buildFixture, JSON.stringify({ home, threads: [thread('original')], turns: [], items: [], ...values }));
  const query = (payload) => {
    const input = Buffer.from(JSON.stringify({ home, payload })).toString('base64');
    const source = `import base64,json\n_v=json.loads(base64.b64decode('${input}'))\nSTORE_HOME=_v['home']\nPAYLOAD=_v['payload']\n` + adapter;
    const output = runPython(source);
    const rows = output.trim().split('\n');
    assert.equal(rows.length, 1, 'The adapter must emit exactly one structured result.');
    assert.ok(rows[0].startsWith('RCM_ZJSON:'), output.slice(0,100));
    try{return decodeRemoteResult(output);}catch(error){return {error:error.message};}
  };
  return { home, query };
}

test('thread listing normalizes metadata and filters name, title, cwd, and archived state', async (t) => {
  const { query } = await fixture(t, { threads: [
    thread('named', { name: '新会话名称', title: '旧标题', updated_at: 300 }),
    thread('fallback', { name: null, title: '厨房方案', updated_at: 200 }),
    thread('elsewhere', { name: '厨房预算', cwd: '/Users/example/other', updated_at: 250 }),
    thread('archived', { title: '厨房归档', archived: 1, updated_at: 400 }),
  ] });
  const result = query({ action: 'threads', search: '厨房', cwd: '/Users/example/project' });
  assert.deepEqual(result.data.map((row) => row.id), ['fallback']);
  assert.equal(result.historySource, 'snapshot');
  assert.equal(result.data[0].name, '厨房方案');
  assert.equal(result.data[0].model, 'model-a');
  assert.equal(result.data[0].reasoningEffort, 'high');
  assert.deepEqual(result.data[0].status, { type: 'notLoaded' });
  assert.deepEqual(query({ action: 'threads', search: '新会话' }).data.map((row) => row.id), ['named']);
  assert.deepEqual(query({ action: 'threads', archived: true }).data.map((row) => row.id), ['archived']);
  assert.equal(query({ action: 'threads', archived: 'false' }).data.some((row) => row.id === 'archived'), false);
});

test('SQL injection and LIKE wildcards remain literal user input', async (t) => {
  const { query } = await fixture(t, { threads: [thread('original'), thread('percentage', { name: '100%完成_方案' })] });
  assert.deepEqual(query({ action: 'threads', search: "%' OR 1=1 --" }).data, []);
  assert.deepEqual(query({ action: 'threads', cwd: "x' OR 1=1 --" }).data, []);
  assert.deepEqual(query({ action: 'threads', search: '%' }).data.map((row) => row.id), ['percentage']);
  assert.deepEqual(query({ action: 'threads', search: '_' }).data.map((row) => row.id), ['percentage']);
  assert.match(query({ action: 'detail', threadId: "original' OR 1=1 --" }).error, /未找到会话/);
  assert.deepEqual(query({ action: 'history', threadId: "original' OR 1=1 --" }).data, []);
});

test('thread cursor pages 50 rows with stable ordering for equal timestamps', async (t) => {
  const ids = Array.from({ length: 55 }, (_, i) => `thread-${String(i).padStart(2, '0')}`);
  const { query } = await fixture(t, { threads: [...ids].reverse().map((id) => thread(id)) });
  const first = query({ action: 'threads' });
  const second = query({ action: 'threads', cursor: first.nextCursor });
  assert.equal(first.data.length, 50);
  assert.equal(first.nextCursor, 'db:50');
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.data, ...second.data].map((row) => row.id), ids);
});

test('history pages five turns by ordinal and retains each item in original chronological order', async (t) => {
  const turns = Array.from({ length: 7 }, (_, i) => turn(i + 1));
  const items = turns.flatMap((row, i) => [item(i + 1, 30, 'third'), item(i + 1, 10, 'first'), item(i + 1, 20, 'second')]);
  const { query } = await fixture(t, { turns, items });
  const first = query({ action: 'history', threadId: 'original' });
  const second = query({ action: 'history', threadId: 'original', cursor: first.nextCursor });
  assert.deepEqual(first.data.map((row) => row.id), ['turn-7', 'turn-6', 'turn-5', 'turn-4', 'turn-3']);
  assert.equal(first.nextCursor, 'db:3');
  assert.deepEqual(second.data.map((row) => row.id), ['turn-2', 'turn-1']);
  assert.equal(second.nextCursor, null);
  assert.equal(first.historySource, 'snapshot');
  assert.deepEqual(first.data[0].items.map((row) => row.text), ['first', 'second', 'third']);
  assert.equal(first.data[0].startedAt, 1007);
  assert.equal(first.data[0].completedAt, 2007);
  assert.equal(first.data[0].durationMs, 1000);
  assert.equal(first.data[0].error, null);
});

test('snapshot preserves all 193 items, long content, errors, and historical inProgress status', async (t) => {
  const fullText = '完整原文🧪\n'.repeat(25000);
  const turns = [turn(1), turn(2, { error_json: JSON.stringify({ message: '原错误', code: 123 }) }), turn(3, { status: 'inProgress', completed_at: null, duration_ms: null })];
  const items = Array.from({ length: 193 }, (_, i) => item((i % 3) + 1, i, i === 192 ? fullText : `真实内容 ${i}`));
  const { query } = await fixture(t, { turns, items: [...items].reverse() });
  const result = query({ action: 'history', threadId: 'original' });
  assert.equal(result.data.reduce((count, row) => count + row.items.length, 0), 193);
  assert.equal(result.data[0].status, 'inProgress');
  assert.equal(result.data[0].completedAt, null);
  assert.deepEqual(result.data[1].error, { message: '原错误', code: 123 });
  const expected = items.filter((row) => row.turn_id === 'turn-1').sort((a, b) => a.rollout_ordinal - b.rollout_ordinal).map((row) => row.item);
  assert.deepEqual(result.data.find((row) => row.id === 'turn-1').items, expected);
  assert.equal(result.data.flatMap((row) => row.items).find((row) => row.id === 'item-1-192').text, fullText);
});

test('snapshot reads leave SQLite file bytes and modification times unchanged', async (t) => {
  const { home, query } = await fixture(t, { turns: [turn(1)], items: [item(1, 1, 'untouched')] });
  const files = ['state_5.sqlite', 'thread_history_1.sqlite'].map((name) => path.join(home, '.codex', name));
  const fingerprint = async () => Promise.all(files.map(async (file) => ({
    sha256: createHash('sha256').update(await readFile(file)).digest('hex'), mtime: (await stat(file)).mtimeMs,
  })));
  const before = await fingerprint();
  assert.equal(query({ action: 'threads' }).data.length, 1);
  assert.equal(query({ action: 'detail', threadId: 'original' }).thread.id, 'original');
  assert.equal(query({ action: 'history', threadId: 'original' }).data.length, 1);
  assert.deepEqual(await fingerprint(), before);
});

test('large generated images load on demand while their complete original bytes remain retrievable',async(t)=>{
  const binary=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(150000,7)]);
  const generated={thread_id:'original',turn_id:'turn-1',item_id:'generated-image',rollout_ordinal:2,item:{id:'generated-image',type:'imageGeneration',status:'completed',result:binary.toString('base64'),revisedPrompt:'保留图片提示',savedPath:'/remote/output.png'}};
  const {query}=await fixture(t,{turns:[turn(1)],items:[item(1,1,'完整文字'),generated]});
  const history=query({action:'history',threadId:'original'});
  assert.equal(history.data[0].items.length,2);
  assert.equal(history.data[0].items[0].text,'完整文字');
  const ref=history.data[0].items[1];
  assert.equal(ref.result,null);assert.equal(ref.revisedPrompt,'保留图片提示');assert.equal(ref.imageRef.itemId,'generated-image');
  const original=query({action:'image',threadId:'original',itemId:'generated-image'});
  assert.equal(original.mime,'image/png');assert.deepEqual(Buffer.from(original.data,'base64'),binary);
  assert.match(query({action:'image',threadId:'original',itemId:"x' OR 1=1 --"}).error,/未找到图片/);
});

test('turns and items come from one read snapshot despite a concurrent WAL commit', async (t) => {
  const { home, query } = await fixture(t, { turns: [turn(1)], items: [item(1, 1, 'before snapshot')] });
  const input = Buffer.from(JSON.stringify({ home, payload: { action: 'history', threadId: 'original' } })).toString('base64');
  const prefix = `
import base64,json,pathlib,sqlite3
_v=json.loads(base64.b64decode('${input}'))
STORE_HOME=_v['home']
PAYLOAD=_v['payload']
_path=str(pathlib.Path(STORE_HOME)/'.codex/thread_history_1.sqlite')
_original_connect=sqlite3.connect
_setup=_original_connect(_path)
_setup.execute('PRAGMA journal_mode=WAL')
_setup.execute('SELECT COUNT(*) FROM thread_turns').fetchone()
class SnapshotConnection(sqlite3.Connection):
    def execute(self, sql, parameters=()):
        if sql.startswith('SELECT item_id') and not getattr(self,'injected',False):
            self.injected=True
            writer=_original_connect(_path)
            writer.execute('INSERT INTO thread_items VALUES (?,?,?,?,?,?)',('original','turn-1','late-item',999,json.dumps({'id':'late-item','type':'agentMessage','text':'after snapshot'}),'agentMessage'))
            writer.commit()
            writer.close()
        return super().execute(sql, parameters)
def tracked_connect(*args,**kwargs):
    assert 'mode=ro' in str(args[0]), 'Adapter must open its connection read-only'
    kwargs['factory']=SnapshotConnection
    return _original_connect(*args,**kwargs)
sqlite3.connect=tracked_connect
`;
  const output = runPython(prefix + adapter + '\n_setup.close()\n');
  const result = decodeRemoteResult(output);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.data[0].items.map((row) => row.text), ['before snapshot']);
  assert.deepEqual(query({ action: 'history', threadId: 'original' }).data[0].items.map((row) => row.text), ['before snapshot', 'after snapshot']);
});

test('invalid cursor and schema drift produce clear errors instead of partial history', async (t) => {
  const { query } = await fixture(t);
  for (const cursor of ['rpc-cursor', 'db:-1', 'db:1 OR 1=1', 'db:999999999999999999999999']) {
    assert.match(query({ action: 'threads', cursor }).error, /cursor/);
    assert.match(query({ action: 'history', threadId: 'original', cursor }).error, /cursor/);
  }
  const missingThread = await fixture(t, { missingThreadColumn: 'preview' });
  assert.match(missingThread.query({ action: 'threads' }).error, /state_5\.sqlite.*threads.*preview/);
  const missingItem = await fixture(t, { missingItemColumn: 'item_json' });
  assert.match(missingItem.query({ action: 'history', threadId: 'original' }).error, /thread_history_1\.sqlite.*thread_items.*item_json/);
});

test('combined history overlays only selected journal turns and preserves fallback output',async t=>{
 const f=await fixture(t,{turns:Array.from({length:6},(_,i)=>turn(i+1)),items:[item(6,1,'fallback')]});
 runPython(`import pathlib,sqlite3,json
p=pathlib.Path(${JSON.stringify(f.home)})/'.codex'
j=p/'remote-codex-manager';j.mkdir();d=sqlite3.connect(j/'output-journal.sqlite')
d.execute('CREATE TABLE commands(thread TEXT,turn TEXT,item TEXT,value TEXT,updated REAL)')
d.execute('CREATE TABLE output_chunks(seq INTEGER PRIMARY KEY,item TEXT,delta TEXT)')
for tid,turnid,itemid,out in [('original','turn-6','live','FIRST\\n'),('original','turn-1','old','OLD'),('other','turn-6','alien','WRONG')]:
 d.execute('INSERT INTO commands VALUES (?,?,?,?,?)',(tid,turnid,itemid,json.dumps({'id':itemid,'type':'commandExecution','aggregatedOutput':out}),1))
d.execute('INSERT INTO output_chunks VALUES (1,?,?)',('live','中间😀\\nEND\\n'));d.commit();d.close()
`);
 const result=f.query({action:'history',threadId:'original',withOutputs:true});
 assert.equal(result.data.length,5);
 const items=result.data.flatMap(t=>t.items);
 assert.equal(items.find(i=>i.id==='live').aggregatedOutput,'FIRST\n中间😀\nEND\n');
 assert.equal(items.find(i=>i.id==='item-6-1').text,'fallback');
 assert.ok(!items.some(i=>i.id==='old'||i.id==='alien'));
});
test('cold history bounds fallback command output and full read clears partial state',async t=>{
 const entry=item(1,1,'');entry.item={id:entry.item_id,type:'commandExecution',aggregatedOutput:'首段😀\n'+'重复行\n'.repeat(10000)};
 const f=await fixture(t,{turns:[turn(1)],items:[entry]});
 const preview=f.query({action:'history',threadId:'original',preview:true}).data[0].items[0];
 assert.equal(Array.from(preview.aggregatedOutput).length,16384);assert.equal(preview.outputPartial,true);
 const full=f.query({action:'history',threadId:'original'}).data[0].items[0];
 assert.equal(full.aggregatedOutput,entry.item.aggregatedOutput);assert.equal(full.outputPartial,false);
});
