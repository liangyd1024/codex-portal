import test from 'node:test';
import assert from 'node:assert/strict';
import {updateExtensionNotice} from '../public/connection-state.js';
import {Manager} from '../lib/manager.mjs';
test('startup failures are scoped to threads, and ready clears an unselected thread',()=>{
 const state=new Map();
 const event={threadId:'a',name:'custom',status:'failed',error:{message:'timed out awaiting tools/list after 30s'}};
 updateExtensionNotice(state,event);updateExtensionNotice(state,{...event,threadId:'b'});
 assert.match(state.get('a').get('custom').summary,/扩展 custom连接超时/);
 assert.equal(state.get('a').get('custom').detail,event.error.message);
 updateExtensionNotice(state,{...event,status:'ready'});
 assert.equal(state.has('a'),false);assert.equal(state.has('b'),true);
});
test('apps startup is silent while failure remains in diagnostics and tool errors pass through',()=>{
 const state=new Map(),m=new Manager({host:{alias:'test'}}),events=[];
 m.controlled.set('a',{status:{type:'active'}});m.activeTurns.set('a','turn');
 m.on('event',event=>events.push(event));
 for(const status of ['starting','failed','ready','cancelled']){
  const params={threadId:'a',name:'codex_apps',status,error:status==='failed'?{message:'timed out awaiting tools/list after 30s'}:null};
  updateExtensionNotice(state,params);m.onNotification({method:'mcpServer/startupStatus/updated',params});
 }
 assert.equal(state.size,0);
 assert.equal(m.status().errors.length,1);
 assert.equal(m.status().errors[0].message,'timed out awaiting tools/list after 30s');
 assert.match(m.status().errors[0].stage,/后台初始化 · a/);
 assert.equal(m.status().errors[0].diagnosticOnly,true);
 assert.equal(m.activeTurns.get('a'),'turn');
 assert.equal(m.controlled.get('a').status.type,'active');
 const failure={method:'item/completed',params:{threadId:'a',turnId:'turn',item:{id:'tool',type:'mcpToolCall',status:'failed',error:{message:'tool unavailable'}}}};
 m.onNotification(failure);
 assert.deepEqual(events.at(-1),failure);
});
test('restart replaces stale failure, cancellation clears, unknown events do not erase failures',()=>{
 const state=new Map(),event={threadId:'a',name:'custom',status:'failed',error:'denied'};
 updateExtensionNotice(state,event);updateExtensionNotice(state,{...event,status:'unknown'});
 assert.match(state.get('a').get('custom').summary,/启动失败/);
 updateExtensionNotice(state,{...event,status:'starting'});
 assert.equal(state.get('a').get('custom').detail,'');
 updateExtensionNotice(state,{...event,status:'cancelled'});assert.equal(state.size,0);
 updateExtensionNotice(state,{...event,threadId:undefined});assert.equal(state.size,0);
});
