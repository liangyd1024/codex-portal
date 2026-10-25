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
 const deps={state,url:()=>url,createSource:url=>{const listeners=new Map();const es={url,listeners,addEventListener:(name,listener)=>listeners.set(name,listener)};sources.push(es);return es;},resetThreadView:()=>calls.push('reset'),reconnectSideChat:()=>side?.(),renderStatus:()=>calls.push(['status',state.transport]),reportThreadView:async()=>{calls.push('report');},resumeWorkspace:async()=>{calls.push('resume');},recordError:(e,stage)=>calls.push(['error',e.message,stage]),receiveWebUpdate:data=>calls.push(['update',data]),handleEvent:event=>calls.push(['event',event]),...overrides};
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
 assert.deepEqual([...es.listeners.keys()],['system/update','manager/status','manager/error','manager/request','manager/requestResolved']);
 const event={data:'{"unknown":{"raw":"原文"}}',type:'message',extra:42};es.onmessage(event);
 for(const name of [...es.listeners.keys()].slice(1)){assert.equal(es.listeners.get(name),es.onmessage);es.listeners.get(name)(event);}
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
test('replacement preserves baseline transport callbacks until the caller closes the old source',async()=>{
 const f=fixture();f.setup();const old=f.sources[0];f.setup();const current=f.sources[1];current.onopen();await settle();f.calls.length=0;
 old.onerror();assert.equal(f.state.transport,false);old.onopen();await settle();
 assert.equal(f.state.eventSource,current);
 assert.deepEqual(f.calls,[['status',false],'reset',['status',true],'report','resume']);
});
