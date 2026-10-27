import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/notification-worker.js',import.meta.url),'utf8');
function storage(){const saved=new Map();return {open:async name=>({put:async(key,value)=>saved.set(name+key,await value.text()),match:async key=>saved.has(name+key)?new Response(saved.get(name+key)):undefined,delete:async key=>saved.delete(name+key)})};}
function boot(caches,network=async()=>{throw Error('background credentials unavailable');}){
 const handlers={},shown=[],opened=[];
 const context={URL,Response,crypto,caches,AbortSignal,fetch:network,self:{onpush:null,onnotificationclick:null,location:{origin:'https://portal.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},registration:{pushManager:{getSubscription:async()=>null},showNotification:async(title,options)=>shown.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>{opened.push(url);return null;}}}};
 vm.runInNewContext(source,context);
 async function event(name,data={}){const pending=[];handlers[name]({...data,waitUntil:p=>pending.push(p)});for(let i=0;i<pending.length;i++)await pending[i];}
 return {shown,opened,event,diagnostics:async()=>{let result;await event('message',{data:{type:'rcm-push-diagnostics'},ports:[{postMessage:value=>result=JSON.parse(JSON.stringify(value))}]});return result;},ready:async()=>{let result;await event('message',{data:{type:'rcm-notification-ready'},source:{postMessage:value=>result=value}});return result;}};
}
test('push and click diagnostics survive failed background requests and worker restart without interfering with routing',async()=>{
 const caches=storage(),w=boot(caches);
 await w.event('install');await w.event('activate');
 const data={host:'local',threadId:'other-thread',testId:'test-fixture',body:'private body',endpoint:'private endpoint'};
 await w.event('push',{data:{json:()=>({title:'private title',body:'private body',data})}});
 await w.event('notificationclick',{notification:{data,close(){}}});
 assert.equal(w.shown.length,1);assert.equal(new URL(w.opened[0]).searchParams.get('thread'),'other-thread');
 const restarted=boot(caches),diagnostics=await restarted.diagnostics();
 assert.equal(diagnostics.version,6);assert.equal(diagnostics.capabilities,'push=true, click=true, storage=available');
 assert.deepEqual(diagnostics.journal.map(row=>row.stage),['worker-install','worker-activate','worker-push','worker-shown','worker-click','worker-window']);
 assert.equal(diagnostics.journal.find(row=>row.stage==='worker-click').testId,'test-fixture');assert.equal(JSON.stringify(diagnostics).includes('private'),false);
 assert.equal((await restarted.ready()).threadId,'other-thread');
});
test('journal remains bounded and cache denial does not prevent displaying, navigating or querying the in-memory evidence',async()=>{
 const w=boot({open:async()=>{throw Error('storage denied');}});
 for(let i=0;i<18;i++)await w.event('push',{data:{json:()=>({data:{threadId:'thread-'+i}})}});
 await w.event('notificationclick',{notification:{data:{host:'local',threadId:'last'},close(){}}});
 const diagnostics=await w.diagnostics();assert.equal(diagnostics.journal.length,32);assert.match(diagnostics.capabilities,/storage=unavailable/);
 assert.equal(diagnostics.journal.at(-1).threadId,'last');assert.equal(w.shown.length,18);assert.equal((await w.ready()).threadId,'last');
});
