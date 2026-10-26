import {notificationLink,pendingNotificationTarget,saveNotificationTarget,consumeNotificationTarget} from '../src/web/services/notification-target.ts';
import {notificationPayload} from '../lib/web-push.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {threadSourceIcon} from '../public/activity.js';
function clickStorage(){let saved;return {open:async()=>({put:async(_key,value)=>{saved=await value.text();},match:async()=>saved?new Response(saved):undefined,delete:async()=>{saved=undefined;}})};}
const worker=await readFile(new URL('../public/notification-worker.js',import.meta.url),'utf8');
test('notification cold start carries both connection and encoded thread; warm start selects without reloading',async()=>{
 for(const warm of [false,true,'default-host']){
  const handlers={},opened=[],messages=[];let focused=false,closed=false,done;
  const client={url:warm==='default-host'?'https://rcm.test/':'https://rcm.test/?host=local',focus:async()=>{focused=true;},postMessage:data=>messages.push(data)};
  vm.runInNewContext(worker,{URL,Response,crypto,caches:clickStorage(),self:{location:{origin:'https://rcm.test'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{matchAll:async()=>warm?[client]:[],openWindow:async url=>opened.push(url)}}});
  handlers.notificationclick({notification:{data:{host:'local',threadId:'thread /?中文'},close:()=>{closed=true;}},waitUntil:p=>done=p});await done;
  assert.equal(closed,true);
  if(warm){assert.equal(focused,true);assert.equal(messages[0].threadId,'thread /?中文');assert.equal(opened.length,0);}
  else {const url=new URL(opened[0]);assert.equal(url.searchParams.get('host'),'local');assert.equal(url.searchParams.get('thread'),'thread /?中文');}
 }
});
test('running icon follows execution entrance while idle retains original creation source',()=>{
 const old=globalThis.document;
 globalThis.document={createElement:()=>({setAttribute(){},append(value){this.icon=value;}})};
 try{
  for(const [originator,running,expected] of [['Codex Desktop','web','globe'],['remote_codex_manager','desktop','monitor'],['Codex Desktop',null,'monitor'],['remote_codex_manager',null,'globe']]){
   const node=threadSourceIcon({originator},running,x=>x);assert.equal(node.icon,expected);
   assert.match(node.title,originator==='Codex Desktop'?/桌面端创建/:/网页端创建/);
  }
 }finally{globalThis.document=old;}
});

test('worker replacement uses click handling while payload retains declarative fallback',async()=>{const handlers={},shown=[];let done;vm.runInNewContext(worker,{self:{addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push(options)}}});const navigate='https://rcm.test/?host=local&thread=fixture';handlers.push({data:{json:()=>({web_push:8030,notification:{title:'test',navigate,data:{host:'local',threadId:'fixture'}}})},waitUntil:p=>done=p});await done;assert.equal(Object.hasOwn(shown[0],'navigate'),false);assert.equal(shown[0].data.threadId,'fixture');});

 test('click survives worker restart and lost message; only matching acknowledgement clears it',async()=>{
 const caches=clickStorage(),messages=[];
 function boot(){const handlers={};vm.runInNewContext(worker,{URL,Response,crypto,caches,self:{location:{origin:'https://rcm.test'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{matchAll:async()=>[],openWindow:async()=>null}}});return handlers;}
 let handlers=boot(),done;
 handlers.notificationclick({notification:{data:{host:'local',threadId:'target'},close(){}},waitUntil:p=>done=p});await done;
 handlers=boot();
 async function message(data){handlers.message({data,source:{postMessage:value=>messages.push(value)},waitUntil:p=>done=p});await done;}
 await message({type:'rcm-notification-ready'});
 assert.equal(messages[0].threadId,'target');
 await message({type:'rcm-notification-consumed',clickId:'stale-click'});
 await message({type:'rcm-notification-ready'});assert.equal(messages.length,2);
 await message({type:'rcm-notification-consumed',clickId:messages[0].clickId});
 await message({type:'rcm-notification-ready'});assert.equal(messages.length,2);
 });

test('page acknowledges click only after target detail loads and retains it on disconnect',async()=>{
 const ts=await import('typescript');
 const source=await readFile(new URL('../src/web/controller.ts',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function openNotificationThread('),source.indexOf('const sendTaskNotification='));
 for(const loaded of [false,true]){
  const sent=[],state={selectedId:null,detail:null,historyError:'',busy:new Set()};
  const context={openingNotification:null,saveNotificationTarget,consumeNotificationTarget,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{href:'https://rcm.test/?host=local'},history:{replaceState(){}},recordError:error=>{throw error;},state,targetHost:'local',connectionIds:['local'],navigator:{serviceWorker:{getRegistration:async()=>({active:{postMessage:value=>sent.push(value)}})}},selectThread:async id=>{state.selectedId=id;if(loaded)state.detail={thread:{id}};}};
  vm.createContext(context);vm.runInContext(ts.transpile(code),context);
  await context.openNotificationThread({host:'local',threadId:'target',clickId:'click'});
  assert.equal(sent.length,loaded?1:0);
  if(loaded)assert.equal(sent[0].clickId,'click');
 }
});

test('declarative notification link carries a same-document navigation target',()=>{
 const payload=notificationPayload({title:'test',data:{host:'local',threadId:'thread /?中文'}},'https://rcm.test');
 const parsed=notificationLink(payload.notification.navigate);
 assert.deepEqual(parsed,{host:'local',threadId:'thread /?中文'});
 assert.equal(new URL(payload.notification.navigate).hash.startsWith('#notification-thread='),true);
});
test('URL target survives early URL cleanup and reload until matching successful consumption',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const href='https://rcm.test/?host=local#notification-thread=target';
 const target=pendingNotificationTarget(storage,href);
 assert.equal(target.threadId,'target');
 assert.deepEqual(pendingNotificationTarget(storage,'https://rcm.test/?host=local'),target);
 saveNotificationTarget(storage,{host:'local',threadId:'newer'});
 consumeNotificationTarget(storage,target,href);
 assert.equal(pendingNotificationTarget(storage,'https://rcm.test/').threadId,'newer');
 saveNotificationTarget(storage,target);
 assert.equal(consumeNotificationTarget(storage,target,href),'https://rcm.test/?host=local');
 assert.equal(pendingNotificationTarget(storage,'https://rcm.test/'),null);
 assert.deepEqual(notificationLink('https://rcm.test/?host=local&thread=old'),{host:'local',threadId:'old'});
});

test('foreground link change and resumed legacy URL both route without worker messages',async()=>{
 const ts=await import('typescript'),source=await readFile(new URL('../src/web/controller.ts',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function requestNotificationTarget(){'),source.indexOf('const connectionConfig=await readConnections();'));
 const events={},opened=[],values=new Map(),location={href:'https://rcm.test/?host=local#notification-thread=foreground'};
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const context={pendingNotificationTarget,sessionStorage:storage,location,notificationNavigationReady:true,document:{visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{},openNotificationThread:target=>opened.push(target),recordError:error=>{throw error;}};
 vm.createContext(context);vm.runInContext(ts.transpile(code),context);
 events.hashchange();assert.equal(opened[0].threadId,'foreground');
 location.href='https://rcm.test/?host=local&thread=legacy';events.pageshow();assert.equal(opened[1].threadId,'legacy');
 context.document.visibilityState='hidden';events.visibilitychange();assert.equal(opened.length,2);
 context.document.visibilityState='visible';events.visibilitychange();assert.equal(opened[2].threadId,'legacy');
});
