import test from 'node:test';
import assert from 'node:assert/strict';
import {createWithDesktop,releaseForDesktop} from '../lib/desktop-execution.mjs';

function fixture(){
 const calls=[],subscriptions=new Map(),controlled=new Map();
 const detail={thread:{id:'test',status:{type:'idle'}},controlled:false,controlState:'desktop',desktop:{canSend:true,settings:{model:'model',reasoningEffort:'high'}}};
 const m={host:{kind:'local'},generation:1,mutations:0,subscriptions,controlled,
  service:{threadUnloadDelaySecs:5,protocolValidation:{features:{handoff:{supported:true}}}},
  rpc:{connected:true,request:async(method,params)=>{calls.push([method,params]);return {}; }},
  newThread:async(params,options)=>{calls.push(['create',params,options]);controlled.set('test',{});return {thread:{id:'test'},controlled:true};},
  handoff:async id=>{calls.push(['handoff',id]);controlled.delete(id);subscriptions.set(id,{handoff:{state:'waiting'}});},
  handoffs:{entries:()=>[...subscriptions].map(([threadId,v])=>({threadId,...v.handoff})),refresh:async()=>{calls.push(['refresh']);subscriptions.set('test',{handoff:{state:'released'}});}},
  record:(error)=>calls.push(['error',error.message]),
 };
 const session={recover:async()=>{calls.push(['recover']);return detail;},detail:async()=>detail,updateSettings:async params=>{calls.push(['settings',params]);}};
 const options={available:async()=>true,release:async(m,id)=>{calls.push(['release',id]);m.controlled.delete(id);subscriptions.set(id,{handoff:{state:'released'}});}};
 return {calls,m,session,detail,options,create:input=>createWithDesktop(m,{cwd:'/project',model:'model',effort:'high',preferDesktop:true,...input},()=>session,options)};
}
test('desktop creation releases exactly the created thread before recovering the same native identity',async()=>{
 const f=fixture(),result=await f.create({name:'测试标题'});
 assert.equal(result.thread.id,'test');assert.equal(result.controlled,false);assert.equal(result.creationReady,true);
 assert.deepEqual(f.calls.map(c=>c[0]),['create','thread/name/set','release','recover']);
 assert.equal(f.calls[0][2].desktop,true);assert.equal(f.m.mutations,0);
});
test('absent desktop, explicit web path and SSH retain the existing creation path without handoff',async()=>{
 for(const mode of ['absent','web','ssh','unsupported']){
  const f=fixture();let probes=0;f.options.available=async()=>{probes++;return false;};
  if(mode==='ssh')f.m.host.kind='ssh';if(mode==='unsupported')f.m.service.protocolValidation.features.handoff.supported=false;
  const result=await f.create(mode==='web'?{preferDesktop:false}:{});
  assert.equal(result.controlled,true);assert.deepEqual(f.calls.map(c=>c[0]),['create']);
  assert.equal(probes,mode==='absent'?1:0);assert.equal(f.calls[0][1].desktop,undefined);
 }
});
test('unconfirmed desktop availability and failed native creation never fall back or retry',async()=>{
 const a=fixture();a.options.available=async()=>{throw Error('IPC unavailable');};await assert.rejects(a.create(),/IPC/);assert.equal(a.calls.length,0);
 const b=fixture();b.m.newThread=async()=>{b.calls.push(['create']);throw Error('unknown outcome');};await assert.rejects(b.create(),/unknown/);assert.equal(b.calls.length,1);assert.equal(b.m.mutations,0);
});
test('handoff failures return the known thread and preserve the draft without enabling desktop sends',async()=>{
 for(const phase of ['before-release','waiting','released']){
  const f=fixture();f.options.release=async(m,id)=>{if(phase!=='before-release'){m.controlled.delete(id);m.subscriptions.set(id,{handoff:{state:phase}});}throw Error('handoff incomplete');};
  const result=await f.create();assert.equal(result.thread.id,'test');assert.equal(result.creationReady,false);assert.match(result.creationError,/incomplete/);
  assert.equal(result.controlState,phase==='released'?'desktop':'viewing');assert.equal(result.desktop?.canSend,phase==='released'?false:undefined);
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.calls.some(c=>c[0]==='recover'),false);assert.equal(f.m.mutations,0);
 }
});
test('changed connections never recover another engine and missing desktop replies never enable sending',async()=>{
 const a=fixture();a.options.release=async()=>{a.m.generation++;};const changed=await a.create();assert.equal(changed.creationReady,false);assert.equal(a.calls.some(c=>c[0]==='recover'),false);
 const b=fixture();b.session.recover=async()=>{throw Error('desktop closed');};const closed=await b.create();assert.equal(closed.controlState,'desktop');assert.equal(closed.desktop.canSend,false);assert.equal(closed.creationReady,false);
});
test('selected model settings are applied through the existing native desktop operation',async()=>{
 const f=fixture();f.detail.desktop.settings={model:'previous',reasoningEffort:'medium'};await f.create();
 assert.deepEqual(f.calls.find(c=>c[0]==='settings')[1],{threadId:'test',model:'model',effort:'high',expected:{model:'previous',reasoningEffort:'medium'}});
 const omitted=fixture();omitted.detail.desktop.settings={model:'previous',reasoningEffort:'medium'};await omitted.create({effort:undefined});
 assert.equal(omitted.calls.find(c=>c[0]==='settings')[1].effort,'medium');
});
test('release waits for native unload evidence with bounded reads and never restarts or interrupts',async()=>{
 const f=fixture(),waits=[];await releaseForDesktop(f.m,'test',{wait:async ms=>waits.push(ms)});
 assert.deepEqual(waits,[5250]);assert.deepEqual(f.calls.map(c=>c[0]),['handoff','refresh']);
 const long=fixture();long.m.service.threadUnloadDelaySecs=1800;
 await assert.rejects(releaseForDesktop(long.m,'test',{wait:async()=>assert.fail('must not wait')}),e=>e.code==='HANDOFF_PENDING');
 assert.deepEqual(long.calls.map(c=>c[0]),['handoff']);
 const changed=fixture();await assert.rejects(releaseForDesktop(changed.m,'test',{wait:async()=>{changed.m.generation++;}}),e=>e.code==='CONNECTION_CHANGED');
});
