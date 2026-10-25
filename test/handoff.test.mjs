import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Manager} from '../lib/manager.mjs';
import {createApp} from '../server.mjs';
import {handoffMessage} from '../public/thread-handoff.js';

class Engine extends EventEmitter {
  constructor(){super();this.connected=true;this.calls=[];this.loaded=new Set(['a','b']);this.overrides={};}
  async request(method,params={}) {
    this.calls.push({method,params});
    if(this.overrides[method])return this.overrides[method](params);
    switch(method){
      case 'thread/loaded/list':return {data:[...this.loaded],nextCursor:null};
      case 'thread/read':return {thread:{id:params.threadId,status:{type:params.threadId==='b'?'active':'idle'}}};
      case 'thread/goal/get':return {goal:null};
      case 'thread/backgroundTerminals/list':case 'thread/queue/list':return {data:[],nextCursor:null};
      case 'thread/unsubscribe':return {status:'unsubscribed'};
      case 'thread/resume':return {thread:{id:params.threadId,status:{type:'idle'}}};
      case 'turn/steer':return {turnId:'b-turn'};
      case 'turn/start':return {turn:{id:params.threadId+'-turn',status:'inProgress'}};
      default:throw Error('Unexpected RPC: '+method);
    }
  }
  async connect(){this.connected=true;return {};}
  close(){this.connected=false;}
}
function fixture(options={}) {
  const rpc=new Engine();
  const manager=new Manager({host:{alias:'测试',user:'tester',home:'/test'},...options});
  manager.rpc=rpc;manager.connection={state:'connected'};
  manager.service={running:true,protocolValidation:{features:{handoff:{supported:true}}}};
  manager.rememberControl({thread:{id:'a',status:{type:'idle'}}});
  manager.rememberControl({thread:{id:'b',status:{type:'active'}}});manager.activeTurns.set('b','b-turn');
  manager.serviceAction=async()=>{throw Error('Must not stop or restart any service');};
  manager.detail=async id=>({thread:{id},controlled:manager.controlled.has(id)});
  return {m:manager,rpc};
}

test('unsubscribe waits for unload; another active thread keeps control and can be steered',async()=>{
  const {m,rpc}=fixture();
  try{
    const result=await m.handoff('a');assert.equal(result.state,'waiting');
    assert.equal(m.controlled.has('a'),false);assert.equal(m.controlled.has('b'),true);
    assert.equal(m.activeTurns.get('b'),'b-turn');assert.deepEqual(m.status().subscribedThreads,['b']);
    assert.equal(m.rememberControl({thread:{id:'a',status:{type:'idle'}}}),false);
    await m.steer('b',{text:'继续测试'});
    assert.equal(rpc.calls.filter(c=>c.method==='thread/unsubscribe').length,1);
    assert.ok(!rpc.calls.some(c=>/interrupt|terminate|archive|delete/.test(c.method)));
    assert.ok(!rpc.calls.some(c=>c.params.threadId==='b'&&c.method!=='turn/steer'));
    rpc.loaded.delete('a');await m.handoffs.refresh();assert.equal(m.subscriptions.get('a').handoff.state,'released');
    assert.equal(m.controlled.has('b'),true);
  }finally{m.disconnect();}
});

test('all blockers reject before unsubscribe and preserve the original subscription',async t=>{
  const cases={
    running:({m})=>m.activeTurns.set('a','a-turn'),
    sending:({m})=>m.startingTurns.add('a'),
    approval:({m})=>m.requests.set('approval',{threadId:'a'}),
    asyncQuestion:({m})=>m.pendingQuestions.entries.set('question',{threadId:'a'}),
    mutation:({m})=>m.threadMutations.set('a',1),
    active:({rpc})=>rpc.overrides['thread/read']=()=>({thread:{status:{type:'active'}}}),
    goal:({rpc})=>rpc.overrides['thread/goal/get']=()=>({goal:{status:'active'}}),
    command:({rpc})=>rpc.overrides['thread/backgroundTerminals/list']=()=>({data:[{processId:'p'}]}),
    queue:({rpc})=>rpc.overrides['thread/queue/list']=()=>({data:[],nextCursor:'more'}),
    unknown:({rpc})=>rpc.overrides['thread/read']=()=>({thread:{status:{type:'unknown'}}}),
    malformed:({rpc})=>rpc.overrides['thread/queue/list']=()=>({}),
    failedRead:({rpc})=>rpc.overrides['thread/goal/get']=()=>{throw Error('unavailable');},
    unsupported:({m})=>m.service.protocolValidation.features.handoff.supported=false,
  };
  for(const [name,arrange] of Object.entries(cases))await t.test(name,async()=>{
    const f=fixture();arrange(f);const original=f.m.subscriptions.get('a');
    try{await assert.rejects(f.m.handoff('a'));assert.equal(f.m.subscriptions.get('a'),original);assert.equal(f.m.controlled.has('a'),true);assert.ok(!f.rpc.calls.some(c=>c.method==='thread/unsubscribe'));}
    finally{f.m.disconnect();}
  });
});

