import test from 'node:test';
import assert from 'node:assert/strict';
import {updateExtensionNotice} from '../public/connection-state.js';
import {Manager} from '../lib/manager.mjs';
test('every extension initializes silently; failures remain diagnostic and never change task state',()=>{
 for(const name of ['codex_apps','cua_repl','node_repl','custom']){
  const state=new Map([['a',new Map([['stale',{status:'starting'}]])]]),m=new Manager({host:{alias:'test'}}),events=[];
  m.controlled.set('a',{status:{type:'active'}});m.activeTurns.set('a','turn');m.on('event',e=>events.push(e));
  for(const status of ['starting','failed','ready','cancelled']){
   const params={threadId:'a',name,status,error:status==='failed'?{message:'tools/list timeout'}:null};
   updateExtensionNotice(state,params);m.onNotification({method:'mcpServer/startupStatus/updated',params});
  }
  assert.equal(state.size,0);assert.equal(m.status().errors.length,1);assert.equal(m.status().errors[0].diagnosticOnly,true);
  assert.equal(m.status().errors[0].message,'tools/list timeout');assert.ok(m.status().errors[0].stage.includes(name));assert.equal(m.activeTurns.get('a'),'turn');
  assert.equal(m.controlled.get('a').status.type,'active');
  const failure={method:'item/completed',params:{threadId:'a',turnId:'turn',item:{id:'tool',type:'mcpToolCall',status:'failed',error:{message:'tool unavailable'}}}};
  m.onNotification(failure);assert.deepEqual(events.at(-1),failure);
 }
});
test('startup event cleanup stays scoped to its thread',()=>{
 const state=new Map([['a',new Map()],['b',new Map()]]);updateExtensionNotice(state,{threadId:'a',name:'cua_repl',status:'ready'});
 assert.equal(state.has('a'),false);assert.equal(state.has('b'),true);updateExtensionNotice(state,{});assert.equal(state.has('b'),true);
});
