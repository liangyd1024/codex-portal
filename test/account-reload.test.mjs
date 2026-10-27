import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
function fixture(overrides={}){
 const m=new Manager({host:{id:'test'}}),calls=[];
 m.connection.state='connected';m.service={protocolValidation:{features:{release:{supported:true}}}};
 m.rpc={connected:true,request:async(method,params)=>{
  calls.push([method,params]);if(overrides[method])return overrides[method](params);
  if(method==='thread/loaded/list')return {data:['idle']};
  if(method==='thread/read')return {thread:{status:{type:'idle'}}};
  if(method==='thread/goal/get')return {goal:null};
  return {data:[]};
 },close(){}};
 m.serviceAction=async action=>{calls.push([action]);return {running:true,sharedDesktop:false};};
 m.connect=async()=>{calls.push(['connect']);m.connection.state='connected';m.rpc={connected:true,request:async()=>({account:{type:'apiKey'}})};};
 return {m,calls};
}
test('account recovery is opt-in and is not enabled by copied preview configuration',()=>{
 const host={id:'test',autoReloadLogin:'interrupt'};
 assert.equal(new Manager({host}).accountRecovery,null);
 assert.equal(new Manager({host:{id:'test'},enableAccountRecovery:true}).accountRecovery,null);
 const m=new Manager({host,enableAccountRecovery:true});assert.ok(m.accountRecovery);assert.equal(m.accountRecovery.timer,undefined);
 m.setLoginRecovery('请重新加载登录');assert.match(m.loginRecovery,/自动加载/);
});
test('login reload requires explicit confirmation and never runs during active or unknown work',async()=>{
 const first=fixture();await assert.rejects(first.m.reloadLogin(),e=>e.code==='MAINTENANCE_CONFIRMATION_REQUIRED');assert.equal(first.calls.length,0);
 for(const overrides of [
  {'thread/read':()=>({thread:{status:{type:'active'}}})},
  {'thread/read':()=>({thread:{status:{type:'unknown'}}})},
  {'thread/goal/get':()=>({goal:{status:'active'}})},
  {'thread/backgroundTerminals/list':()=>({data:[{}]})},
  {'thread/queue/list':()=>({data:[{}]})},
  {'thread/loaded/list':()=>({})},
 ]){const {m,calls}=fixture(overrides);await assert.rejects(m.reloadLogin({allEntrancesDisconnected:true}));assert.equal(calls.some(([method])=>method==='reload-login'),false);}
});
test('login reload checks later loaded pages and refuses a busy second page',async()=>{
 const {m,calls}=fixture({'thread/loaded/list':p=>p.cursor?{data:['busy']}:{data:['idle'],nextCursor:'next'},'thread/read':p=>({thread:{status:{type:p.threadId==='busy'?'active':'idle'}}})});
 await assert.rejects(m.reloadLogin({allEntrancesDisconnected:true}),e=>e.code==='SERVICE_BUSY');assert.equal(calls.some(([method])=>method==='reload-login'),false);
});
test('idle login reload restarts only the dedicated engine and does not replay input',async()=>{
 const {m,calls}=fixture();const events=[];m.on('event',e=>events.push(e));
 assert.deepEqual(await m.reloadLogin({allEntrancesDisconnected:true}),{ok:true});
 assert.equal(calls.filter(([method])=>method==='reload-login').length,1);assert.equal(calls.some(([method])=>method==='turn/start'),false);
 assert.ok(events.some(e=>e.method==='account/updated'&&e.params.authMode==='apiKey'));assert.equal(m.releasing,false);
});
test('automatic reload preserves native queue only for an explicitly enabled policy',async()=>{
 for(const enabled of [false,true]){
  const {m,calls}=fixture({'thread/queue/list':()=>({data:[{id:'queued'}]})});
  m.expectedHost.autoReloadLogin=enabled?'interrupt':'off';
  if(enabled)await m.reloadLogin({allEntrancesDisconnected:true},true);
  else await assert.rejects(m.reloadLogin({allEntrancesDisconnected:true},true),e=>e.code==='SERVICE_BUSY');
  assert.equal(calls.some(([method])=>method==='reload-login'),enabled);
  assert.ok(!calls.some(([method])=>['thread/queue/delete','thread/queue/start','turn/start'].includes(method)));
 }
});
test('failed native restart is not automatically repeated or reported as success',async()=>{
 const {m}=fixture();let calls=0;m.serviceAction=async()=>{calls++;throw Error('restart result unknown');};
 await assert.rejects(m.reloadLogin({allEntrancesDisconnected:true}),/result unknown/);assert.equal(calls,1);assert.equal(m.releasing,false);
});
test('auth-failed thread can recover only after native turns confirm terminal history',async()=>{
 for(const status of ['failed','inProgress',undefined]){
  const {m,calls}=fixture({'thread/read':()=>({thread:{status:{type:'systemError'}}}),'thread/turns/list':()=>({data:[{status}]})});
  if(status==='failed')await m.reloadLogin({allEntrancesDisconnected:true});
  else await assert.rejects(m.reloadLogin({allEntrancesDisconnected:true}),e=>e.code==='SERVICE_BUSY');
  assert.equal(calls.some(([method])=>method==='reload-login'),status==='failed');
 }
});
test('invalid login blocks new submissions while keeping recovery available',async()=>{
 const {m,calls}=fixture();m.onNotification({method:'error',params:{error:{message:'token_revoked'}}});
 assert.ok(m.status().loginRecovery);
 await assert.rejects(m.newThread({cwd:'/tmp'}),e=>e.code==='LOGIN_REQUIRED');
 await assert.rejects(m.message('idle',{text:'draft'}),e=>e.code==='LOGIN_REQUIRED');
 await assert.rejects(m.steer('idle',{text:'draft'}),e=>e.code==='LOGIN_REQUIRED');
 assert.equal(calls.length,0);
 await m.reloadLogin({allEntrancesDisconnected:true});assert.equal(m.status().loginRecovery,null);
});
test('startup identity notification retries only reads after one native restart',async()=>{
 const {m,calls}=fixture();let reads=0;
 m.connect=async()=>{m.connection.state='connected';m.rpc={connected:true,request:async()=>{reads++;if(reads===1)m.onNotification({method:'account/updated',params:{authMode:'apiKey'}});return {account:{type:'apiKey'}};}};};
 await m.reloadLogin({allEntrancesDisconnected:true});
 assert.equal(reads,2);assert.equal(calls.filter(([method])=>method==='reload-login').length,1);
});
test('unstable post-restart identity tells the user to refresh without repeating restart',async()=>{
 const {m,calls}=fixture();let reads=0;
 m.connect=async()=>{m.connection.state='connected';m.rpc={connected:true,request:async()=>{reads++;m.onNotification({method:'account/updated',params:{authMode:'apiKey'}});return {account:{type:'apiKey'}};}};};
 await assert.rejects(m.reloadLogin({allEntrancesDisconnected:true}),e=>e.code==='LOGIN_READ_UNCONFIRMED');
 assert.equal(reads,3);assert.equal(calls.filter(([method])=>method==='reload-login').length,1);
});
