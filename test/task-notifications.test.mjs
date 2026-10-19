import test from 'node:test';
import assert from 'node:assert/strict';
import {taskNotice,claimNotice} from '../public/connection-state.js';
import {Manager} from '../lib/manager.mjs';
const context={host:'test',known:true};
const event=(id,status)=>({threadId:'chat',turn:{id,status,completedAt:110}});
test('every terminal turn notifies once, with independent sessions and turns',()=>{
 const entries=new Map(),storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};
 for(const status of ['completed','failed','interrupted']){
  const notice=taskNotice('turn/completed',event(status,status),context);
  assert.ok(notice);assert.equal(claimNotice(storage,notice.key),true);assert.equal(claimNotice(storage,notice.key),false);
  assert.equal(claimNotice(storage,taskNotice('turn/completed',{...event(status,status),threadId:'other'},context).key),true);
 }
 assert.equal(taskNotice('turn/completed',event('running','inProgress'),context),null);
 assert.equal(taskNotice('turn/completed',event('unknown','completed'),{...context,known:false}),null);
 assert.equal(taskNotice('turn/completed',{threadId:'chat',turn:{status:'completed'}},context),null);
});
test('goal completion does not duplicate terminal turn; blockers still notify',()=>{
 assert.equal(taskNotice('thread/goal/updated',{threadId:'chat',goal:{createdAt:1,status:'complete'}},context),null);
 assert.ok(taskNotice('thread/goal/updated',{threadId:'chat',goal:{createdAt:1,status:'blocked'}},context));
});
test('reconnect recovers all recent terminal turns across pages, excluding old and active turns',async()=>{
 const manager=new Manager({host:{alias:'test'}});manager.service={};manager.subscriptions.set('chat',{});
 const rpc={request:async(method,p)=>method==='thread/goal/get'?{goal:null}:p.cursor?{data:[{id:'stopped',status:'interrupted',completedAt:105},{id:'old',status:'completed',completedAt:90}]}:{data:[{id:'ok',status:'completed',completedAt:115},{id:'failed',status:'failed',completedAt:112},{id:'active',status:'inProgress'}],nextCursor:'next'}};
 manager.rpc=rpc;await manager.recoverNotices(rpc,'chat',100);
 assert.deepEqual([...manager.notices.values()].map(e=>e.params.turn.id),['ok','failed','stopped']);
 await manager.recoverNotices(rpc,'chat',100);assert.equal(manager.notices.size,3);
});
