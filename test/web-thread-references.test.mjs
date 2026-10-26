import test from 'node:test';
import assert from 'node:assert/strict';
import {ThreadReferences,validateReferences,referenceContext} from '../lib/thread-references.mjs';
const caller='00000000-0000-0000-0000-000000000001',target='00000000-0000-0000-0000-000000000002',scope='00000000-0000-0000-0000-000000000003';
function fixture({configured=true,busy=false}={}){
 const calls=[],writes=[];let loaded=true,configuredNow=configured;
 const m={mutations:0,generation:1,activeTurns:new Map(),startingTurns:new Set(),controlled:new Map([[caller,{}]]),service:{threadUnloadDelaySecs:1},requireCapability(){},publish(){},status(){return {}},rememberControl(r){this.controlled.set(r.thread.id,{});},
  passive:async()=>({thread:{id:target,name:'原生标题'}}),rpc:{connected:true,request:async(method,p)=>{calls.push({method,p});if(method==='mcpServerStatus/list')return {data:configuredNow?[{name:'rcm_references',runtimeStatus:'connected',serverInfo:{name:'rcm-native-references',version:'1:'+scope},tools:{read_referenced_thread:{}}}]:[]};if(method==='thread/read')return {thread:{id:caller,status:{type:busy?'active':'idle'}}};if(method==='thread/goal/get')return {goal:null};if(method==='thread/unsubscribe'){loaded=false;return {status:'unsubscribed'}}if(method==='thread/resume'){configuredNow=!!p.config;return {thread:{id:caller,status:{type:'idle'}}}}return {data:[]};}}};
 m.handoffs={loaded:async()=>new Set(loaded?[caller]:[]),localBlockers:()=>[]};
 const r=new ThreadReferences(m);r.storage=async(s,c,ids)=>{writes.push({scope:s,caller:c,allowed:ids});return {command:'test-only'};};r.create=async()=>({scope,config:{'mcp_servers.rcm_references':{command:'test-only'}}});return {r,m,calls,writes};
}
test('web references authorize native IDs and send metadata separately from original user input',async()=>{
 const {r,calls,writes}=fixture();const refs=await r.prepare(caller,[target,target]);assert.deepEqual(refs,[{threadId:target,title:'原生标题'}]);assert.deepEqual(writes,[{scope,caller,allowed:[target]}]);assert.equal(calls.some(c=>c.method==='thread/unsubscribe'),false);
 const context=referenceContext(refs);assert.equal(context['rcm.threadReferences'].kind,'application');assert.match(context['rcm.threadReferences'].value,/read_referenced_thread/);assert.match(context['rcm.threadReferences'].value,/untrusted/);assert.deepEqual(referenceContext([]),{});
});
test('an idle existing web conversation enables the tool through native unsubscribe and resume with the same ID',async()=>{
 const {r,m,calls}=fixture({configured:false});await r.prepare(caller,[target]);assert.equal(m.controlled.has(caller),true);
 const changes=calls.filter(c=>['thread/unsubscribe','thread/resume'].includes(c.method));assert.deepEqual(changes.map(c=>c.method),['thread/unsubscribe','thread/resume']);assert.ok(changes.every(c=>c.p.threadId===caller));assert.ok(changes[1].p.config);assert.equal(m.mutations,0);
});
test('an unloaded web conversation is resumed with reference configuration before asking for MCP status',async()=>{
 const {r,m,calls}=fixture({configured:false});m.handoffs.loaded=async()=>new Set();const request=m.rpc.request;
 let resumed=false;m.rpc.request=async(method,p)=>{if(method==='mcpServerStatus/list'&&!resumed)throw Error('thread not found');if(method==='thread/resume')resumed=true;return request(method,p);};
 await r.prepare(caller,[target]);assert.equal(calls[0].method,'thread/resume');assert.ok(calls[0].p.config);assert.equal(calls.some(c=>c.method==='thread/unsubscribe'),false);
});
test('busy tasks, queued work, unknown state and long native unload delays never get interrupted',async()=>{
 for(const variation of ['running','goal','queue','delay','unknown']){
  const {r,m,calls}=fixture({configured:false,busy:variation==='running'}),request=m.rpc.request;
  if(variation==='delay')m.service.threadUnloadDelaySecs=1800;
  m.rpc.request=async(method,p)=>variation==='goal'&&method==='thread/goal/get'?{goal:{status:'active'}}:variation==='queue'&&method==='thread/queue/list'?{data:[{}]}:variation==='unknown'&&method==='thread/goal/get'?{}:request(method,p);
  await assert.rejects(r.prepare(caller,[target]));assert.equal(calls.some(c=>c.method==='thread/unsubscribe'),false);assert.equal(m.mutations,0);
 }
});
test('invalid, self and archived references fail before native context or capability writes',async()=>{
 for(const ids of [null,[caller],['bad'],Array(21).fill(target)])assert.throws(()=>validateReferences(ids,caller));
 const {r,m,writes}=fixture();m.passive=async()=>({thread:{archived:true}});await assert.rejects(r.prepare(caller,[target]));assert.deepEqual(writes,[]);
});
test('concurrent setup and late replies after connection changes cannot authorize a new connection',async()=>{
 const {r,m,writes}=fixture();let resolve;m.passive=()=>new Promise(r=>resolve=r);const one=r.prepare(caller,[target]);await assert.rejects(r.prepare(caller,[target]),e=>e.code==='SEND_PENDING');m.generation++;resolve({thread:{id:target}});await assert.rejects(one,e=>e.code==='CONNECTION_CHANGED');assert.deepEqual(writes,[]);assert.equal(m.mutations,0);
});
test('failed reload restores the same web subscription but does not invent reference support',async()=>{
 const {r,m,calls}=fixture({configured:false}),request=m.rpc.request;
 m.rpc.request=async(method,p)=>{if(method==='thread/resume'&&p.config)throw Error('MCP unavailable');return request(method,p);};
 await assert.rejects(r.prepare(caller,[target]),/MCP unavailable/);assert.ok(calls.some(c=>c.method==='thread/resume'&&!c.p.config));assert.equal(m.controlled.has(caller),true);
});
test('running reference preparation only authorizes an already connected tool',async()=>{
 for(const configured of [true,false]){
  const {r,m,calls,writes}=fixture({configured,busy:true});m.activeTurns.set(caller,'turn-active');
  if(configured){await r.prepare(caller,[target],{allowReload:false});assert.equal(writes.length,1);}
  else {await assert.rejects(r.prepare(caller,[target],{allowReload:false}),e=>e.code==='THREAD_REFERENCES_UNAVAILABLE');assert.equal(writes.length,0);}
  assert.deepEqual(calls.map(c=>c.method),['mcpServerStatus/list']);assert.equal(m.activeTurns.get(caller),'turn-active');
 }
});

