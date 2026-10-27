import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/notification-worker.js',import.meta.url),'utf8');
const journalName='rcm-notification-journal-v2';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function storage(){
 const maps=new Map(),calls={keys:0,match:0,put:0,delete:0},faults={};let tail=Promise.resolve();
 const locks={request:(_name,{signal},run)=>{const next=tail.then(()=>{signal.throwIfAborted();return run();});tail=next.catch(()=>{});return next;}};
 const map=name=>{if(!maps.has(name))maps.set(name,new Map());return maps.get(name);};
 const url=key=>typeof key==='string'?new URL(key,'https://portal.test').href:key.url;
 return {locks,map,calls,faults,open:async name=>({
  put:async(key,value)=>{calls.put++;await faults.put?.(name,key);map(name).set(url(key),await value.text());},
  match:async key=>{calls.match++;await faults.match?.(name,key);return map(name).has(url(key))?new Response(map(name).get(url(key))):undefined;},
  keys:async()=>{calls.keys++;await faults.keys?.(name);return [...map(name).keys()].map(url=>({url}));},
  delete:async key=>{calls.delete++;await faults.delete?.(name,key);return map(name).delete(url(key));},
 })};
}
function boot(caches,{network=async()=>{throw Error('background credentials unavailable');},timers=setTimeout,now,locks=caches.locks}={}){
 const handlers={},shown=[],opened=[];
 const context={URL,Response,crypto,TextEncoder,caches,AbortSignal,AbortController,setTimeout:timers,clearTimeout,navigator:{locks},fetch:network,self:{onpush:null,onnotificationclick:null,location:{origin:'https://portal.test',href:'https://portal.test/notification-worker.js?v=7&secret=hidden'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},registration:{scope:'https://portal.test/',pushManager:{getSubscription:async()=>({endpoint:'https://push.test/private-endpoint'})},showNotification:async(title,options)=>shown.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>{opened.push(url);return null;}}}};
 if(now!==undefined)context.Date=class extends Date{static now(){return now;}};
 vm.createContext(context);vm.runInContext(source,context);
 async function event(name,data={}){const pending=[];handlers[name]({...data,waitUntil:p=>pending.push(p)});for(let i=0;i<pending.length;i++)await pending[i];}
 return {shown,opened,event,record:(stage,data)=>context.recordNavigation(stage,data),diagnostics:async()=>{let result;await event('message',{data:{type:'rcm-push-diagnostics'},ports:[{postMessage:value=>result=JSON.parse(JSON.stringify(value))}]});return result;},ready:async()=>{let result;await event('message',{data:{type:'rcm-notification-ready'},source:{postMessage:value=>result=value}});return result;}};
}
test('push/click evidence survives background request failure and restart, without private content',async()=>{
 const caches=storage(),w=boot(caches);
 await w.event('install');await w.event('activate');
 const data={host:'local',threadId:'other-thread',testId:'test-fixture',body:'private body',endpoint:'private endpoint'};
 await w.event('push',{data:{json:()=>({title:'private title',body:'private body',data})}});
 await w.event('notificationclick',{notification:{data,close(){}}});
 assert.equal(w.shown.length,1);assert.equal(new URL(w.opened[0]).searchParams.get('thread'),'other-thread');
 const restarted=boot(caches),diagnostics=await restarted.diagnostics();
 assert.equal(diagnostics.version,9);assert.equal(diagnostics.capabilities,'push=true, click=true, storage=available');
 assert.deepEqual(diagnostics.journal.map(row=>row.stage),['worker-install','worker-activate','worker-push','worker-shown','worker-click','worker-window']);
 const clicked=diagnostics.journal.find(row=>row.stage==='worker-click');assert.ok(clicked.clickId);assert.equal(clicked.clickId,diagnostics.journal.find(row=>row.stage==='worker-window').clickId);assert.equal(clicked.clickId,(await restarted.ready()).clickId);assert.equal(clicked.clickId,new URL(w.opened[0]).searchParams.get('notification-click'));assert.equal(clicked.testId,diagnostics.journal.find(row=>row.stage==='worker-window').testId);assert.equal(clicked.testId,(await restarted.ready()).testId);
 assert.equal(diagnostics.journal.find(row=>row.stage==='worker-click').testId,'test-fixture');assert.equal(JSON.stringify(diagnostics).includes('private'),false);
 assert.match(diagnostics.context.endpointHash,/^[a-f0-9]{64}$/);assert.equal(diagnostics.context.script,'https://portal.test/notification-worker.js?v=7');assert.equal(diagnostics.context.windows,0);
 assert.equal((await restarted.ready()).threadId,'other-thread');
});
test('cache denial and missing cross-worker locks retain bounded memory without blocking notices or navigation',async()=>{
 for(const caches of [{open:async()=>{throw Error('storage denied');},locks:storage().locks},storage()]){
  const w=boot(caches,{locks:caches.map?null:caches.locks});
  for(let i=0;i<18;i++)await w.event('push',{data:{json:()=>({data:{threadId:'thread-'+i}})}});
  await w.event('notificationclick',{notification:{data:{host:'local',threadId:'last'},close(){}}});
  const diagnostics=await w.diagnostics();assert.equal(diagnostics.journal.length,32);assert.match(diagnostics.capabilities,/storage=unavailable/);
  assert.equal(diagnostics.journal.at(-1).threadId,'last');assert.equal(w.shown.length,18);assert.equal((await w.ready()).threadId,'last');
 }
});
test('two VMs with a shared cache retain interleaved writes and distinct IDs at an identical timestamp',async()=>{
 const caches=storage(),a=boot(caches,{now:10}),b=boot(caches,{now:10});
 await a.event('install');await a.diagnostics();
 const entered=deferred(),release=deferred();let held=false;
 caches.faults.put=async name=>{if(name===journalName&&!held){held=true;entered.resolve();await release.promise;}};
 const first=a.record('worker-push',{testId:'a'});await entered.promise;
 const second=b.record('worker-shown',{testId:'b'});release.resolve();await Promise.all([first,second]);
 const rows=(await a.diagnostics()).journal;
 assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.id)).size,3);assert.deepEqual(rows.filter(r=>r.testId).map(r=>r.testId).sort(),['a','b']);
 for(let i=0;i<40;i++)await (i%2?a:b).record('worker-push',{testId:'bounded-'+i});
 assert.equal(caches.map(journalName).size,32);assert.equal((await boot(caches).diagnostics()).journal.length,32);
});
test('an event enqueued during a blocked put is drained before both observations complete and survives restart',async()=>{
 const caches=storage(),w=boot(caches),entered=deferred(),release=deferred();let held=false;
 caches.faults.put=async name=>{if(name===journalName&&!held){held=true;entered.resolve();await release.promise;}};
 const first=w.record('worker-push',{testId:'first'});await entered.promise;
 const second=w.record('worker-shown',{testId:'second'});release.resolve();await Promise.all([first,second]);
 assert.deepEqual((await boot(caches).diagnostics()).journal.map(r=>r.testId),['first','second']);
});
test('corrupt individual records and invalid legacy rows cannot discard valid cross-instance evidence',async()=>{
 const caches=storage();await boot(caches).record('worker-push',{testId:'valid'});
 caches.map(journalName).set('https://portal.test/__notification-event/corrupt','invalid JSON');
 caches.map(journalName).set('https://portal.test/__notification-event/null','null');
 caches.map('rcm-notification-journal').set('https://portal.test/__notification-journal',JSON.stringify([null,12,{}, {at:'no',stage:'worker-click'},{at:1,stage:'worker-install',body:'private'}, {at:2,stage:'bad'}]));
 const rows=(await boot(caches).diagnostics()).journal;
 assert.equal(rows.length,2);assert.equal(rows[1].testId,'valid');assert.equal(JSON.stringify(rows).includes('private'),false);
});
test('persistent keys never grow after repeated enumeration/cleanup failure; a real later event recovers',async()=>{
 for(const operation of ['keys','delete']){
  const caches=storage(),w=boot(caches);
  for(let i=0;i<32;i++)await w.record('worker-push',{testId:'before-'+i});
  const puts=caches.calls.put;
  caches.faults[operation]=async()=>{throw Error('denied');};
  for(let i=0;i<40;i++)await w.record('worker-shown',{testId:'failed-'+i});
  const d=await w.diagnostics();assert.equal(d.journal.length,32);assert.match(d.capabilities,/unavailable/);
  assert.equal(caches.map(journalName).size,32);assert.equal(caches.calls.put,puts);
  delete caches.faults[operation];await w.record('worker-click',{testId:'recovered'});
  assert.equal(caches.map(journalName).size,32);assert.ok((await boot(caches).diagnostics()).journal.some(r=>r.testId==='recovered'));
 }
});
test('oversized cache reads and cleanup are bounded and do not expand unknown capacity',async()=>{
 const caches=storage();for(let i=0;i<200;i++)caches.map(journalName).set('https://portal.test/__notification-event/'+i,JSON.stringify({id:'old-'+i,at:i,stage:'worker-push'}));
 await boot(caches).record('worker-shown',{testId:'new'});
 assert.ok(caches.calls.match<=32);assert.equal(caches.calls.delete,32);assert.equal(caches.calls.put,0);assert.equal(caches.map(journalName).size,168);
});
test('a hanging storage read has one outstanding job, no parallel fan-out or late writes after expiry',async()=>{
 const caches=storage(),release=deferred();await boot(caches).record('worker-install');
 let reads=0;caches.faults.match=async name=>{if(name===journalName){reads++;await release.promise;}};
 const w=boot(caches,{timers:(fn,ms)=>setTimeout(fn,Math.min(ms,15))}),puts=caches.calls.put;
 await w.event('push',{data:{json:()=>({data:{threadId:'still-shown'}})}});
 assert.equal(w.shown.length,1);await w.diagnostics();await w.record('worker-shown');assert.equal(reads,1);
 release.resolve();await new Promise(r=>setImmediate(r));assert.equal(caches.calls.put,puts);
 delete caches.faults.match;await w.record('worker-click',{testId:'recovered'});assert.ok((await boot(caches).diagnostics()).journal.some(r=>r.testId==='recovered'));
});
