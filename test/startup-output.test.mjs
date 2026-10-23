import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('live output restores startup bytes from the same thread, turn and process without poll duplication',()=>{
 const r=spawnSync('/usr/bin/python3',['-'],{encoding:'utf8',input:String.raw`
import pathlib,tempfile,sqlite3,json
source=pathlib.Path('scripts/passive-store.py').read_text().split('\ntry:\n    emit(main())')[0]
if True:
 root=tempfile.mkdtemp(prefix="rcm-output-test-")
 ns={'STORE_HOME':root};exec(source,ns)
 store=pathlib.Path(root)/'.codex';store.mkdir();rollout=store/'test.jsonl'
 db=sqlite3.connect(store/'state_5.sqlite');db.execute('CREATE TABLE threads(id TEXT,rollout_path TEXT)');db.execute('INSERT INTO threads VALUES (?,?)',('t',str(rollout)));db.commit();db.close()
 def call(cid,code):return {'payload':{'type':'custom_tool_call','call_id':cid,'input':code}}
 def result(cid,turn,pid,out):return {'payload':{'type':'custom_tool_call_output','call_id':cid,'internal_chat_message_metadata_passthrough':{'turn_id':turn},'output':[{'text':json.dumps({'session_id':pid,'output':out})}]}}
 entries=[call('a','tools.exec_command(...)'),result('a','turn',42,'user\npath\n1\n'),call('b','tools.write_stdin(...)'),result('b','turn',42,'2\n'),call('c','tools.exec_command(...)'),result('c','other',42,'WRONG\n')]
 rollout.write_text('\n'.join(map(json.dumps,entries))+'\n{partial')
 wanted={('turn','42')};prefixes=ns['startup_outputs']('t',wanted)
 assert prefixes=={('turn','42'):'user\npath\n1\n'},prefixes
 assert ns['startup_outputs']('other',wanted)=={}
 merge=ns['restore_startup']
 assert merge(prefixes[('turn','42')],'2\n3\n')=='user\npath\n1\n2\n3\n'
 assert merge('1\n2\n','2\n3\n')=='1\n2\n3\n'
 assert merge('same\nsame\n','same\nsame\nsame\n')=='same\nsame\nsame\n'
 assert merge('first\n','')=='first\n'
 journal=store/'remote-codex-manager';journal.mkdir();db=sqlite3.connect(journal/'output-journal.sqlite');db.execute('CREATE TABLE commands(thread TEXT,turn TEXT,value TEXT,updated REAL)');db.execute('INSERT INTO commands VALUES (?,?,?,?)',('t','turn',json.dumps({'id':'exec','processId':'42','status':'inProgress','aggregatedOutput':'2\n3\n'}),1));db.commit();db.close()
 out=ns['read_outputs']({'threadId':'t'})['data'][0]['item']['aggregatedOutput'];assert out=='user\npath\n1\n2\n3\n',out
 token=ns['read_outputs']({'threadId':'t'})['data'][0]['item']['outputToken']
 same=ns['read_outputs']({'threadId':'t','outputVersions':{'exec':token}})['data'][0]['item']
 assert same['outputDelta']=='' and 'aggregatedOutput' not in same
 db=sqlite3.connect(journal/'output-journal.sqlite');db.execute('UPDATE commands SET value=?',(json.dumps({'id':'exec','processId':'42','aggregatedOutput':'2\n3\n中间😀\nsame\nsame\n'}),));db.commit();db.close()
 delta=ns['read_outputs']({'threadId':'t','outputVersions':{'exec':token}})['data'][0]['item']
 assert delta['outputDelta']=='中间😀\nsame\nsame\n' and delta['outputBaseToken']==token
 bad=ns['read_outputs']({'threadId':'t','outputVersions':{'exec':'1:'+('a'*64)}})['data'][0]['item']
 assert 'aggregatedOutput' in bad and 'outputDelta' not in bad
 db=sqlite3.connect(journal/'output-journal.sqlite');db.execute('UPDATE commands SET value=?',(json.dumps({'id':'exec','processId':'42','aggregatedOutput':'2\n3\n'}),));db.commit();db.close()
 # Cached startup survives rollout tail eviction and completed snapshots.
 rollout.write_text('x'*9000000)
 out=ns['read_outputs']({'threadId':'t'})['data'][0]['item']['aggregatedOutput'];assert out=='user\npath\n1\n2\n3\n',out
`}); assert.equal(r.status,0,r.stdout+r.stderr);
});
test('cold preview is bounded and its Unicode prefix hydrates exactly while chunks grow',()=>{
 const r=spawnSync('/usr/bin/python3',['-'],{encoding:'utf8',input:String.raw`
import pathlib,tempfile,sqlite3,json,hashlib
source=pathlib.Path('scripts/passive-store.py').read_text().split('\ntry:\n    emit(main())')[0]
if True:
 root=tempfile.mkdtemp(prefix="rcm-output-test-")
 ns={'STORE_HOME':root};exec(source,ns)
 journal=pathlib.Path(root)/'.codex/remote-codex-manager';journal.mkdir(parents=True)
 db=sqlite3.connect(journal/'output-journal.sqlite')
 db.executescript('CREATE TABLE commands(thread TEXT,turn TEXT,value TEXT,updated REAL);CREATE TABLE output_chunks(item TEXT,seq INTEGER,delta TEXT);CREATE TABLE startup_prefixes(item TEXT PRIMARY KEY,prefix TEXT);')
 expected='首段😀\n'+('相同行😀\n'*40000)
 for mode in ('base','chunks'):
  db.execute('DELETE FROM commands');db.execute('DELETE FROM output_chunks');db.execute('DELETE FROM startup_prefixes')
  db.execute('INSERT INTO commands VALUES (?,?,?,?)',('t','turn',json.dumps({'id':'exec','processId':'42','aggregatedOutput':expected if mode=='base' else ''}),1))
  db.execute('INSERT INTO startup_prefixes VALUES (?,?)',('exec',''))
  if mode=='chunks':
   for n in range(0,len(expected),1000):db.execute('INSERT INTO output_chunks VALUES (?,?,?)',('exec',n,expected[n:n+1000]))
  db.commit()
  preview=ns['read_outputs']({'threadId':'t','preview':True})['data'][0]['item']
  assert preview['aggregatedOutput']==expected[:16384] and preview['outputPartial'] is True
  db.execute('INSERT INTO output_chunks VALUES (?,?,?)',('exec',999999,'新增😀\n'));db.commit()
  full=ns['read_outputs']({'threadId':'t','outputVersions':{'exec':preview['outputToken']}})['data'][0]['item']
  assert full['outputPartial'] is False
  assert preview['aggregatedOutput']+full['outputDelta']==expected+'新增😀\n'
  assert full['outputToken'].split(':')[1]==hashlib.sha256((expected+'新增😀\n').encode()).hexdigest()
  import gzip,base64
  packed=ns['read_outputs']({'threadId':'t','outputEncoding':'gzip-base64','outputVersions':{'exec':preview['outputToken']}})['data'][0]['item']
  assert 'outputDelta' not in packed and packed['outputCompressed']['field']=='outputDelta'
  assert preview['aggregatedOutput']+gzip.decompress(base64.b64decode(packed['outputCompressed']['data'])).decode()==expected+'新增😀\n'
  packed=ns['read_outputs']({'threadId':'t','outputEncoding':'gzip-base64'})['data'][0]['item']
  assert packed['outputCompressed']['field']=='aggregatedOutput'
  assert gzip.decompress(base64.b64decode(packed['outputCompressed']['data'])).decode()==expected+'新增😀\n'

`});assert.equal(r.status,0,r.stdout+r.stderr);
});
