import {notificationLink,pendingNotificationTarget,saveNotificationTarget,consumeNotificationTarget,notificationTargetUrl} from '../src/web/services/notification-target.ts';
import {notificationPayload} from '../lib/web-push.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {threadSourceIcon} from '../public/activity.js';
function clickStorage(){const saved=new Map();return {open:async name=>({put:async(key,value)=>{saved.set(name+key,await value.text());},match:async key=>saved.has(name+key)?new Response(saved.get(name+key)):undefined,delete:async key=>saved.delete(name+key)})};}
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

test('legacy delivery of web_push JSON keeps custom click semantics without navigate',async()=>{const handlers={},shown=[];let done;vm.runInNewContext(worker,{self:{addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push(options)}}});const navigate='https://rcm.test/?host=local&thread=fixture';handlers.push({data:{json:()=>({web_push:8030,notification:{title:'test',navigate,data:{host:'local',threadId:'fixture'}}})},waitUntil:p=>done=p});await done;assert.equal(Object.hasOwn(shown[0],'navigate'),false);assert.equal(shown[0].data.threadId,'fixture');});

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
  const context={reportPageNavigation:async()=>{},openingNotification:null,notificationWaitingForCreate:false,saveNotificationTarget,consumeNotificationTarget,notificationTargetUrl,pendingNotificationTarget,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{href:'https://rcm.test/?host=local'},history:{replaceState(){}},recordError:error=>{throw error;},state,targetHost:'local',connectionIds:['local'],navigator:{serviceWorker:{getRegistration:async()=>({active:{postMessage:value=>sent.push(value)}})}},selectThread:async id=>{state.selectedId=id;if(loaded)state.detail={thread:{id}};}};
  vm.createContext(context);vm.runInContext(ts.transpile(code),context);
  await context.openNotificationThread({host:'local',threadId:'target',clickId:'click'});
  assert.equal(sent.length,loaded?1:0);
  if(loaded)assert.equal(sent[0].clickId,'click');
 }
});

