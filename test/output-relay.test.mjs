import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('remote journal preserves output after client disconnect and deduplicates subscriptions',()=>{
const result=spawnSync('/usr/bin/python3',['-'],{encoding:'utf8',input:String.raw`
import importlib.util, tempfile, pathlib, json, socket, threading, time, struct
spec=importlib.util.spec_from_file_location('relay','scripts/output-relay.py'); r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
def event(method, **params): return {'method':method,'params':{'threadId':'t','turnId':'turn',**params}}
def output(db,item):
 value=json.loads(db.execute('SELECT value FROM commands WHERE item=?',(item,)).fetchone()[0]);return (value.get('aggregatedOutput') or '')+''.join(r[0] for r in db.execute('SELECT delta FROM output_chunks WHERE item=? ORDER BY seq',(item,)))
if True:
 d=tempfile.mkdtemp(prefix="rcm-output-test-")
 r.DB=pathlib.Path(d)/'journal.sqlite'; r.UPSTREAM=pathlib.Path(d)/'engine.sock'
 db=r.database()
 start=event('item/started',item={'id':'c','type':'commandExecution','command':'echo','cwd':'/tmp','status':'inProgress'})
 r.record(db,'metadata-subscriber',start)
 # Metadata can arrive on a different subscriber before the first output.
 # The first actual output stream must own subsequent deltas.
 for owner in ('owner','duplicate'):
  r.record(db,owner,event('item/commandExecution/outputDelta',itemId='c',delta='相同\n'))
 r.record(db,'owner',event('item/commandExecution/outputDelta',itemId='c',delta='相同\n'))
 assert output(db,'c')=='相同\n相同\n'
 # A resumed subscriber can win a delivery race with a later chunk.
 with db: db.execute('INSERT INTO turn_owners VALUES (?,?)',('t','origin'))
 r.record(db,'late',event('item/started',item={'id':'origin-command','type':'commandExecution','status':'inProgress'}))
 r.record(db,'late',event('item/commandExecution/outputDelta',itemId='origin-command',delta='second\n'))
 r.record(db,'origin',event('item/commandExecution/outputDelta',itemId='origin-command',delta='first\n'))
 r.record(db,'origin',event('item/commandExecution/outputDelta',itemId='origin-command',delta='second\n'))
 assert output(db,'origin-command')=='first\nsecond\n'
 with db: db.execute('DELETE FROM turn_owners')
 # Large captures append chunks instead of rewriting the cumulative transcript.
 r.record(db,'bulk',event('item/started',item={'id':'bulk','type':'commandExecution','status':'inProgress'}))
 block='a'*16384
 for i in range(512):r.record(db,'bulk',event('item/commandExecution/outputDelta',itemId='bulk',delta=block))
 assert len(db.execute("SELECT value FROM commands WHERE item='bulk'").fetchone()[0])<1000
 assert len(output(db,'bulk'))==8*1024*1024
 r.record(db,'bulk',event('item/completed',item={'id':'bulk','type':'commandExecution','status':'completed','aggregatedOutput':'truncated','exitCode':0}))
 assert output(db,'bulk')==block*512
 # A UTF-8 character and the frame length can both cross TCP boundaries.
 parser=r.Frames(); frame=r.masked_frame(1,('中'*30000).encode()); messages=[]
 for i in range(0,len(frame),7): messages.extend(parser.feed(frame[i:i+7]))
 assert messages==[(1,('中'*30000).encode())]
 db.close()
 from concurrent.futures import ThreadPoolExecutor
 def append_many(_):
  conn=r.database()
  for i in range(20): r.record(conn,'owner',event('item/commandExecution/outputDelta',itemId='c',delta='x'))
  conn.close()
 with ThreadPoolExecutor(max_workers=4) as pool: list(pool.map(append_many,range(4)))
 db=r.database(); assert output(db,'c').endswith('x'*80);db.close()
 listener=socket.socket(socket.AF_UNIX);listener.bind(str(r.UPSTREAM));listener.listen()
 ui,proxied=socket.socketpair(); worker=threading.Thread(target=r.relay,args=(proxied,));worker.start()
 ui.sendall(b'GET / HTTP/1.1\r\nHost: localhost\r\n\r\n')
 engine,_=listener.accept();r.header(engine);engine.sendall(b'HTTP/1.1 101 Switching Protocols\r\n\r\n');r.header(ui)
 def send(e):
  data=json.dumps(e).encode(); h=bytes([129,len(data)]) if len(data)<126 else bytes([129,126])+struct.pack('!H',len(data));engine.sendall(h+data)
 send(event('item/started',item={'id':'live','type':'commandExecution','command':'loop','status':'inProgress'}))
 send(event('item/commandExecution/outputDelta',itemId='live',delta='1\n'))
 ui.recv(65536);ui.sendall(r.masked_frame(8,b''));ui.close()
 send(event('item/commandExecution/outputDelta',itemId='live',delta='2\n'))
 deadline=time.time()+3; captured=''
 while time.time()<deadline:
  db=r.database(); row=db.execute("SELECT value FROM commands WHERE item='live'").fetchone()
  captured=output(db,'live') if row else '';db.close()
  if captured=='1\n2\n': break
  time.sleep(.02)
 assert captured=='1\n2\n',captured
 send(event('item/completed',item={'id':'live','type':'commandExecution','status':'completed','aggregatedOutput':'1\n2\n','exitCode':0}))
 worker.join(3); assert not worker.is_alive()
 engine.close();listener.close()
print('journal, unicode framing, duplicate subscription and disconnected capture passed')
`});
assert.equal(result.status,0,result.stdout+result.stderr);
});

