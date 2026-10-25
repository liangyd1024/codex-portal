import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/connection-actions.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {createConnectionActions}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(overrides={}){
 const calls=[],state={selectedId:'thread/a',selectionVersion:1,detail:{controlled:true},drafts:new Map()};
 const d={state,api:async(...args)=>{calls.push(['api',...args]);return{};},action:async(key,run)=>{calls.push(['action',key]);return run();},feedback:s=>calls.push(['feedback',s]),applyStatus:s=>calls.push(['status',s]),renderStatus:()=>calls.push(['renderStatus']),loadStatus:async()=>calls.push(['loadStatus']),connected:()=>true,refreshWorkspace:async()=>calls.push(['refresh']),renderThread:()=>calls.push(['renderThread']),usable:()=>true,newChatOpen:()=>false,applyDetail:(...args)=>calls.push(['detail',...args]),recordError:(e,stage)=>calls.push(['error',e.message,stage]),messageOf:e=>e.message,toast:(...args)=>calls.push(['toast',...args]),input:()=>'未发送的中文草稿',saveDrafts:()=>calls.push(['saved',state.drafts.get(state.selectedId)]),focusHandoff:()=>calls.push(['focus']),handoffError:s=>calls.push(['handoffError',s]),...overrides};
 return{d,state,calls,actions:createConnectionActions(d)};
}
test('connect preserves timeout, fallback status and detached refresh failure',async()=>{
 const f=fixture({refreshWorkspace:async()=>{throw Error('sync failed');}});await f.actions.connectRemote();await Promise.resolve();
 assert.deepEqual(f.calls,[['feedback',''],['action','connect'],['api','/api/connect',{method:'POST',body:{},timeout:150000}],['loadStatus'],['renderStatus'],['error','sync failed','sync']]);
});
test('connect uses returned complete status without an extra read',async()=>{
 const status={connection:{state:'connected'},unknown:{native:true}},f=fixture({api:async()=>status});await f.actions.connectRemote();
 assert.deepEqual(f.calls,[['feedback',''],['action','connect'],['status',status],['renderStatus'],['renderStatus'],['refresh']]);
});
test('disconnect reads status before clearing local control and rendering',async()=>{
 const f=fixture();await f.actions.disconnectRemote();assert.equal(f.state.detail.controlled,false);
 assert.deepEqual(f.calls,[['feedback',''],['action','disconnect'],['api','/api/disconnect',{method:'POST'}],['loadStatus'],['renderThread']]);
});
test('late takeover response cannot replace another selection or a reopened same thread',async()=>{
 for(const change of ['id','version','new']){
  let resolve;const f=fixture({api:()=>new Promise(r=>resolve=r)}),work=f.actions.takeoverThread();
  if(change==='id')f.state.selectedId='other';if(change==='version')f.state.selectionVersion++;if(change==='new')f.d.newChatOpen=()=>true;
  resolve({thread:{id:'thread/a'},unknown:'retain'});await work;
  assert.equal(f.calls.some(c=>c[0]==='detail'),false);assert.equal(f.calls.filter(c=>c[0]==='loadStatus').length,1);
 }
});
test('current takeover conflict clears control and shows the original error',async()=>{
 const error=Object.assign(Error('writer conflict'),{code:'WRITER_CONFLICT'}),f=fixture({api:async()=>{throw error;}});await f.actions.takeoverThread();
 assert.deepEqual(f.state.detail,{controlled:false,controlState:'conflict'});assert.deepEqual(f.calls.slice(-3),[['error','writer conflict','takeover'],['renderThread'],['toast','writer conflict',true,8000,'takeover']]);
});
test('handoff saves draft before request and retains unknown reply fields',async()=>{
 const reply={unknown:{native:true}},f=fixture({api:async(path,options)=>{f.calls.push(['api',path,options]);return reply;}});await f.actions.endThreadUse();
 assert.deepEqual(f.calls,[['saved','未发送的中文草稿'],['action','handoff:thread/a'],['api','/api/threads/thread%2Fa/handoff',{method:'POST',timeout:45000}],['loadStatus'],['renderThread'],['focus']]);
 assert.equal(f.state.detail.handoff,reply);assert.equal(f.state.detail.controlState,'viewing');
});
test('late handoff success and failure never alter new selection or its focus',async()=>{
 for(const fails of [false,true]){
  let resolve,reject;const f=fixture({api:()=>new Promise((r,j)=>{resolve=r;reject=j;})}),work=f.actions.endThreadUse();
  f.state.selectionVersion++;const detail={controlled:true,controlState:'new'};f.state.detail=detail;
  if(fails)reject(Error('handoff failed'));else resolve({unknown:true});await work;
  assert.deepEqual(detail,{controlled:true,controlState:'new'});assert.equal(f.calls.some(c=>c[0]==='focus'||c[0]==='handoffError'),false);assert.equal(f.state.drafts.get('thread/a'),'未发送的中文草稿');
 }
});
test('handoff errors retain draft even if storage and status read fail',async()=>{
 const f=fixture({saveDrafts:()=>{throw Error('storage');},api:async()=>{throw Error('handoff failed');},loadStatus:async()=>{throw Error('offline');}});await f.actions.endThreadUse();
 assert.equal(f.state.drafts.get('thread/a'),'未发送的中文草稿');assert.deepEqual(f.calls.slice(-3),[['error','handoff failed','handoff'],['renderThread'],['handoffError','handoff failed']]);
});