test('an unload notification confirms release, while notSubscribed alone does not',async()=>{
  const {m,rpc}=fixture();rpc.overrides['thread/unsubscribe']=()=>({status:'notSubscribed'});
  try{assert.equal((await m.handoff('a')).state,'waiting');m.onNotification({method:'thread/closed',params:{threadId:'a'}});assert.equal(m.subscriptions.get('a').handoff.state,'released');}
  finally{m.disconnect();}
});

test('handoff history is passive and a failed release-state save cannot disrupt other threads',async()=>{
  const {m,rpc}=fixture();
  try{
    await m.handoff('a');rpc.calls.length=0;delete m.detail;
    m.passive=async action=>action==='detail'?{thread:{id:'a'}}:{data:[],historySource:'snapshot'};
    assert.equal((await m.detail('a')).handoff.state,'waiting');assert.deepEqual(rpc.calls,[]);
    m.saveSubscriptions=()=>{throw Error('disk full');};
    assert.doesNotThrow(()=>m.onNotification({method:'thread/closed',params:{threadId:'a'}}));
    assert.equal(m.subscriptions.get('a').handoff.state,'waiting');assert.equal(m.controlled.has('b'),true);
    await m.steer('b',{text:'继续'});
  }finally{m.disconnect();}
});

test('duplicate handoff and same-thread mutations are blocked without blocking another thread',async()=>{
  const {m,rpc}=fixture();let resolve;
  rpc.overrides['thread/loaded/list']=()=>new Promise(r=>resolve=r);
  const pending=m.handoff('a');
  try{
    await assert.rejects(m.handoff('a'),e=>e.code==='HANDOFF_PENDING');
    await assert.rejects(m.takeover('a'),e=>e.code==='HANDOFF_PENDING');
    await assert.rejects(m.message('a',{text:'unexpected'}),e=>e.code==='HANDOFF_PENDING');
    await m.steer('b',{text:'继续'});
    delete rpc.overrides['thread/loaded/list'];resolve({data:['a','b']});await pending;
  }finally{m.disconnect();}
});

test('connection change during preflight cannot unsubscribe or claim success',async()=>{
  const {m,rpc}=fixture();rpc.overrides['thread/goal/get']=()=>{m.generation++;return {goal:null};};
  try{await assert.rejects(m.handoff('a'),e=>e.code==='CONNECTION_CHANGED');assert.ok(!rpc.calls.some(c=>c.method==='thread/unsubscribe'));assert.equal(m.controlled.has('a'),true);}
  finally{m.disconnect();}
});

test('persistence failure refuses unsubscribe and retains control',async()=>{
  const {m,rpc}=fixture();m.saveSubscriptions=()=>{throw Error('disk full');};
  try{await assert.rejects(m.handoff('a'),/disk full/);assert.ok(!m.subscriptions.get('a').handoff);assert.equal(m.controlled.has('a'),true);assert.ok(!rpc.calls.some(c=>c.method==='thread/unsubscribe'));}
  finally{m.disconnect();}
});

