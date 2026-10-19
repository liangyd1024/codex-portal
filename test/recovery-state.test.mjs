import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Manager} from '../lib/manager.mjs';
import {notifyManagerError,recoveryMessage,selectedRecoveryMessage} from '../public/recovery-state.js';

function fixture(){
  const host={alias:'test',user:'tester',home:'/test'};
  const rpc=new EventEmitter();rpc.connected=true;rpc.connect=async()=>({});rpc.close=()=>{rpc.connected=false;};
  const failures=new Set(['missing-a','missing-b']),resumed=[];
  rpc.request=async(method,p)=>{
    if(method==='thread/goal/get')return {goal:null};
    if(method==='thread/resume'){
      resumed.push(p.threadId);
      if(failures.has(p.threadId))throw Error('no rollout found for thread id '+p.threadId);
      return {thread:{id:p.threadId,status:{type:'idle'}}};
    }
    throw Error('Unexpected RPC '+method);
  };
  const child=new EventEmitter();child.kill=()=>{};
  const m=new Manager({host,identity:async()=>host,rpcFactory:()=>rpc,tunnelFactory:async()=>({url:'test',child})});
  m.serviceAction=async action=>action==='projects'?{data:[]}:{pid:1,version:'test',startedAt:'test'};
  m.fetchAllModels=async()=>[];m.recoverNotices=async()=>{};m.handoffs.start=()=>{};
  for(const id of ['missing-a','good','missing-b'])m.subscriptions.set(id,{since:123});
  const events=[];m.on('event',e=>events.push(e));
  return {m,rpc,failures,resumed,events};
}
test('recovery failures retain checkpoints and diagnostics, continue healthy threads, and produce no per-thread alerts',async()=>{
  const {m,events,resumed}=fixture();await m.connect();
  assert.deepEqual(resumed,['missing-a','good','missing-b']);
  const s=m.status();assert.equal(s.connection.state,'connected');assert.deepEqual(s.controlledThreads,['good']);
  assert.equal(s.recoveryFailures.length,2);assert.equal(m.subscriptions.get('missing-a').since,123);
  const errors=events.filter(e=>e.method==='manager/error').map(e=>e.params);
  assert.equal(errors.length,2);assert.ok(errors.every(e=>!notifyManagerError(e)));
  assert.match(s.errors[0].message,/no rollout found/);
  assert.match(recoveryMessage(s.recoveryFailures),/2 个会话/);
  assert.deepEqual(events.at(-1).params.recoveryFailures,s.recoveryFailures);
});
test('successful explicit recovery clears only that thread, and reconnect clears resolved failures',async()=>{
  const {m,failures}=fixture();await m.connect();
  m.rememberControl({thread:{id:'missing-a',status:{type:'idle'}}},{explicit:true});
  assert.deepEqual(m.status().recoveryFailures.map(e=>e.threadId),['missing-b']);
  failures.clear();m.connection.state='disconnected';await m.connect();
  assert.deepEqual(m.status().recoveryFailures,[]);
});
test('legacy recovery events are quiet, while user actions and other errors stay visible',()=>{
  assert.equal(notifyManagerError({stage:'恢复会话订阅：old',message:'no rollout found'}),false);
  assert.equal(notifyManagerError({stage:'takeover',message:'no rollout found'}),true);
  assert.equal(notifyManagerError({stage:'协议连接',message:'Permission denied'}),true);
});
test('cancelled recovery does not install a stale failure in the current connection',async()=>{
  const {m,rpc}=fixture();rpc.request=async()=>{m.generation++;throw Error('cancelled');};
  await assert.rejects(m.connect(),/cancelled/);
  assert.deepEqual(m.status().recoveryFailures,[]);
});

test('historical recovery failures only warn for the selected affected thread',()=>{
  const failures=[{threadId:'missing',message:'no rollout found for thread id missing'},{threadId:'timeout',message:'RPC timeout'}];
  assert.equal(selectedRecoveryMessage(failures,'healthy'),'');
  assert.equal(selectedRecoveryMessage(failures,null),'');
  assert.match(selectedRecoveryMessage(failures,'missing'),/找不到.*历史记录/);
  assert.match(selectedRecoveryMessage(failures,'timeout'),/可重试接管/);
  assert.equal(selectedRecoveryMessage([],'missing'),'');
  assert.match(recoveryMessage(failures),/上次连接恢复.*不代表当前连接中断/);
});

test('clearing diagnostic history preserves live state and subscriptions; future failures are recorded again',async()=>{
  const {m,events}=fixture();await m.connect();
  const before=m.status(),subscriptions=[...m.subscriptions];
  const cleared=m.clearDiagnosticHistory();
  assert.deepEqual(cleared.errors,[]);
  assert.deepEqual(cleared.recoveryFailures,[]);
  assert.deepEqual(cleared.connection,before.connection);
  assert.deepEqual(cleared.controlledSessions,before.controlledSessions);
  assert.deepEqual([...m.subscriptions],subscriptions);
  assert.equal(events.at(-1).method,'manager/status');
  assert.deepEqual(events.at(-1).params.errors,[]);
  m.record(new Error('new failure'),'test');
  assert.equal(m.status().errors[0].message,'new failure');
  m.connection.state='disconnected';await m.connect();
  assert.equal(m.status().recoveryFailures.length,2);
});

test('diagnostic clearing requires CSRF, matching Origin and only clears the selected connection',async()=>{
  const {createApp}=await import('../server.mjs');
  const first=fixture(),second=fixture();
  first.m.restoreOnStart=false;second.m.restoreOnStart=false;
  first.m.record(new Error('first'));second.m.record(new Error('second'));
  const {server}=createApp({config:{defaultConnection:'one',connections:[]},managers:new Map([['one',first.m],['two',second.m]])});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const route=base+'/api/diagnostics/clear?host=two';
    assert.equal((await fetch(route,{method:'POST',body:'{}'})).status,403);
    const {token}=await fetch(base+'/api/csrf').then(r=>r.json());
    const options={method:'POST',headers:{'x-csrf-token':token},body:'{}'};
    assert.equal((await fetch(route,{...options,headers:{...options.headers,origin:'https://wrong.example'}})).status,403);
    assert.equal(second.m.errors.length,1);
    const response=await fetch(route,options);
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).errors,[]);
    assert.equal(first.m.errors.length,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