test('declarative notification link carries a unique full-document navigation target',()=>{
 const payload=notificationPayload({title:'test',data:{host:'local',threadId:'thread /?中文'}},'https://rcm.test');
 const parsed=notificationLink(payload.notification.navigate);
 assert.equal(parsed.host,'local');assert.equal(parsed.threadId,'thread /?中文');assert.ok(parsed.clickId);
 const url=new URL(payload.notification.navigate);assert.equal(url.pathname,'/index.html');assert.equal(url.hash,'');
 assert.notEqual(notificationLink(notificationPayload({title:'test',data:{host:'local',threadId:'thread /?中文'}},'https://rcm.test').notification.navigate).clickId,parsed.clickId);
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
 const context={navigationTraces:{flush:async()=>{}},pendingNotificationTarget,localStorage:storage,location,notificationNavigationReady:true,document:{visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{},openNotificationThread:target=>opened.push(target),recordError:error=>{throw error;}};
 vm.createContext(context);vm.runInContext(ts.transpile(code),context);
 events.hashchange();assert.equal(opened[0].threadId,'foreground');
 location.href='https://rcm.test/?host=local&thread=legacy';events.pageshow();assert.equal(opened[1].threadId,'legacy');
 context.document.visibilityState='hidden';events.visibilitychange();assert.equal(opened.length,2);
 context.document.visibilityState='visible';events.visibilitychange();assert.equal(opened[2].threadId,'legacy');
});

function memoryStorage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
async function pageNavigation(storage=memoryStorage()){
 const ts=await import('typescript'),source=await readFile(new URL('../src/web/controller.ts',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('async function openNotificationThread('),source.indexOf('const sendTaskNotification='));
 const sent=[],selected=[],assigned=[],errors=[];
 const location={href:'https://rcm.test/?host=local',assign:value=>assigned.push(value)};
 const state={selectedId:null,detail:null,loadingDetail:false,historyError:'',busy:new Set()};
 const context={reportPageNavigation:async()=>{},openingNotification:null,notificationWaitingForCreate:false,saveNotificationTarget,consumeNotificationTarget,notificationTargetUrl,pendingNotificationTarget,localStorage:storage,location,history:{replaceState:(_a,_b,url)=>location.href=url},recordError:e=>errors.push(e),toast:e=>errors.push(e),flushDrafts(){},state,targetHost:'local',connectionIds:['local','remote'],navigator:{serviceWorker:{getRegistration:async()=>({active:{postMessage:value=>sent.push(value)}})}},selectThread:async id=>{selected.push(id);state.selectedId=id;state.detail={thread:{id}};}};
 vm.createContext(context);vm.runInContext(ts.transpile(code),context);
 return {context,state,sent,selected,assigned,errors,storage,location};
}
test('cold page starts at home and consumes the clicked target exactly once across restart',async()=>{
 const store=memoryStorage();saveNotificationTarget(store,{host:'local',threadId:'target',clickId:'closed-app'});
 const page=await pageNavigation(store);assert.equal(page.state.selectedId,null);
 await page.context.openNotificationThread(pendingNotificationTarget(store,page.location.href));
 assert.equal(page.state.selectedId,'target');assert.equal(page.sent[0].clickId,'closed-app');
 const reopened=await pageNavigation(store);assert.equal(pendingNotificationTarget(store,reopened.location.href),null);
});
test('cross-connection URL removes stale fragment and preserves target and receipt through pairing reload',async()=>{
 const page=await pageNavigation();page.location.href='https://rcm.test/?host=local#notification-thread=old';
 await page.context.openNotificationThread({host:'remote',threadId:'new',clickId:'receipt'});
 assert.equal(page.selected.length,0);assert.equal(page.assigned.length,1);
 assert.deepEqual(notificationLink(page.assigned[0]),{host:'remote',threadId:'new',clickId:'receipt'});
 assert.equal(new URL(page.assigned[0]).hash,'');
 assert.equal(pendingNotificationTarget(page.storage,page.assigned[0]).clickId,'receipt');
});
test('missing connection is explained and acknowledged instead of repeatedly reopening',async()=>{
 const page=await pageNavigation();await page.context.openNotificationThread({host:'removed',threadId:'gone',clickId:'removed'});
 assert.equal(page.selected.length,0);assert.match(page.errors[0],/连接已不存在/);assert.equal(page.sent[0].clickId,'removed');assert.equal(pendingNotificationTarget(page.storage,page.location.href),null);
});
test('offline loading and recovering snapshot keep target; normal reconnect detail consumes it',async()=>{
 const page=await pageNavigation();page.context.selectThread=async id=>{page.state.selectedId=id;page.state.detail={thread:{id},recovering:true};page.state.historyError='offline';};
 await page.context.openNotificationThread({host:'local',threadId:'target',clickId:'offline'});
 assert.equal(page.sent.length,0);assert.equal(pendingNotificationTarget(page.storage,page.location.href).threadId,'target');
 page.state.historyError='';page.state.detail.recovering=false;await page.context.finishNotificationNavigation();
 assert.equal(page.sent.length,1);assert.equal(pendingNotificationTarget(page.storage,page.location.href),null);
});
test('creating defers navigation and latest click wins while older detail is in flight',async()=>{
 const page=await pageNavigation();page.state.busy.add('create');await page.context.openNotificationThread({host:'local',threadId:'deferred'});
 assert.equal(page.selected.length,0);assert.equal(page.context.notificationWaitingForCreate,true);page.state.busy.clear();
 const releases={};page.context.selectThread=async id=>{page.state.selectedId=id;await new Promise(resolve=>releases[id]=resolve);if(page.state.selectedId===id)page.state.detail={thread:{id}};};
 const first=page.context.openNotificationThread({host:'local',threadId:'first',clickId:'first'});
 const last=page.context.openNotificationThread({host:'local',threadId:'last',clickId:'last'});
 releases.last();await last;releases.first();await first;
 assert.equal(page.state.selectedId,'last');assert.deepEqual(page.sent.map(m=>m.clickId),['last']);assert.equal(pendingNotificationTarget(page.storage,page.location.href),null);
});
function bootWorker({caches=clickStorage(),clients}={}){const handlers={};vm.runInNewContext(worker,{URL,Response,crypto,caches,self:{location:{origin:'https://rcm.test'},addEventListener:(name,fn)=>handlers[name]=fn,clients}});return {handlers,click(data){let done;handlers.notificationclick({notification:{data,close(){}},waitUntil:p=>done=p});return done;},ready(){let done;const messages=[];handlers.message({data:{type:'rcm-notification-ready'},source:{postMessage:m=>messages.push(m)},waitUntil:p=>done=p});return done.then(()=>messages);}};}
test('cache failure and stale window focus failure still open a complete deep link',async()=>{
 const opened=[];const w=bootWorker({caches:{open:async()=>{throw Error('storage unavailable');}},clients:{matchAll:async()=>[{url:'https://rcm.test/',focus:async()=>{throw Error('discarded');}}],openWindow:async url=>{opened.push(url);return null;}}});
 await w.click({host:'local',threadId:'target'});const target=notificationLink(opened[0]);assert.equal(target.threadId,'target');assert.ok(target.clickId);assert.equal((await w.ready())[0].clickId,target.clickId);
});
test('new page can request its target before openWindow resolves (no startup deadlock)',async()=>{
 let received;const w=bootWorker({clients:{matchAll:async()=>[],openWindow:async()=>{received=await w.ready();return null;}}});
 let timer;try{await Promise.race([w.click({host:'local',threadId:'target'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('navigation deadlock')),1000))]);}finally{clearTimeout(timer);}
 assert.equal(received[0].threadId,'target');
});
test('slow old focus cannot deliver an older click after a newer notification',async()=>{
 const messages=[],focus=[];const client={url:'https://rcm.test/?host=local',focus:()=>new Promise(resolve=>focus.push(resolve)),postMessage:m=>messages.push(m)};
 const w=bootWorker({clients:{matchAll:async()=>[client]}});
 const old=w.click({host:'local',threadId:'old'});while(!focus.length)await new Promise(resolve=>setImmediate(resolve));
 const latest=w.click({host:'local',threadId:'latest'});while(focus.length<2)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(messages.map(m=>m.threadId),['old','latest']);
 focus[1]();await latest;focus[0]();await old;assert.deepEqual(messages.map(m=>m.threadId),['old','latest']);
});

test('manual navigation cancels an offline target so reconnect cannot hijack the new selection',async()=>{
 const page=await pageNavigation();page.context.selectThread=async id=>{page.state.selectedId=id;page.state.historyError='offline';};
 await page.context.openNotificationThread({host:'local',threadId:'failed',clickId:'cancelled'});
 page.context.cancelPendingNotification();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pendingNotificationTarget(page.storage,page.location.href),null);
 assert.equal(page.sent[0].clickId,'cancelled');
});

