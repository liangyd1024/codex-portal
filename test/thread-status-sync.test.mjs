import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {refreshThreadStatuses} from '../lib/thread-status-sync.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const m=new Manager({host:{alias:'fixture'}});m.connection={state:'connected'};
 const calls=[],events=[];m.on('event',e=>events.push(e));
 m.rpc={connected:true,request:(method,params,options)=>new Promise((resolve,reject)=>calls.push({method,params,options,resolve,reject}))};
 const add=(id,type='active')=>m.controlled.set(id,{status:{type}});
 return {m,calls,events,add};
}
test('unopened active threads reconcile from native status; idle and unowned threads are not read',async()=>{
 const f=fixture();f.add('active');f.add('idle','idle');f.add('handed');f.m.subscriptions.set('handed',{handoff:{state:'waiting'}});
 const p=refreshThreadStatuses(f.m,['active','idle','handed','desktop']);await tick();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'thread/read');assert.deepEqual(f.calls[0].params,{threadId:'active',includeTurns:false});
 f.calls[0].resolve({thread:{id:'active',status:{type:'idle'}}});await p;
 assert.equal(f.m.controlled.get('active').status.type,'idle');assert.equal(f.events.at(-1).params.controlledSessions.find(t=>t.id==='active').status.type,'idle');
});
test('failed reads remove running certainty and retry on the next existing refresh',async()=>{
 const f=fixture();f.add('a');const p=refreshThreadStatuses(f.m,['a']);await tick();f.calls[0].reject(Error('timeout'));await p;
 assert.equal(f.m.controlled.get('a').status.type,'unknown');assert.equal(f.m.controlled.get('a').statusReadError,'timeout');
 const retry=refreshThreadStatuses(f.m,['a']);await tick();f.calls[1].resolve({thread:{id:'a',status:{type:'idle'}}});await retry;
 assert.equal(f.m.controlled.get('a').status.type,'idle');assert.equal(f.m.controlled.get('a').statusReadError,null);
});
test('new notifications, connection changes, account changes and handoffs defeat late replies',async()=>{
 for(const change of ['notification','connection','account','handoff']){
  const f=fixture();f.add('a');const p=refreshThreadStatuses(f.m,['a']);await tick();
  if(change==='notification')f.m.onNotification({method:'thread/status/changed',params:{threadId:'a',status:{type:'active',activeFlags:['new']}}});
  if(change==='connection')f.m.generation++;
  if(change==='account')f.m.accountRevision=1;
  if(change==='handoff')f.m.subscriptions.set('a',{handoff:{state:'waiting'}});
  f.calls[0].resolve({thread:{id:'a',status:{type:'idle'}}});await p;assert.equal(f.m.controlled.get('a').status.type,'active');
 }
});
test('overlapping sidebar batches share requests and cap native concurrency at four',async()=>{
 const f=fixture();const ids=Array.from({length:9},(_,i)=>'thread-'+i);ids.forEach(id=>f.add(id));
 const first=refreshThreadStatuses(f.m,ids.slice(0,7)),second=refreshThreadStatuses(f.m,ids.slice(2));await tick();assert.equal(f.calls.length,4);
 for(let offset=0;offset<9;offset+=4){const batch=f.calls.slice(offset);assert.ok(batch.length<=4);batch.forEach(c=>c.resolve({thread:{id:c.params.threadId,status:{type:'idle'}}}));await tick();}
 await Promise.all([first,second]);assert.equal(f.calls.length,9);assert.equal(new Set(f.calls.map(c=>c.params.threadId)).size,9);
});
test('unsupported or malformed native state is unknown, never inferred completion',async()=>{
 const f=fixture();f.add('a');const p=refreshThreadStatuses(f.m,['a']);await tick();f.calls[0].resolve({thread:{id:'other',status:{type:'idle'}}});await p;assert.equal(f.m.controlled.get('a').status.type,'unknown');
 f.m.service.protocolValidation={unsupportedMethods:['thread/read']};await refreshThreadStatuses(f.m,['a']);assert.equal(f.calls.length,1);
});

test('sidebar activity refresh corrects an unopened thread and publishes the existing SSE status',async()=>{
 const {readSidebarActivity}=await import('../lib/sidebar.mjs');
 const f=fixture();f.add('unopened');const requests=[];
 f.m.rpc.request=async(method,params)=>{requests.push(method);return method==='account/read'?{workspaceRouting:{chatgptAccountId:'test-account'}}:{thread:{id:params.threadId,status:{type:'idle'}}};};
 f.m.passive=async(action)=>{assert.equal(action,'sidebarActivity');return {accountScope:'test-account',data:[{id:'unopened'}]};};
 const result=await readSidebarActivity(f.m,{ids:'["unopened"]'});
 assert.equal(result.data[0].id,'unopened');assert.deepEqual(requests,['account/read','thread/read']);
 assert.equal(f.events.at(-1).params.controlledSessions[0].status.type,'idle');
});
