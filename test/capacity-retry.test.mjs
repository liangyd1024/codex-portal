import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {retryCapacity} from '../lib/capacity-retry.mjs';
import {CapacityRetry,capacityFailure} from '../public/capacity-retry.js';
const failed=(id='failed',items=[])=>({id,status:'failed',error:{message:'Selected model is at capacity.',codexErrorInfo:'serverOverloaded'},items});
function fixture(){
 const m=new Manager({host:{alias:'test'}}),calls=[];m.connection.state='connected';m.service.protocolValidation={features:{capacityRetry:{supported:true}}};m.controlled.set('thread',{status:{type:'idle'}});
 m.rpc={connected:true,close(){},request:async(method,params)=>{calls.push({method,params});if(method==='thread/read')return {thread:{status:{type:'idle'}}};if(method==='thread/turns/list')return {data:[failed()]};if(method==='turn/start')return {turn:{id:'retry',status:'inProgress'}};throw Error(method);}};
 return {m,calls};
}
test('capacity retry checks latest native failure and continues with empty input once',async()=>{
 const {m,calls}=fixture();await Promise.all([retryCapacity(m,'thread',{turnId:'failed',automatic:true}),retryCapacity(m,'thread',{turnId:'failed'})]);
 const sends=calls.filter(c=>c.method==='turn/start');assert.equal(sends.length,1);assert.deepEqual(sends[0].params.input,[]);assert.equal(sends[0].params.turnTrigger,'capacity_retry_automatic');assert.equal(sends[0].params.approvalPolicy,'never');assert.equal(m.activeTurns.get('thread'),'retry');
});
test('stale turn, running thread, pending requests and changed connections never retry',async()=>{
 for(const reason of ['stale','running','pending','connection','quota']){
  const {m,calls}=fixture(),request=m.rpc.request;
  if(reason==='running')m.activeTurns.set('thread','new');
  if(reason==='pending')m.requests.set('r',{threadId:'thread'});
  m.rpc.request=async(method,p)=>{const result=await request(method,p);if(method==='thread/read'&&reason==='connection')m.generation++;if(method==='thread/turns/list'&&reason==='quota')result.data[0].error.codexErrorInfo='usageLimitExceeded';return result;};
  await assert.rejects(retryCapacity(m,'thread',{turnId:reason==='stale'?'old':'failed'}));assert.equal(calls.filter(c=>c.method==='turn/start').length,0,reason);
 }
});
test('lost native response blocks replay; failed read can be retried',async()=>{
 const {m,calls}=fixture(),request=m.rpc.request;m.rpc.request=async(method,p)=>{if(method==='turn/start'){calls.push({method});throw Error('lost');}return request(method,p);};
 for(let i=0;i<2;i++)await assert.rejects(retryCapacity(m,'thread',{turnId:'failed'}),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(calls.filter(c=>c.method==='turn/start').length,1);
 const f=fixture(),read=f.m.rpc.request;f.m.rpc.request=async()=>{throw Error('read failed');};await assert.rejects(retryCapacity(f.m,'thread',{turnId:'failed'}));f.m.rpc.request=read;await retryCapacity(f.m,'thread',{turnId:'failed'});
});
test('capacity backoff mirrors native delays and ignores other failures',()=>{
 const turns=[failed('0',[{type:'userMessage'}])];for(const delay of [10,30,120,300,null]){assert.equal(capacityFailure(turns).delay,delay);turns.push(failed(String(turns.length)));}
 assert.equal(capacityFailure([{...failed(),status:'inProgress'}]),null);assert.equal(capacityFailure([{...failed(),error:{codexErrorInfo:'usageLimitExceeded'}}]),null);
});
function ui(){let time=0,calls=0;const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},context={host:'local',id:'thread',ready:true,turns:[failed()]};const config={context:()=>context,send:async()=>{calls++;},now:()=>time,storage};const c=new CapacityRetry(config);return {c,config,context,advance:n=>{time+=n;},calls:()=>calls};}
test('countdown survives refresh; cancellation, disconnect and selection stop old timers',async()=>{
 const f=ui();f.c.tick();f.advance(5000);const restored=new CapacityRetry(f.config);assert.equal(restored.sync().seconds,5);f.advance(5000);restored.tick();restored.tick();await Promise.resolve();assert.equal(f.calls(),1);
 for(const change of ['cancel','disconnect','selection']){const f=ui();f.c.tick();if(change==='cancel')f.c.cancel();if(change==='disconnect')f.context.ready=false;if(change==='selection')f.context.id='other';f.c.sync();f.context.ready=true;f.context.id='thread';f.advance(20000);f.c.tick();assert.equal(f.calls(),0,change);}
});
test('late results cannot alter another context and network errors block repeated submission',async()=>{
 const f=ui();let done;f.config.send=()=>new Promise(r=>done=r);const c=new CapacityRetry(f.config),p=c.retry();f.context.id='other';c.sync();done();await p;assert.equal(c.sync().entry.phase,'waiting');
 const g=ui();g.config.send=async()=>{throw Error('network lost');};const d=new CapacityRetry(g.config);await d.retry();assert.equal(d.sync().entry.phase,'uncertain');await d.retry();assert.equal(d.sync().entry.phase,'uncertain');
});
test('initial loading does not permanently cancel the first countdown',()=>{
 const f=ui();f.context.ready=false;f.c.tick();f.advance(20000);f.context.ready=true;assert.equal(f.c.sync().seconds,10);assert.equal(f.c.sync().entry.phase,'waiting');
});
test('retry HTTP route requires CSRF and returns the native turn',async()=>{
 const {createApp}=await import('../server.mjs'),{m,calls}=fixture();
 const app=createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',m]])});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{const {token}=await fetch(base+'/api/csrf').then(r=>r.json());const post=csrf=>fetch(base+'/api/threads/thread/retry-capacity',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf},body:JSON.stringify({turnId:'failed'})});assert.equal((await post('')).status,403);const response=await post(token);assert.equal(response.status,200);assert.equal((await response.json()).turn.id,'retry');assert.equal(calls.filter(c=>c.method==='turn/start').length,1);}finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});