test('legacy MCP lookup pages the native inventory and verifies the exact reference server',async()=>{
 const {r,m,calls}=fixture();const request=m.rpc.request;
 m.service.protocolValidation={optionalParams:{'mcpServerStatus/list':{serverName:false}}};
 m.rpc.request=async(method,p)=>{
  if(!p.cursor){calls.push({method,p});return {data:[{name:'other',runtimeStatus:'connected'}],nextCursor:'page-2'};}
  return request(method,p);
 };
 assert.equal(await r.current(caller),scope);
 assert.deepEqual(calls.map(c=>c.p),[{threadId:caller,detail:'full',limit:100},{threadId:caller,detail:'full',limit:100,cursor:'page-2'}]);
});
test('modern MCP lookup keeps the native server filter and does not request extra pages',async()=>{
 const {r,calls}=fixture();assert.equal(await r.current(caller),scope);assert.equal(calls.length,1);assert.equal(calls[0].p.serverName,'rcm_references');
});
test('MCP pagination fails closed on repeated cursors, invalid lists and changed connections',async()=>{
 for(const scenario of ['cycle','invalid','connection','endless']){
  const {r,m}=fixture();let count=0;
  m.rpc.request=async()=>{count++;if(scenario==='connection')m.generation++;return scenario==='invalid'?{}:{data:[],nextCursor:scenario==='endless'?String(count):'same'};};
  await assert.rejects(r.current(caller));assert.ok(count<=20);
 }
});

test('legacy pagination shares one timeout budget instead of extending it per page',async t=>{
 const {r,m}=fixture();let calls=0;t.mock.timers.enable({apis:['Date']});
 m.rpc.request=async(_method,_params,options)=>{calls++;assert.equal(options.timeoutMs,15000);t.mock.timers.tick(15001);return {data:[],nextCursor:'next'};};
 await assert.rejects(r.current(caller),/未完整读取/);assert.equal(calls,1);
});
