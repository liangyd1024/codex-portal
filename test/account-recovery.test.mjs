import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountRecovery,accountIdentity} from '../lib/account-recovery.mjs';
const account=(email='a@example.test',workspace='one')=>({account:{type:'chatgpt',email,planType:'plus'},workspaceRouting:{chatgptAccountId:workspace},requiresOpenaiAuth:true});
function fixture(t){
  const calls=[],events=[];let live=account(),saved=account(),stamp='one';
  const m={titleStore:null,generation:1,connection:{state:'connected'},mutations:0,startingTurns:new Set(),activeTurns:new Map(),requests:new Map(),pendingQuestions:{entries:new Map()},
    requireConnected(){assert.equal(this.connection.state,'connected');},requireWritable(){this.requireConnected();assert.ok(!this.releasing);},
    status(){return {};},saveState(){},publish(){},record(e){events.push(e.message);},setLoginRecovery(v){this.loginRecovery=v;},
    async reloadLogin(input,automatic){calls.push(['reload',input,automatic]);this.loginRecovery=null;live=saved;},
  };
  m.rpc={connected:true,async request(method,params){calls.push([method,params]);if(method==='account/read')return live;if(method==='thread/loaded/list')return {data:[]};return {};}};
  const r=new AccountRecovery(m,{read:async probe=>{calls.push([probe?'probe':'stat']);return {stamp,...(probe?{identity:saved}:{})};}});
  t.after(()=>r.stop());
  return {m,r,calls,events,set(v){if(v.live)live=v.live;if(v.saved)saved=v.saved;if(v.stamp)stamp=v.stamp;}};
}
test('native account identity excludes plan refresh and distinguishes workspaces',()=>{
  assert.equal(accountIdentity(account()),accountIdentity({...account(),account:{...account().account,planType:'pro'}}));
  assert.notEqual(accountIdentity(account()),accountIdentity(account('a@example.test','two')));
});
test('same account token-file refresh never interrupts tasks; steady state only stats metadata',async t=>{
  const f=fixture(t);await f.r.tick();f.set({stamp:'two'});await f.r.tick();
  assert.equal(f.calls.filter(c=>c[0]==='reload').length,0);
  assert.equal(f.calls.filter(c=>c[0]==='thread/loaded/list').length,0);
  f.calls.length=0;await f.r.tick();assert.deepEqual(f.calls,[['stat']]);
});
test('workspace switch and changed API key signal invoke one native recovery without message replay',async t=>{
  for(const apiKey of [false,true]){
    const f=fixture(t);if(apiKey)f.set({live:{account:{type:'apiKey'}},saved:{account:{type:'apiKey'}}});
    await f.r.tick();f.set({stamp:'two',...(!apiKey?{saved:account('a@example.test','two')}: {})});await f.r.tick();await f.r.tick();
    assert.equal(f.calls.filter(c=>c[0]==='reload').length,1);
    assert.deepEqual(f.calls.find(c=>c[0]==='reload'),['reload',{allEntrancesDisconnected:true},true]);
    assert.ok(!f.calls.some(c=>['turn/start','thread/queue/add','thread/queue/delete'].includes(c[0])));
  }
});
test('auth failure retries once per saved login generation, not on every interval',async t=>{
  const f=fixture(t);await f.r.tick();f.m.loginRecovery='expired';
  f.m.reloadLogin=async()=>{f.calls.push(['reload']);throw Error('restart uncertain');};
  await f.r.tick();await f.r.tick();assert.equal(f.calls.filter(c=>c[0]==='reload').length,1);
  f.set({stamp:'two'});f.r.nextProbeAt=0;await f.r.tick();assert.equal(f.calls.filter(c=>c[0]==='reload').length,2);
});
test('signed-out state waits for a new login and never restarts in a loop',async t=>{
  const f=fixture(t);f.set({saved:{account:null,requiresOpenaiAuth:true}});await f.r.tick();await f.r.tick();
  assert.equal(f.calls.filter(c=>c[0]==='reload').length,0);
  assert.match(f.m.loginRecovery,/完成登录后会自动加载/);
  f.set({stamp:'two',saved:account()});await f.r.tick();assert.equal(f.calls.filter(c=>c[0]==='reload').length,1);
});
test('late probe result and submitting mutation cannot restart a changed connection',async t=>{
  const f=fixture(t);f.m.mutations=1;await f.r.tick();assert.equal(f.calls.length,0);f.m.mutations=0;
  f.r.read=async probe=>{if(probe)f.m.generation++;return {stamp:'one',identity:account('b@example.test')};};await f.r.tick();
  assert.equal(f.calls.filter(c=>c[0]==='reload').length,0);
});
test('quiesce pauses active goals, interrupts native turns and terminates background commands only',async t=>{
  const f=fixture(t);const responses={
    'thread/loaded/list':{data:['a']},'thread/goal/get':{goal:{status:'active'}},
    'thread/read':{thread:{status:{type:'active'}}},
    'thread/turns/list':{data:[{id:'turn',status:'inProgress'}]},
    'thread/backgroundTerminals/list':{data:[{processId:'command'}]},
  };
  f.m.rpc.request=async(method,params)=>{f.calls.push([method,params]);return responses[method]||{};};
  await f.r.quiesce(f.m.rpc,1);
  assert.deepEqual(f.calls.map(c=>c[0]),['thread/loaded/list','thread/goal/get','thread/goal/set','thread/read','thread/turns/list','turn/interrupt','thread/backgroundTerminals/list','thread/backgroundTerminals/terminate']);
  assert.deepEqual(f.calls[2][1],{threadId:'a',status:'paused',origin:'user'});assert.equal(f.m.releasing,false);
});
test('unknown native status stops automatic maintenance instead of forcing a restart',async t=>{
  const f=fixture(t);f.m.rpc.request=async()=>({});await assert.rejects(f.r.quiesce(f.m.rpc,1),/无法确认/);assert.equal(f.m.releasing,false);
});
test('concurrent checks share one attempt and a changing probe signal is discarded',async t=>{
  const f=fixture(t);let resolve;f.r.read=()=>new Promise(r=>resolve=r);
  const first=f.r.tick();await f.r.tick();resolve({stamp:'one'});await new Promise(r=>setImmediate(r));resolve({stamp:'two',identity:account('b@example.test')});await first;
  assert.equal(f.calls.filter(c=>c[0]==='reload').length,0);assert.equal(f.r.saved,undefined);
});
test('metadata-less login is rechecked after its cooldown and can recover from logout',async t=>{
  const f=fixture(t);f.set({stamp:'absent',saved:{account:null,requiresOpenaiAuth:true}});await f.r.tick();
  f.set({saved:account()});f.r.probedAt=Date.now()-61000;await f.r.tick();assert.equal(f.calls.filter(c=>c[0]==='reload').length,1);
});

test('shared service never probes login or interrupts native work',async t=>{const f=fixture(t);f.m.service={sharedDesktop:true};await f.r.tick();assert.deepEqual(f.calls,[]);});
test('late shared activation blocks automatic quiesce before any native interruption',async t=>{const f=fixture(t);f.m.assertExclusiveService=async()=>{throw Error('shared engine')};await assert.rejects(f.r.quiesce(f.m.rpc,f.m.generation),/shared engine/);assert.deepEqual(f.calls,[]);});
