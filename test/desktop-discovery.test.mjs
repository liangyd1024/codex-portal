import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshDesktopDiscovery} from '../lib/desktop-discovery.mjs';
function fixture(){
 const calls=[],errors=[],m={rpc:{connected:true},generation:0,titleJobs:new Map(),remote:async(...args)=>{calls.push(args);return {status:'notified'};},record:(...args)=>errors.push(args)};
 return {m,calls,errors};
}
test('discovery waits for title before sending native cache hint',async()=>{
 const {m,calls}=fixture();let resolve;m.titleJobs.set('t',new Promise(r=>resolve=r));
 const work=refreshDesktopDiscovery(m,'t');await Promise.resolve();assert.equal(calls.length,0);resolve();
 assert.equal((await work).status,'notified');assert.equal(calls.length,1);assert.match(calls[0][0],/query-cache-invalidate/);
});
test('persistence lag retries only read and cache notification',async()=>{
 const {m,calls}=fixture();let attempts=0;m.remote=async()=>{calls.push(1);return {status:++attempts<3?'pendingPersistence':'notified'};};
 await refreshDesktopDiscovery(m,'t',{delays:[0,1,1],wait:async()=>{}});assert.equal(calls.length,3);
});
test('disconnection and changed generation cancel delayed discovery',async()=>{
 for(const change of [m=>m.generation++,m=>m.rpc.connected=false]){
  const {m,calls}=fixture();m.remote=async()=>{calls.push(1);return {status:'pendingPersistence'};};
  await refreshDesktopDiscovery(m,'t',{delays:[0,1],wait:async()=>change(m)});assert.equal(calls.length,1);
 }
});
test('closed desktop is normal; errors and exhaustion are diagnostic only',async()=>{
 const a=fixture();a.m.remote=async()=>({status:'notRunning'});await refreshDesktopDiscovery(a.m,'t');assert.equal(a.errors.length,0);
 for(const remote of [async()=>{throw Error('timeout');},async()=>({status:'pendingPersistence'})]){
  const {m,errors}=fixture();m.remote=remote;await refreshDesktopDiscovery(m,'t',{delays:[0]});assert.equal(errors.length,1);assert.deepEqual(errors[0][2],{diagnosticOnly:true});
 }
});

test('manager hints once after first accepted message; failed sends do not consume it',async()=>{
 const {Manager}=await import('../lib/manager.mjs');
 let sends=0,notifies=0,resolve;const done=new Promise(r=>resolve=r);
 const m=new Manager({host:{alias:'test'},remote:async()=>{notifies++;resolve();return {status:'notified'};}});
 m.connection.state='connected';m.rpc={connected:true,request:async(method)=>{
  if(method==='account/read')return {};
  if(method==='thread/start')return {thread:{id:'t',status:{type:'idle'}}};
  if(method==='thread/name/set')return {};
  if(method==='turn/start'){if(++sends===1)throw Error('send failed');return {turn:{id:'turn'+sends,status:'completed'}};}
  throw Error(method);
 }};
 await m.newThread({cwd:'/project',name:'Explicit title'});
 await assert.rejects(m.message('t',{text:'first'}),/send failed/);assert.equal(notifies,0);assert.ok(m.pendingDiscovery.has('t'));
 await m.message('t',{text:'retry'});await done;assert.equal(notifies,1);
 await m.message('t',{text:'follow up'});assert.equal(notifies,1);
});
