import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundActivity} from '../public/connection-state.js';

const live={controlled:true,connected:true};
const stale={turns:[{status:'completed',items:[{type:'commandExecution',status:'inProgress',command:'old preview'}]}]};
test('an empty live process list clears historical running commands after completion or stop',()=>{
  assert.deepEqual(backgroundActivity({...stale,backgroundTerminals:{data:[]}},live),{state:'idle',terminals:[]});
});
test('a background server remains visible after the conversation turn completes',()=>{
  const terminals=[{processId:'123',command:'preview server'}];
  assert.deepEqual(backgroundActivity({...stale,backgroundTerminals:{data:terminals}},live),{state:'running',terminals});
});
test('failed reads and disconnects are unknown, never proof that a command is running or stopped',()=>{
  for(const detail of [stale,{backgroundTerminals:{}},{backgroundTerminals:{data:[],error:'timeout'}},{backgroundTerminals:{data:[{processId:'123'}],error:'timeout'}}]){
    assert.equal(backgroundActivity(detail,live).state,'unknown');
  }
  assert.equal(backgroundActivity({backgroundTerminals:{data:[{processId:'123'}]}},{...live,connected:false}).state,'unknown');
  assert.equal(backgroundActivity({...stale,backgroundTerminals:{data:[]}},live).state,'idle');
});
test('switching to a different or released conversation never carries over running state',()=>{
  assert.equal(backgroundActivity({turns:[]},live).state,'idle');
  assert.equal(backgroundActivity(stale,{connected:true,controlled:false}).state,'idle');
});