test('declarative replacement reads native getters and preserves required navigation without a synthetic click',async()=>{
 const payload=notificationPayload({title:'测试会话 · 本次执行已完成',body:'已经完成。',data:{host:'local',threadId:'other-thread'}},'https://rcm.test');
 const handlers={},shown=[],pending=[];
 const notification=Object.create(Object.defineProperties({},Object.fromEntries(Object.entries(payload.notification).map(([key,value])=>[key,{get:()=>value}]))));
 vm.runInNewContext(worker,{URL,Response,crypto,caches:clickStorage(),self:{location:{origin:'https://rcm.test'},addEventListener:(n,fn)=>handlers[n]=fn,registration:{showNotification:async(title,options)=>{
  if(!options.navigate||!URL.canParse(options.navigate))throw new TypeError('Declarative notification requires a valid navigate');
  shown.push({title,options});
 }},clients:{matchAll:async()=>[]}}});
 // This models an already delivered native event, not Apple's event dispatch.
 handlers.push({data:null,notification,waitUntil:p=>pending.push(p)});
 for(let i=0;i<pending.length;i++)await pending[i];
 assert.equal(shown.length,1);assert.equal(shown[0].title,payload.title);assert.equal(shown[0].options.body,payload.body);
 assert.equal(shown[0].options.navigate,payload.notification.navigate);
 // Model native navigate -> page startup only. Declarative activation does NOT
 // dispatch notificationclick. This is a protocol regression, not device proof.
 const page=await pageNavigation();await page.context.openNotificationThread(notificationLink(shown[0].options.navigate));
 assert.equal(page.state.selectedId,'other-thread');
});
test('declarative validation failure records show error and leaves fallback eligible; diagnostic title is opt-in',async()=>{
 for(const invalid of [false,true])for(const diagnostic of [false,true]){
  const handlers={},shown=[],pending=[];
  const payload=notificationPayload({title:(diagnostic?'[原始] ':'')+'会话 · 测试通知',data:{host:'local',threadId:'target',testId:'numbered-test',...(diagnostic?{diagnostic:true}:{})}},'https://rcm.test');
  if(invalid)delete payload.notification.navigate;
  vm.runInNewContext(worker,{URL,self:{addEventListener:(n,fn)=>handlers[n]=fn,registration:{showNotification:async(title,options)=>{if(!options.navigate||!URL.canParse(options.navigate))throw new TypeError('valid navigate required');shown.push({title,options});}},clients:{matchAll:async()=>[]}}});
  handlers.push({data:null,notification:payload.notification,waitUntil:p=>pending.push(p)});
  const results=await Promise.allSettled(pending);assert.equal(results.some(r=>r.status==='rejected'),invalid);
  if(!invalid){assert.equal(shown[0].title,(diagnostic?'[接收器] ':'')+'会话 · 测试通知');assert.equal(shown[0].options.navigate,payload.notification.navigate);}
 }
});

