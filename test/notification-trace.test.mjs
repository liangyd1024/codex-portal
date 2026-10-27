import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createNotificationTraceQueue,createNotificationTraceSender} from '../src/web/services/notification-trace.ts';
const observation=(id='event',host='original')=>({host,stage:'page-target',threadId:'target',testId:id,clickId:'click-'+id,selectedId:'before',visibility:'hidden',version:'page-5',observedAt:123});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('early observations do not upload before CSRF and retain the entire original context',async()=>{
 let ready=false;const sent=[],queue=createNotificationTraceQueue({ready:()=>ready,send:async e=>sent.push(e)}),event=observation();
 queue.report(event);Object.assign(event,{host:'current',threadId:'different',clickId:'later',testId:'later',selectedId:'after',visibility:'visible'});
 await queue.flush();assert.deepEqual(sent,[]);ready=true;await queue.flush();
 assert.deepEqual(sent,[observation()]);assert.equal(Object.isFrozen(sent[0]),true);
});
test('flush includes new events while sending and keeps the bounded queue correct during overflow',async()=>{
 const entered=deferred(),release=deferred(),sent=[];
 const queue=createNotificationTraceQueue({ready:()=>true,send:async e=>{sent.push(e.testId);if(e.testId==='first'){entered.resolve();await release.promise;}}});
 queue.report(observation('first'));await entered.promise;
 for(let i=0;i<40;i++)queue.report(observation('queued-'+i));
 release.resolve();await queue.flush();
 assert.deepEqual(sent,['first',...Array.from({length:32},(_,i)=>'queued-'+(i+8))]);
});
test('a 400/404 head is discarded and cannot block valid later observations',async()=>{
 for(const status of [400,404]){
  let ready=false;const sent=[],queue=createNotificationTraceQueue({ready:()=>ready,send:async e=>{sent.push(e.testId);if(e.host==='removed')throw Object.assign(Error('gone'),{status});}});
  queue.report(observation('bad','removed'));queue.report(observation('good'));ready=true;await queue.flush();
  assert.deepEqual(sent,['bad','good']);await queue.flush();assert.equal(sent.length,2);
 }
});
test('network/auth/server failures remain retryable without polling or dropping later events',async()=>{
 for(const status of [undefined,401,403,429,500]){
  let ready=false,fail=true;const sent=[],queue=createNotificationTraceQueue({ready:()=>ready,send:async e=>{sent.push(e.testId);if(fail)throw Object.assign(Error('temporary'),{status});}});
  queue.report(observation('first'));queue.report(observation('second'));ready=true;await queue.flush();await new Promise(r=>setImmediate(r));assert.deepEqual(sent,['first']);
  fail=false;await queue.flush();assert.deepEqual(sent,['first','first','second']);
 }
});
test('hung iOS registration or subscription lookup expires without blocking the queue',async()=>{
 for(const stage of ['registration','subscription']){
  const sent=[];let lookups=0;
  const serviceWorker={getRegistration:async()=>{lookups++;if(stage==='registration')return new Promise(()=>{});return {pushManager:{getSubscription:()=>new Promise(()=>{})}};}};
  const send=createNotificationTraceSender({lookupTimeout:5,lookupEndpoint:async()=>{const reg=await serviceWorker.getRegistration();return (await reg?.pushManager.getSubscription())?.endpoint;},api:async(path,options)=>sent.push({path,...options})});
  const queue=createNotificationTraceQueue({ready:()=>true,send});
  queue.report(observation('first'));queue.report(observation('second'));await queue.flush();
  assert.equal(sent.length,2);assert.equal(lookups,1);assert.ok(sent.every(r=>!Object.hasOwn(r.body,'endpoint')));
 }
});
test('a fresh worker relay sender never samples the endpoint when either worker identity is present',async()=>{
 for(const identity of [{instanceId:'worker-instance'},{endpointHash:'a'.repeat(64)}]){
  let lookups=0;const sent=[];
  const send=createNotificationTraceSender({lookupEndpoint:async()=>{lookups++;return 'https://push.test/unnecessary';},api:async(path,options)=>sent.push({path,...options})});
  await send({...observation('worker'),...identity});
  assert.equal(lookups,0);assert.equal(sent.length,1);assert.equal(Object.hasOwn(sent[0].body,'endpoint'),false);
 }
});
test('trace sender preserves frozen host in URL and body even after endpoint lookup suspends',async()=>{
 const release=deferred(),sent=[];let ready=false;
 const queue=createNotificationTraceQueue({ready:()=>ready,send:createNotificationTraceSender({lookupEndpoint:()=>release.promise,api:async(path,options)=>sent.push({path,...options})})});
 const event=observation('event','previous / host');queue.report(event);event.host='current';ready=true;const flush=queue.flush();release.resolve('https://push.test/endpoint');await flush;
 assert.equal(sent[0].path,'/api/push/trace?host=previous%20%2F%20host');assert.equal(sent[0].body.host,'previous / host');assert.equal(sent[0].body.endpoint,'https://push.test/endpoint');
});
test('controller early worker listener snapshots before state initialization without TDZ or early upload',async()=>{
 const source=await readFile(new URL('../src/web/controller.ts',import.meta.url),'utf8');
 const setup=source.slice(source.indexOf('let navigationStateReady='),source.indexOf('function requestNotificationTarget(){'));
 const report=source.slice(source.indexOf('async function reportPageNavigation('),source.indexOf('async function openNotificationThread('));
 const trace=observation('early'),sent=[],context={createNotificationTraceQueue,createNotificationTraceSender,requestedHost:'original',notificationNavigationReady:false,navigator:{serviceWorker:{addEventListener:(_name,fn)=>fn({data:{...trace,type:'rcm-navigation-trace',stage:'worker-shown',instanceId:'background'}})}},document:{visibilityState:'hidden'},navigationTraceApi:async(path,options)=>sent.push({path,...options})};
 // The callback runs synchronously while state is still in its lexical TDZ.
 vm.runInNewContext(ts.transpile(setup+report+"\nconst state={csrf:'',selectedId:'after'};navigationStateReady=true;globalThis.start=async()=>{state.csrf='token';notificationNavigationReady=true;await navigationTraces.flush();};",{target:ts.ScriptTarget.ES2022}),context);
 await Promise.resolve();assert.equal(sent.length,0);await context.start();
 assert.equal(sent[0].body.selectedId,null);assert.equal(sent[0].body.host,'original');assert.equal(sent[0].body.visibility,'hidden');assert.equal(sent[0].body.testId,'early');
 // The separate diagnostic client must not add the current UI host again.
 assert.match(source,/const navigationTraceApi=createApiClient\(\{targetUrl:path=>path,/);
});
