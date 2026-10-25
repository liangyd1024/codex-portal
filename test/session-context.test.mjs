import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/session-context.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createSessionContext}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(){const state={selectedId:'a',transport:true,desktopMode:false,busy:new Set(),status:{connection:{state:'connected'},controlledThreads:[]},detail:{thread:{status:'idle'},turns:[]}};return {state,c:createSessionContext({state,statusNames:{idle:'就绪',completed:'已完成'}})};}
test('connection and capability gates read current state and only explicit false disables a capability',()=>{
 const {state,c}=fixture();for(const [value,connected,pending] of [['connected',true,false],['ready',true,false],['connecting',false,true],['reconnecting',false,true],['error',false,false],[undefined,false,false]]){state.status.connection.state=value;assert.equal(c.connected(),connected);assert.equal(c.connectionPending(),pending);}
 state.status.connection.state='ready';assert.equal(c.usable(),true);state.transport=false;assert.equal(c.usable(),false);state.transport=true;state.status.service={releasing:true};assert.equal(c.usable(),false);
 for(const value of [undefined,true,false]){state.status.service={protocolValidation:{features:{send:{supported:value}}}};assert.equal(c.featureReady('send'),value!==false);assert.equal(c.featureReady('unknown'),true);}
});
test('handoff status array is authoritative and recovery or pending handoff prevents control',()=>{
 const {state,c}=fixture();state.detail.controlled=true;assert.equal(c.controlled(),true);const handoff={threadId:'a',state:'released',future:{keep:true}};state.detail.handoff=handoff;assert.equal(c.currentHandoff(),handoff);assert.equal(c.controlled(),false);
 state.status.handoffs=[];assert.equal(c.currentHandoff(),null);assert.equal(c.controlled(),true);state.status.handoffs=[handoff];assert.equal(c.currentHandoff(),handoff);assert.equal(c.controlled(),false);
 state.status.handoffs=[];state.busy.add('handoff:a');assert.equal(c.controlled(),false);state.busy.clear();state.detail.recovering=true;assert.equal(c.controlled(),false);state.detail.recovering=false;state.detail.controlled=false;state.status.controlledThreads=['a'];assert.equal(c.controlled(),true);state.selectedId=null;assert.equal(c.controlled(),false);
});
test('snapshot viewing does not infer running from old turns and desktop uses current thread status',()=>{
 const {state,c}=fixture();state.detail.historySource='snapshot';state.detail.turns=[{status:'inProgress'}];assert.equal(c.uncertainHistory(),true);assert.equal(c.running(),false);
 state.detail.controlled=true;assert.equal(c.uncertainHistory(),false);assert.equal(c.running(),true);state.detail.turns=[];state.detail.thread.status='active';assert.equal(c.running(),true);
 state.desktopMode=true;state.detail.thread.status='idle';state.detail.turns=[{status:'running'}];assert.equal(c.running(),false);state.detail.thread.status={type:'active'};assert.equal(c.running(),true);
 state.desktopMode=false;state.detail.historySource=undefined;state.detail.thread.status='idle';for(const type of ['inProgress','in_progress','running']){state.detail.turns=[{status:{type}}];assert.equal(c.running(),true);}state.detail.turns=[{status:'completed'}];assert.equal(c.running(),false);
});
test('session labels preserve connection, unknown, request and last-turn precedence',()=>{
 const {state,c}=fixture();assert.equal(c.sessionLabel(null),'状态未确认');const session={status:'unknown',pendingRequests:1,lastTurnStatus:'failed'};assert.equal(c.sessionLabel(session),'状态未确认');session.status='active';assert.equal(c.sessionLabel(session),'待处理');session.pendingRequests=0;assert.equal(c.sessionLabel(session),'执行中');session.status='idle';for(const [value,label] of [['failed','失败'],['completed','已完成'],['interrupted','已停止'],[undefined,'就绪']]){session.lastTurnStatus=value;assert.equal(c.sessionLabel(session),label);}state.transport=false;assert.equal(c.sessionLabel(session),'状态未确认');
});
test('native thread, turns and handoff retain reference identity and unknown fields',()=>{
 const {state,c}=fixture();const turns=[{status:'completed',raw:'原文\n\n',future:{x:[1,2]}}],thread={turns,historySource:'snapshot',future:{raw:true}};state.detail={thread};assert.equal(c.currentThread(),thread);assert.equal(c.turns(),turns);assert.equal(c.snapshotHistory(),true);const explicit=[];state.detail.turns=explicit;assert.equal(c.turns(),explicit);state.detail=undefined;assert.equal(c.currentThread(),undefined);assert.deepEqual(c.turns(),[]);assert.equal(c.controlled(),false);assert.equal(c.typeOf(null),'');assert.equal(c.typeOf({type:'future-status'}),'future-status');
});
