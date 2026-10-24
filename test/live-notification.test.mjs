import {authRecoveryMessage} from '../shared/account-state.js';
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {taskNotice} from '../shared/connection-state.js';import {deliverNotice} from '../public/notification-delivery.js';
import ts from 'typescript';
const typed=readFileSync(new URL('../src/web/services/task-notifications.ts',import.meta.url),'utf8');
const output=ts.transpileModule(typed,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createTaskNotifications}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(success=true){
 const values=new Map([['rcm.taskNotifications.local','true']]),sent=[],acks=[];let lock=Promise.resolve();
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const c=vm.createContext({createTaskNotifications,sideChat:null,authRecoveryMessage,taskNotificationsEnabled:true,window:{Notification:{}},Notification:{permission:'granted'},targetHost:'local',state:{threads:[{id:'a'}],status:{},selectedId:null,detail:null},currentThread:()=>null,threadName:()=> 'test',taskNotice,deliverNotice,localStorage:storage,navigator:{locks:{request:(_key,work)=>{const next=lock.then(work);lock=next.catch(()=>{});return next;}}},sendTaskNotification:async(...args)=>{sent.push(args);return success;},api:async(path,options)=>acks.push({path,options}),notificationDiagnostic(){},recordError(){},scheduleListRefresh(){}});
 c.notificationPreferences={enabled:()=>c.taskNotificationsEnabled};
 vm.runInContext(source.slice(source.indexOf('const notifyTaskEvent=createTaskNotifications'),source.indexOf('async function connectRemote()'))+'\nglobalThis.notifyTaskEvent=notifyTaskEvent;',c);
 vm.runInContext(source.slice(source.indexOf('function handleEvent('),source.indexOf('function setupEvents()')),c);
 return {c,sent,acks,values,emit:(id)=>c.notifyTaskEvent('turn/completed',{threadId:'a',turn:{id,status:'completed'}})};
}
test('fresh completion submits once across overlapping events and confirms only successful submission',async()=>{
 const f=fixture();await Promise.all([f.emit('one'),f.emit('one')]);assert.equal(f.sent.length,1);assert.ok(f.acks.length);await f.emit('two');assert.equal(f.sent.length,2);
});
test('failed delivery is not automatically repeated or acknowledged, but a new completion can submit',async()=>{
 const f=fixture(false);await f.emit('one');await f.emit('one');assert.equal(f.sent.length,1);assert.equal(f.acks.length,0);await f.emit('two');assert.equal(f.sent.length,2);
});
test('persisted disabled preference blocks a stale enabled tab; denied permission blocks submission',async()=>{
 const f=fixture();f.values.set('rcm.taskNotifications.local','false');await f.emit('disabled');assert.equal(f.sent.length,0);f.values.set('rcm.taskNotifications.local','true');f.c.Notification.permission='denied';await f.emit('denied');assert.equal(f.sent.length,0);
});
test('SSE backlog and reconstructed history never notify, while new live completion does',async()=>{
 const f=fixture(),params={threadId:'a',turn:{id:'old',status:'completed'}};
 f.c.handleEvent({data:JSON.stringify({method:'manager/taskNotice',params:{key:'old',event:{method:'turn/completed',params}}})});
 f.c.handleEvent({data:JSON.stringify({method:'turn/completed',params,replayed:true})});await new Promise(r=>setImmediate(r));assert.equal(f.sent.length,0);
 f.c.handleEvent({data:JSON.stringify({method:'turn/completed',params:{...params,turn:{...params.turn,id:'new'}}})});await new Promise(r=>setImmediate(r));assert.equal(f.sent.length,1);
});

test('connection changes while waiting for the notification lock prevent delivery',async()=>{
 const f=fixture();let release;
 f.c.navigator.locks.request=(_key,work)=>new Promise(resolve=>{release=()=>resolve(work());});
 const pending=f.emit('waiting');f.c.targetHost='remote';release();assert.equal(await pending,false);assert.equal(f.sent.length,0);assert.equal(f.acks.length,0);
});
test('connection changes during delivery retain the old claim but never acknowledge on the new connection',async()=>{
 const f=fixture();let release;
 f.c.sendTaskNotification=(...args)=>{f.sent.push(args);return new Promise(resolve=>{release=resolve;});};
 const pending=f.emit('late');await new Promise(resolve=>setImmediate(resolve));f.c.targetHost='remote';release(true);
 assert.equal(await pending,true);assert.equal(f.sent.length,1);assert.equal(f.sent[0].at(-1),'local');assert.equal(f.acks.length,0);
 f.c.targetHost='local';assert.equal(await f.emit('late'),true);assert.equal(f.sent.length,1);assert.equal(f.acks.length,1);
});
test('failed-attempt eviction keeps the original 1000-key limit and permits the oldest key again',async()=>{
 const f=fixture(false);for(let i=0;i<1001;i++)await f.emit('turn-'+i);
 await f.emit('turn-1000');assert.equal(f.sent.length,1001);
 await f.emit('turn-0');assert.equal(f.sent.length,1002);assert.equal(f.acks.length,0);
});

test('opening SSE never transmits stored historical task notifications',async()=>{
 const {EventEmitter}=await import('node:events'),{createApp}=await import('../server.mjs');
 const m=Object.assign(new EventEmitter(),{host:{id:'local',alias:'test'},connection:{state:'disconnected'},status:()=>({pendingRequests:[]}),disconnect(){},replayNotices:()=>[{method:'manager/taskNotice',params:{key:'old'}}]});
 const {server}=createApp({config:{machineId:'test',defaultConnection:'local',connections:[]},managers:new Map([['local',m]])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const controller=new AbortController();
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/events',{signal:controller.signal});const {value}=await response.body.getReader().read();const text=new TextDecoder().decode(value);assert.match(text,/manager\/status/);assert.doesNotMatch(text,/manager\/taskNotice|old/);}finally{controller.abort();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
