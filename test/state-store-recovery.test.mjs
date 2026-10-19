import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
function manager(request=async()=>({data:[]})){
 const m=new Manager({host:{alias:'test'}});m.service.protocolValidation={policy:6,unsupportedMethods:[]};m.rpc={connected:true,request};return m;
}
const unavailable=()=>Error('unable to open database file');
test('state store recovery uses native list and retries the original read once',async()=>{
 let calls=0,reads=0;const m=manager(async(method,params)=>{calls++;assert.equal(method,'thread/list');assert.equal(params.useStateDbOnly,true);assert.equal(params.limit,1);return {data:[]};});
 const result=await m.readStateSnapshot(async()=>{if(++reads===1)throw unavailable();return {data:['project']};});
 assert.deepEqual(result,{data:['project']});assert.equal(reads,2);assert.equal(calls,1);
});
test('persistent failure is surfaced without looping or using a stale snapshot',async()=>{
 let reads=0,calls=0;const m=manager(async()=>{calls++;});
 await assert.rejects(m.readStateSnapshot(async()=>{reads++;throw unavailable();}),/unable to open/);assert.equal(reads,2);assert.equal(calls,1);
});
test('unrelated failures, disconnected and unsupported native APIs are not retried',async()=>{
 for(const scenario of ['other','disconnected','unsupported','unvalidated']){
  const m=manager(async()=>assert.fail('unexpected RPC'));if(scenario==='disconnected')m.rpc.connected=false;if(scenario==='unsupported')m.service.protocolValidation.unsupportedMethods=['thread/list'];if(scenario==='unvalidated')delete m.service.protocolValidation;
  let reads=0;await assert.rejects(m.readStateSnapshot(async()=>{reads++;throw scenario==='other'?Error('permission denied'):unavailable();}));assert.equal(reads,1);
 }
});
test('concurrent failed reads share recovery and connection changes suppress retry',async()=>{
 let release,calls=0,reads=0;const m=manager(()=>{calls++;return new Promise(r=>release=r);});
 const read=()=>m.readStateSnapshot(async()=>{reads++;throw unavailable();});const a=read(),b=read();
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);m.generation++;release({data:[]});
 const results=await Promise.allSettled([a,b]);assert.ok(results.every(r=>r.status==='rejected'&&r.reason.code==='CONNECTION_CHANGED'));assert.equal(reads,2);
});
test('native failure surfaces and a later refresh can try again',async()=>{
 let calls=0;const m=manager(async()=>{calls++;throw Error('native timeout');});
 for(let i=0;i<2;i++)await assert.rejects(m.readStateSnapshot(async()=>{throw unavailable();}),/native timeout/);assert.equal(calls,2);
});
test('projects and sidebar reads use recovery, service lifecycle calls never do',async()=>{
 for(const action of ['projects','sidebar','ensure']){
  let reads=0,calls=0;const m=manager(async()=>{calls++;});m.remote=async()=>{if(++reads===1)throw unavailable();return {data:[]};};
  if(action==='ensure'){await assert.rejects(m.serviceAction(action),/unable to open/);assert.equal(calls,0);}
  else{await(action==='projects'?m.serviceAction(action):m.passive(action));assert.equal(calls,1);assert.equal(reads,2);}
 }
});
