import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';

test('protocol list uses desktop interactive defaults and resolves legacy membership',async()=>{
  const m=new Manager({host:{alias:'test'}});m.connection={state:'connected'};
  m.rpc={connected:true,async request(method,params){assert.equal(method,'thread/list');assert.deepEqual(params.sourceKinds,[]);return {data:[{id:'chat',cwd:'/old',projectId:null},{id:'ambient',threadSource:'ambient_suggestions'},{id:'ephemeral',ephemeral:true}],nextCursor:'next'};}};
  m.passive=async(action,payload)=>{assert.equal(action,'sidebarMetadata');assert.deepEqual(payload.threadIds,['chat','ambient','ephemeral']);return {data:{chat:{projectId:'registered'}}};};
  const result=await m.threads();assert.deepEqual(result.data,[{id:'chat',cwd:'/old',projectId:'registered'}]);assert.equal(result.nextCursor,'next');
});
test('timeout fallback and snapshot pagination retain the same list contract',async()=>{
  const m=new Manager({host:{alias:'test'}});m.connection={state:'connected'};
  let requests=0;m.rpc={connected:true,async request(){requests++;throw Error('timeout');}};
  m.passive=async(action,payload)=>{assert.equal(action,'threads');return {data:[{id:'chat',projectId:'registered'}],historySource:'snapshot',nextCursor:payload.cursor?null:'db:50'};};
  const first=await m.threads();const second=await m.threads({cursor:first.nextCursor});
  assert.equal(requests,1);assert.equal(first.data[0].projectId,'registered');assert.equal(second.nextCursor,null);
});
