import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {NewChatDraft} from '../public/new-chat.js';
function fixture(read,start){
 const calls=[],m=new Manager({host:{alias:'test'}});m.connection.state='connected';
 m.rpc={connected:true,request:async(method,params)=>{calls.push(method);if(method==='account/read')return read();if(method==='thread/start')return start?start():{thread:{id:'routing-test',status:{type:'idle'}}};throw Error(method);}};
 return {m,calls};
}
const timeout=()=>Object.assign(Error('workspace routing discovery timed out'),{code:-32603});
test('routing discovery transient failure retries only reads before creating exactly once',async()=>{
 let reads=0;const {m,calls}=fixture(()=>{if(++reads===1)throw timeout();return {};});
 assert.equal((await m.newThread({cwd:'/project'})).thread.id,'routing-test');
 assert.deepEqual(calls,['account/read','account/read','thread/start']);
});
test('failed read preflight does not create and leaves the draft retryable',async()=>{
 for(const error of [timeout(),Object.assign(Error('account/read timed out'),{code:'RPC_TIMEOUT'})]){
  const {m,calls}=fixture(()=>{throw error;});let failure;
  await assert.rejects(m.newThread({cwd:'/project'}),e=>{failure=e;return e.code==='WORKSPACE_ROUTING_UNAVAILABLE'&&e.status===503;});
  assert.deepEqual(calls,['account/read','account/read']);
  const draft=new NewChatDraft({getItem:()=>null,setItem(){}},'test');draft.begin();draft.failed(failure);assert.equal(draft.phase,'editing');
 }
});
test('auth failures and changed connections never create or retry a mutation',async()=>{
 const a=fixture(()=>{throw Error('unauthorized');});await assert.rejects(a.m.newThread({cwd:'/project'}),/unauthorized/);assert.deepEqual(a.calls,['account/read']);
 const b=fixture(()=>{b.m.generation++;return {};});await assert.rejects(b.m.newThread({cwd:'/project'}),e=>e.code==='CREATE_NOT_STARTED');assert.deepEqual(b.calls,['account/read']);
});
test('routing failure returned by thread/start remains uncertain and is never replayed',async()=>{
 const {m,calls}=fixture(()=>({}),()=>{throw timeout();});let failure;
 await assert.rejects(m.newThread({cwd:'/project'}),e=>{failure=e;return e.code==='OUTCOME_UNKNOWN'&&/工作区路由/.test(e.message);});
 assert.deepEqual(calls,['account/read','thread/start']);
 const draft=new NewChatDraft({getItem:()=>null,setItem(){}},'test');draft.begin();draft.failed(failure);assert.equal(draft.phase,'uncertain');
});