test('declarative test receipts use notification data and replacement failure remains eligible for system fallback',async()=>{
 for(const fails of [false,true]){
  const handlers={},shown=[],receipts=[],pending=[];
  const payload=notificationPayload({title:'会话 · 测试通知',body:'真实回复',data:{host:'local',threadId:'target',testId:'declarative-test'}},'https://rcm.test');
  vm.runInNewContext(worker,{self:{addEventListener:(n,fn)=>handlers[n]=fn,registration:{showNotification:async(title,options)=>{shown.push(options);if(fails)throw Error('display rejected');}},clients:{matchAll:async()=>[{postMessage:m=>receipts.push(m)}]}}});
  handlers.push({data:null,notification:payload.notification,waitUntil:p=>pending.push(p)});
  const results=await Promise.allSettled(pending);assert.equal(results.some(r=>r.status==='rejected'),fails);
  assert.equal(shown[0].data.threadId,'target');assert.equal(receipts[0].testId,'declarative-test');assert.equal(!!receipts[0].error,fails);
  assert.equal(notificationLink(payload.notification.navigate).threadId,'target');
 }
});

// Exercise the real MessageChannel handshake, including an unresponsive old page.
function acknowledgedWorker(clients){
 const handlers={},pending=[];
 vm.runInNewContext(worker,{URL,Response,crypto,MessageChannel,setTimeout,clearTimeout,caches:clickStorage(),self:{location:{origin:'https://rcm.test'},addEventListener:(n,fn)=>handlers[n]=fn,clients}});
 return {click(data){handlers.notificationclick({notification:{data,close(){}},waitUntil:p=>pending.push(p)});return pending.at(-1);}};
}
test('foreground page receives target even if focus never settles; acknowledged navigation avoids reload',async()=>{
 const messages=[],navigations=[];
 const stale={url:'https://rcm.test/?host=local',visibilityState:'hidden',postMessage:()=>assert.fail('must not choose stale matching window')};
 const active={url:'https://rcm.test/',focused:true,visibilityState:'visible',focus:()=>new Promise(()=>{}),navigate:async url=>navigations.push(url),postMessage:(data,ports)=>{messages.push(data);ports[0].postMessage({clickId:data.clickId});}};
 const w=acknowledgedWorker({matchAll:async()=>[stale,active],openWindow:()=>assert.fail('must reuse foreground page')});
 await w.click({host:'local',threadId:'other-thread'});
 assert.equal(messages[0].threadId,'other-thread');assert.equal(navigations.length,0);
});
test('missing page acknowledgement navigates existing background window to full target',async()=>{
 const navigations=[];
 const client={url:'https://rcm.test/?host=local',visibilityState:'hidden',focus:async()=>client,postMessage(){},navigate:async url=>{navigations.push(url);return client;}};
 const w=acknowledgedWorker({matchAll:async()=>[client],openWindow:()=>assert.fail('existing window can navigate')});
 await w.click({host:'local',threadId:'target'});
 const target=notificationLink(navigations[0]);assert.equal(target.threadId,'target');assert.ok(target.clickId);assert.equal(new URL(navigations[0]).pathname,'/index.html');
});
test('late old acknowledgement timeout cannot navigate over the latest clicked conversation',async()=>{
 const navigations=[],received=[];
 const client={url:'https://rcm.test/',focus:async()=>client,postMessage:(data,ports)=>{received.push(data);if(data.threadId==='latest')ports[0].postMessage({clickId:data.clickId});},navigate:async url=>{navigations.push(url);return client;}};
 const w=acknowledgedWorker({matchAll:async()=>[client]});
 const old=w.click({host:'local',threadId:'old'});while(!received.length)await new Promise(resolve=>setImmediate(resolve));
 await w.click({host:'local',threadId:'latest'});await old;
 assert.equal(navigations.length,0);assert.equal(received.at(-1).threadId,'latest');
});
test('page saves and acknowledges received target before startup and retains it for later opening',async()=>{
 const ts=await import('typescript'),source=await readFile(new URL('../src/web/controller.ts',import.meta.url),'utf8');
 const start=source.indexOf("navigator.serviceWorker?.addEventListener('message',event=>{");
 const code=source.slice(start,source.indexOf('function requestNotificationTarget(){',start));
 const store=memoryStorage(),receipts=[],opened=[];let receive;
 const context={notificationNavigationReady:false,pendingNotification:null,localStorage:store,saveNotificationTarget,navigator:{serviceWorker:{addEventListener:(_type,fn)=>receive=fn}},openNotificationThread:x=>opened.push(x)};
 vm.runInNewContext(ts.transpile(code),context);
 receive({data:{type:'rcm-notification-click',host:'local',threadId:'other',clickId:'receipt'},ports:[{postMessage:data=>receipts.push(data)}]});
 assert.equal(receipts[0].clickId,'receipt');assert.equal(opened.length,0);assert.equal(context.pendingNotification.threadId,'other');assert.equal(pendingNotificationTarget(store,'https://rcm.test').threadId,'other');
 context.notificationNavigationReady=true;
 receive({data:{type:'rcm-notification-click',host:'local',threadId:'new',clickId:'new'},ports:[]});assert.equal(opened[0].threadId,'new');
});

test('worker trace fetch failure relays routing diagnostics to an authenticated foreground page',async()=>{
 const handlers={},messages=[],pending=[];
 vm.runInNewContext(worker,{URL,AbortSignal,fetch:async()=>({ok:false,json:async()=>({token:'csrf',configRevision:'revision',defaultConnection:'local'})}),self:{location:{origin:'https://rcm.test'},addEventListener:(n,fn)=>handlers[n]=fn,registration:{pushManager:{getSubscription:async()=>({endpoint:'https://web.push.apple.com/private'})},showNotification:async()=>{}},clients:{matchAll:async()=>[{url:'https://rcm.test/',focused:true,postMessage:m=>messages.push(m)}]}}});
 handlers.push({data:{json:()=>({title:'private content',data:{host:'local',threadId:'target'}})},waitUntil:p=>pending.push(p)});
 await Promise.all(pending);await Promise.all(pending);
 assert.deepEqual(messages.map(m=>m.stage).sort(),['worker-push','worker-shown']);assert.equal(messages[0].threadId,'target');assert.equal(messages[0].type,'rcm-navigation-trace');
 assert.equal(JSON.stringify(messages).includes('private'),false);
});