test('slow journal and slow browser cannot block the upstream reader and preserve ordered repeated chunks',()=>{
const result=spawnSync('/usr/bin/python3',['-'],{encoding:'utf8',input:String.raw`
import importlib.util,tempfile,pathlib,time,threading,json
spec=importlib.util.spec_from_file_location('relay','scripts/output-relay.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
if True:
 root=tempfile.mkdtemp(prefix="rcm-output-test-")
 r.DB=pathlib.Path(root)/'journal.sqlite'
 original=r.record
 def slow(*a,**kw):time.sleep(.001);return original(*a,**kw)
 r.record=slow
 writer=r.JournalWriter('owner');start=time.monotonic()
 for n in range(400):writer.put({'method':'item/commandExecution/outputDelta','params':{'threadId':'t','turnId':'turn','itemId':'cmd','delta':str(n)+' same😀\n'}})
 assert time.monotonic()-start<.2
 writer.close();db=r.database();output=''.join(x[0] for x in db.execute('SELECT delta FROM output_chunks ORDER BY seq'))
 assert output==''.join(str(n)+' same😀\n' for n in range(400));db.close()
 class Stalled:
  def __init__(self):self.gate=threading.Event()
  def sendall(self,data):self.gate.wait(2);raise OSError('closed')
  def shutdown(self,*args):self.gate.set()
 client=r.ClientWriter(Stalled());start=time.monotonic()
 for _ in range(1000):client.put(b'x'*8192)
 assert time.monotonic()-start<.2
 assert client.failed.is_set();client.close()
`});assert.equal(result.status,0,result.stdout+result.stderr);
});

test('terminal goal and failure journal survives cleared engine state and duplicate subscribers',()=>{
 const result=spawnSync('/usr/bin/python3',['-'],{encoding:'utf8',input:String.raw`
import importlib.util,tempfile,pathlib,json
spec=importlib.util.spec_from_file_location('relay','scripts/output-relay.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
if True:
 root=tempfile.mkdtemp(prefix="rcm-output-test-")
 r.DB=pathlib.Path(root)/'output-journal.sqlite';db=r.database()
 goal={'method':'thread/goal/updated','params':{'threadId':'t','goal':{'createdAt':123,'objective':'test','status':'complete'}}}
 failure={'method':'turn/completed','params':{'threadId':'t','turn':{'id':'failed','status':'failed'}}}
 for owner in ['before-disconnect','resumed']:
  r.record(db,owner,goal);r.record(db,owner,failure)
 r.record(db,'owner',{'method':'turn/completed','params':{'threadId':'t','turn':{'id':'ok','status':'completed'}}})
 assert db.execute('select count(*) from notification_events').fetchone()[0]==2
 db.close();db=r.database();events=[json.loads(x[0]) for x in db.execute('select event from notification_events')]
 assert events==[goal,failure];db.close()
`});assert.equal(result.status,0,result.stdout+result.stderr);
});
