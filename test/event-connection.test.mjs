import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/event-connection.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createEventConnection}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
 const state={transport:false},calls=[],sources=[];
 let url='/api/events?viewId=qa-view&host=qa-a',side=null;
 const deps={state,url:()=>url,createSource:url=>{const listeners=new Map();const es={url,listeners,addEventListener:(name,listener)=>listeners.set(name,listener)};sources.push(es);return es;},resetThreadView:()=>calls.push('reset'),reconnectSideChat:()=>side?.(),renderStatus:()=>calls.push(['status',state.transport]),reportThreadView:async()=>{calls.push('report');},resumeWorkspace:async()=>{calls.push('resume');},recordError:(e,stage)=>calls.push(['error',e.message,stage]),receiveWebUpdate:data=>calls.push(['update',data]),receiveConfiguration:data=>calls.push(['configuration',data]),handleEvent:event=>calls.push(['event',event]),...overrides};
 const setup=createEventConnection(deps);
 return{state,calls,sources,setup,setUrl:value=>url=value,setSide:value=>side=value};
}
test('open restores once, reports every open, and error permits the next recovery',async()=>{
 const f=fixture();f.setup();const es=f.sources[0];
 assert.equal(f.state.eventSource,es);assert.equal(es.url,'/api/events?viewId=qa-view&host=qa-a');
 f.setSide(()=>f.calls.push('side'));es.onopen();await settle();
 assert.deepEqual(f.calls,['reset','side',['status',true],'report','resume']);
 f.calls.length=0;es.onopen();await settle();
 assert.deepEqual(f.calls,['reset','side',['status',true],'report']);
 f.calls.length=0;es.onerror();es.onopen();await settle();
 assert.deepEqual(f.calls,[['status',false],'reset','side',['status',true],'report','resume']);
});
test('report rejection does not block recovery and failures retain their stages',async()=>{
 const f=fixture({reportThreadView:()=>Promise.reject(Error('view failed')),resumeWorkspace:()=>Promise.reject(Error('sync failed'))});
 f.setup();f.sources[0].onopen();await settle();
 assert.deepEqual(f.calls,['reset',['status',true],['error','view failed','thread'],['error','sync failed','sync'],['status',true]]);
});
test('named and unnamed events retain the complete message without parsing or copying',()=>{
 const f=fixture();f.setup();const es=f.sources[0];
 assert.deepEqual([...es.listeners.keys()],['system/update','configuration/change','heartbeat','manager/status','manager/error','manager/request','manager/requestResolved']);
 const event={data:'{"unknown":{"raw":"原文"}}',type:'message',extra:42};es.onmessage(event);
 for(const name of [...es.listeners.keys()].slice(3)){assert.equal(es.listeners.get(name),es.onmessage);es.listeners.get(name)(event);}
 assert.equal(f.calls.length,5);for(const call of f.calls)assert.equal(call[1],event);
});
test('replaced source cannot deliver update or parse its invalid JSON, new source can',()=>{
 const f=fixture();f.setup();const old=f.sources[0];f.setUrl('/api/events?viewId=qa-view&host=qa-b');f.setup();const current=f.sources[1];
 assert.equal(current.url,'/api/events?viewId=qa-view&host=qa-b');assert.equal(f.state.eventSource,current);
 old.listeners.get('system/update')({data:'invalid'});assert.deepEqual(f.calls,[]);
 current.listeners.get('system/update')({data:'{"version":"qa-version","extra":{"unknown":true}}'});
 assert.deepEqual(f.calls,[['update',{version:'qa-version',extra:{unknown:true}}]]);
 assert.throws(()=>current.listeners.get('system/update')({data:'invalid'}),SyntaxError);
});
test('replaced stream cannot change transport or deliver stale messages',async()=>{
 const f=fixture();f.setup();const old=f.sources[0];f.setup();const current=f.sources[1];current.onopen();await settle();f.calls.length=0;
 old.onerror();old.onopen();old.onmessage({data:'stale'});await settle();
 assert.equal(f.state.transport,true);assert.equal(f.state.eventSource,current);assert.deepEqual(f.calls,[]);
});

test('configuration events ignore replaced streams and preserve their revision',()=>{const f=fixture();f.setup();const old=f.sources[0];f.setup();old.listeners.get('configuration/change')({data:'invalid'});f.sources[1].listeners.get('configuration/change')({data:'{"version":"new-revision"}'});assert.deepEqual(f.calls,[['configuration',{version:'new-revision'}]]);});

test('foreground replaces suspended stream once and delayed old callbacks are ignored',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100000});
 const window=new EventTarget();window.navigator={onLine:true};const document=new EventTarget();document.hidden=false;
 const f=fixture({lifecycle:{window,document}});f.setup();f.sources[0].onopen();await settle();
 document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));t.mock.timers.tick(60000);
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));
 assert.equal(f.sources.length,2);assert.equal(f.state.transport,false);assert.equal(f.state.transportRecovering,true);
 f.sources[1].onopen();await settle();f.sources[0].onerror();assert.equal(f.state.transport,true);assert.equal(f.state.transportRecovering,false);
 t.mock.timers.tick(46000);assert.equal(f.sources.length,3);
 window.dispatchEvent(new Event('pagehide'));t.mock.timers.reset();
});
