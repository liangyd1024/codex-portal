import test from 'node:test';
import assert from 'node:assert/strict';
import {taskNotice,claimNotice} from '../public/connection-state.js';
import {WorkspaceManager as Manager} from '../src/server/services/workspace-manager.ts';
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
test('reconnect history across pages does not recreate terminal notification records',async()=>{
 const manager=new Manager({host:{alias:'test'}});manager.service={};manager.subscriptions.set('chat',{});
 const rpc={request:async(method,p)=>method==='thread/goal/get'?{goal:null}:p.cursor?{data:[{id:'stopped',status:'interrupted',completedAt:105},{id:'old',status:'completed',completedAt:90}]}:{data:[{id:'ok',status:'completed',completedAt:115},{id:'failed',status:'failed',completedAt:112},{id:'active',status:'inProgress'}],nextCursor:'next'}};
 manager.rpc=rpc;await manager.recoverNotices(rpc,'chat',100);
 assert.equal(manager.notices.size,0);
 await manager.recoverNotices(rpc,'chat',100);assert.equal(manager.notices.size,0);
});

test('server keys use stable connection ID and acknowledge legacy alias records',()=>{
 const manager=new Manager({host:{id:'local',alias:'Display name'}});manager.subscriptions.set('chat',{});
 const p=event('stable','completed');manager.publish('turn/completed',p);
 const key=taskNotice('turn/completed',p,{host:'local',known:true}).key;
 assert.ok(manager.notices.has(key));assert.deepEqual(manager.acknowledgeNotice(key),{acknowledged:true});
 const legacy=taskNotice('turn/completed',p,{host:'Old display name',known:true}).key;
 manager.notices.set(legacy,{method:'turn/completed',params:p});
 assert.deepEqual(manager.acknowledgeNotice(key),{acknowledged:true});assert.equal(manager.notices.size,0);
 assert.deepEqual(manager.acknowledgeNotice('missing'),{acknowledged:false});
});
test('failed and timed-out notifications remain retryable; shown notifications deduplicate',async()=>{
 const {deliverNotice,submitNotification}=await import('../public/notification-delivery.js');
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let calls=0;
 const send=mode=>()=>submitNotification(()=>{calls++;if(mode==='throw')throw Error('denied');const n={};if(mode!=='timeout')queueMicrotask(()=>n[mode==='show'?'onshow':'onerror']());return n;},{timeoutMs:5});
 for(const mode of ['throw','error','timeout']){assert.equal(await deliverNotice(storage,'key',send(mode)),false);assert.equal(values.size,0);}
 assert.equal(await deliverNotice(storage,'key',send('show')),true);assert.equal(calls,4);
 assert.equal(await deliverNotice(storage,'key',send('show')),true);assert.equal(calls,4);
});

test('iOS browser explains Home Screen requirement, installed app uses worker',async()=>{
 const {notificationSupport}=await import('../public/notification-platform.js');
 const env={navigator:{userAgent:'iPhone',serviceWorker:{}},isSecureContext:true};
 assert.match(notificationSupport(env).message,/添加到主屏幕/);
 env.navigator.standalone=true;env.Notification={permission:'default'};
 assert.deepEqual(notificationSupport(env),{supported:true,worker:true});
 env.navigator={userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5};
 assert.match(notificationSupport(env).message,/添加到主屏幕/);
 env.isSecureContext=false;assert.match(notificationSupport(env).message,/HTTPS/);
 env.isSecureContext=true;env.navigator={userAgent:'Desktop'};delete env.Notification;
 assert.equal(notificationSupport(env).supported,false);
 env.Notification={};assert.deepEqual(notificationSupport(env),{supported:true,worker:false});
});
test('worker rejection remains retryable; API acceptance allows deduplication',async()=>{
 const {submitWorkerNotification}=await import('../public/notification-platform.js');
 const {deliverNotice}=await import('../public/notification-delivery.js');
 const entries=new Map(),storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};
 let fail=true,calls=0;
 const registration={showNotification:async(title,options)=>{calls++;assert.equal(options.data.host,'local');if(fail)throw Error('blocked');}};
 const send=()=>submitWorkerNotification(registration,'test',{data:{host:'local'}});
 assert.equal(await deliverNotice(storage,'worker',send),false);assert.equal(entries.size,0);
 fail=false;assert.equal(await deliverNotice(storage,'worker',send),true);
 assert.equal(await deliverNotice(storage,'worker',send),true);assert.equal(calls,2);
});
test('async question notifications retain native identity and deduplicate replay across tabs',()=>{
 const r={id:'async:question',kind:'asyncQuestion',threadId:'chat',params:{threadId:'chat',turnId:'turn',itemId:'question'}};
 const n=taskNotice('manager/request',r,context);assert.equal(n.label,'需要你回答');assert.equal(n.urgent,true);
 assert.equal(taskNotice('manager/request',{request:r},context).key,n.key);
 assert.notEqual(taskNotice('manager/request',{...r,params:{...r.params,itemId:'second'}},context).key,n.key);
});

test('desktop browsers with service workers use persistent system notification delivery',()=>{
 const env={navigator:{userAgent:'Macintosh Chrome',serviceWorker:{}},isSecureContext:true,Notification:{permission:'granted'}};
 return import('../public/notification-platform.js').then(({notificationSupport})=>assert.deepEqual(notificationSupport(env),{supported:true,worker:true}));
});
test('recovered completion events are distinguished from live native completions',async()=>{
 const m=new Manager({host:{id:'local'}}),events=[];m.subscriptions.set('chat',{});m.on('event',e=>events.push(e));
 const rpc={request:async method=>method==='thread/goal/get'?{goal:null}:{data:[{id:'old',status:'completed',completedAt:110}]}};m.rpc=rpc;
 await m.recoverNotices(rpc,'chat',100);assert.equal(events.some(e=>e.method==='turn/completed'),false);
 m.onNotification({method:'turn/completed',params:event('new','completed')});assert.equal(events.at(-1).replayed,undefined);
});

// Retained from the older suite: typed IDs and reconnect identity are distinct contracts.
test('approval and question keys preserve typed IDs, tool identity and host isolation',()=>{
 const request={id:7,kind:'question',params:{threadId:'chat'}};
 const notice=(r,host='one')=>taskNotice('manager/request',r,{host,known:true});
 assert.equal(notice(request).label,'需要你回答');
 assert.equal(notice(request).urgent,true);
 assert.notEqual(notice(request).key,notice({...request,id:'7'}).key);
 assert.notEqual(notice(request).key,notice(request,'two').key);
 const tool={...request,method:'item/tool/requestUserInput',params:{...request.params,turnId:'turn',itemId:'tool'}};
 assert.equal(notice(tool).key,notice({...tool,id:99}).key);
 assert.notEqual(notice(tool).key,notice({...tool,params:{...tool.params,itemId:'other'}}).key);
});
