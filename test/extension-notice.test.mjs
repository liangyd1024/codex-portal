import test from 'node:test';
import assert from 'node:assert/strict';
import {updateExtensionNotice} from '../public/connection-state.js';
test('startup failures are scoped to threads, and ready clears an unselected thread',()=>{
 const state=new Map();
 const event={threadId:'a',name:'codex_apps',status:'failed',error:{message:'timed out awaiting tools/list after 30s'}};
 updateExtensionNotice(state,event);updateExtensionNotice(state,{...event,threadId:'b'});
 assert.match(state.get('a').get('codex_apps').summary,/应用连接器连接超时/);
 assert.equal(state.get('a').get('codex_apps').detail,event.error.message);
 updateExtensionNotice(state,{...event,status:'ready'});
 assert.equal(state.has('a'),false);assert.equal(state.has('b'),true);
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