test('lost response persists non-resumption across a new Manager and reconnect',async(t)=>{
  const root=mkdtempSync(path.join(tmpdir(),'rcm-handoff-test-'));t.diagnostic('保留测试目录：'+root);
  const titleStore=path.join(root,'web-titles-test.json'),{m,rpc}=fixture({titleStore});
  rpc.overrides['thread/unsubscribe']=()=>{throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});};
  try{
    await assert.rejects(m.handoff('a'),e=>e.code==='HANDOFF_UNCONFIRMED');assert.equal(m.subscriptions.get('a').handoff.state,'unknown');
    assert.deepEqual(JSON.parse(readFileSync(m.subscriptionStore,'utf8')).map(([id])=>id),['b']);
    assert.equal(JSON.parse(readFileSync(m.handoffStore,'utf8'))[0][0],'a');
  }
  finally{m.disconnect();}
  const next=new Engine(),tunnel={child:Object.assign(new EventEmitter(),{kill(){}}),url:'ws://test'};
  const restored=new Manager({titleStore,host:{alias:'测试',user:'tester',home:'/test'},rpcFactory:()=>next,identity:async()=>({user:'tester',home:'/test'}),tunnelFactory:async()=>tunnel});
  restored.serviceAction=async action=>action==='projects'?{data:[]}:{pid:1,startedAt:1,version:'test'};
  restored.fetchAllModels=async()=>[];restored.recoverNotices=async()=>{};
  try{await restored.connect();assert.equal(restored.controlled.has('a'),false);assert.equal(restored.controlled.has('b'),true);assert.deepEqual(next.calls.filter(c=>c.method==='thread/resume').map(c=>c.params.threadId),['b']);}
  finally{restored.disconnect();}
});

test('explicit takeover restores control and a late release poll cannot undo it',async()=>{
  const {m,rpc}=fixture();
  try{
    await m.handoff('a');let resolve;rpc.overrides['thread/loaded/list']=()=>new Promise(r=>resolve=r);
    const poll=m.handoffs.refresh();await m.takeover('a');resolve({data:['b']});await poll;
    assert.equal(m.controlled.has('a'),true);assert.equal(m.subscriptions.get('a').handoff,undefined);
  }finally{m.disconnect();}
});

test('all loaded pages must be read before confirming release',async()=>{
  const {m,rpc}=fixture();rpc.overrides['thread/loaded/list']=p=>p.cursor?{data:['a'],nextCursor:null}:{data:['b'],nextCursor:'second'};
  try{assert.equal((await m.handoff('a')).state,'waiting');assert.ok(rpc.calls.some(c=>c.method==='thread/loaded/list'&&c.params.cursor==='second'));}
  finally{m.disconnect();}
});

test('an already unloaded thread is released without an unsubscribe mutation',async()=>{
  const {m,rpc}=fixture();rpc.loaded.delete('a');
  try{assert.equal((await m.handoff('a')).state,'released');assert.ok(!rpc.calls.some(c=>c.method==='thread/unsubscribe'));}
  finally{m.disconnect();}
});

test('HTTP handoff uses the selected host and requires CSRF and matching Origin',async()=>{
  const f=fixture(),second=fixture();const {server}=await createApp({config:{machineId:'test',defaultConnection:'one'},managers:new Map([['one',f.m],['two',second.m]])});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(base+'/api/threads/a/handoff?host=two',{method:'POST',body:'{}'})).status,403);
    const {token}=await fetch(base+'/api/csrf').then(r=>r.json());const options={method:'POST',headers:{'x-csrf-token':token},body:'{}'};
    assert.equal((await fetch(base+'/api/threads/a/handoff?host=two',{...options,headers:{...options.headers,origin:'https://wrong.example'}})).status,403);
    assert.equal((await fetch(base+'/api/threads/a/handoff?host=missing',options)).status,404);
    const result=await fetch(base+'/api/threads/a/handoff?host=two',options);assert.equal(result.status,200);assert.equal((await result.json()).state,'waiting');
    assert.equal(f.rpc.calls.filter(c=>c.method==='thread/unsubscribe').length,0);assert.equal(second.rpc.calls.filter(c=>c.method==='thread/unsubscribe').length,1);
  }finally{f.m.disconnect();second.m.disconnect();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('waiting, disconnected and unconfirmed messages never claim a successful release',()=>{
  for(const state of ['waiting','unknown','checking'])assert.doesNotMatch(handoffMessage({state},true),/可在桌面端点击/);
  assert.match(handoffMessage({state:'waiting'},false),/状态待确认/);
  assert.match(handoffMessage({state:'released'},true),/草稿保留/);
});
test('waiting message uses confirmed runtime delay instead of a fixed 30-minute claim',async()=>{
 const {m}=fixture();m.service.threadUnloadDelaySecs=5;
 try{const result=await m.handoff('a');assert.equal(result.unloadDelaySecs,5);assert.match(handoffMessage(result,true),/5 秒/);assert.doesNotMatch(handoffMessage(result,true),/30 分钟/);}
 finally{m.disconnect();}
});
