import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {RpcClient} from '../lib/rpc-client.mjs';
import {readSidebar} from '../lib/sidebar.mjs';
import {readLiveStatus} from '../lib/status-read.mjs';
import {backgroundActivity} from '../public/connection-state.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const statusResult=method=>method==='thread/goal/get'?{goal:null}:method==='account/read'?{workspaceRouting:{chatgptAccountId:'account'}}:{data:[],nextCursor:null};
function fixture(rpc) {
  const m=new Manager({host:{alias:'test'}});m.connection.state='connected';m.rpc=rpc;
  m.controlled.set('a',{status:{type:'idle'}});
  m.readThreadMetadata=async id=>({thread:{id}});
  m.history=async()=>({data:[{id:'turn',status:'completed',items:[]}],historySource:'snapshot'});
  m.passive=async()=>({data:[],projects:[],sections:[],accountLayoutAvailable:true});
  return m;
}
class SlowSocket extends EventTarget {
  readyState=1;
  delay=6000;
  send(raw) {
    const request=JSON.parse(raw);if(!request.id)return;
    const result=request.method==='initialize'?{}:statusResult(request.method);
    const reply=()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:request.id,result})}));
    if(request.method==='initialize')queueMicrotask(reply);else setTimeout(reply,this.delay);
  }
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}
test('six-second goal, queue, process and account replies succeed instead of reporting false timeouts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const rpc=new RpcClient({WebSocketImpl:SlowSocket});await rpc.connect('ws://test');
  try{
    const m=fixture(rpc),detail=m.detail('a'),sidebar=readSidebar(m);
    await settle();t.mock.timers.tick(6000);
    const d=await detail;await sidebar;
    assert.equal(d.goalError,null);assert.equal(d.queue.error,undefined);assert.equal(d.backgroundTerminals.error,undefined);
    assert.equal(backgroundActivity(d,{controlled:true,connected:true}).state,'idle');
    assert.equal(m.sidebarAccountId,'account');assert.equal(m.errors.length,0);
  }finally{rpc.close();}
});
test('overlapping pages share status reads without caching the next refresh or another thread',async()=>{
  const wait=deferred(),calls=[];
  const m=fixture({connected:true,request:async(method,params)=>{calls.push([method,params.threadId]);await wait.promise;return statusResult(method);}});
  const a=m.detail('a'),duplicate=m.detail('a');m.controlled.set('b',{status:{type:'idle'}});const b=m.detail('b');
  const sidebar=readSidebar(m),otherSidebar=readSidebar(m);
  await settle();assert.equal(calls.length,7);
  for(const method of ['thread/goal/get','thread/queue/list','thread/backgroundTerminals/list']){
    assert.equal(calls.filter(([name,id])=>name===method&&id==='a').length,1);
    assert.equal(calls.filter(([name,id])=>name===method&&id==='b').length,1);
  }
  wait.resolve();await Promise.all([a,duplicate,b,sidebar,otherSidebar]);
  await m.detail('a');await readSidebar(m);assert.equal(calls.length,11);
});
test('a real deadline remains unknown, then a later successful read clears all status errors',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  class StalledSocket extends SlowSocket {send(raw){if(JSON.parse(raw).method==='initialize')super.send(raw);}}
  const rpc=new RpcClient({WebSocketImpl:StalledSocket});await rpc.connect('ws://test');
  try{
    const m=fixture(rpc),detail=m.detail('a');
    const accountFailure=assert.rejects(readSidebar(m),e=>e.code==='RPC_TIMEOUT');
    await settle();t.mock.timers.tick(30000);
    const failed=await detail;await accountFailure;
    for(const error of [failed.goalError,failed.queue.error,failed.backgroundTerminals.error])assert.match(error,/timed out/);
    assert.equal(backgroundActivity(failed,{controlled:true,connected:true}).state,'unknown');
    assert.equal(failed.turns[0].id,'turn');assert.equal(m.errors.length,0);
    rpc.request=async method=>statusResult(method);
    const recovered=await m.detail('a');await readSidebar(m);
    assert.equal(recovered.goalError,null);assert.equal(recovered.queue.error,undefined);
    assert.equal(backgroundActivity(recovered,{controlled:true,connected:true}).state,'idle');
  }finally{rpc.close();}
});
test('late status and history from an old connection cannot appear as the new connection state',async()=>{
  for(const disconnected of [false,true]){
    const wait=deferred();const m=fixture({connected:true,request:async method=>{await wait.promise;return statusResult(method);}});
    const detailFailure=assert.rejects(m.detail('a'),e=>e.code===(disconnected?'DISCONNECTED':'CONNECTION_CHANGED'));
    const accountFailure=assert.rejects(readSidebar(m),e=>e.code===(disconnected?'DISCONNECTED':'CONNECTION_CHANGED'));
    await settle();m.generation++;
    if(disconnected)m.connection.state='disconnected';
    else m.rpc={connected:true,request:async method=>statusResult(method)};
    wait.resolve();await Promise.all([detailFailure,accountFailure]);
    assert.equal(m.controlled.get('a').lastTurnStatus,undefined);
    if(!disconnected)assert.equal((await m.detail('a')).goalError,null);
  }
});
test('preview and passive browsing do not read live state; writes cannot enter the coalescer',async()=>{
  let calls=0;const m=fixture({connected:true,request:async()=>{calls++;throw Error('unexpected RPC');}});
  await m.detail('a',{},true);await m.detail('a',{},false,null,true);await m.detail('uncontrolled');
  await assert.rejects(readLiveStatus(m,'turn/start'),/Unsupported status read/);assert.equal(calls,0);
});
