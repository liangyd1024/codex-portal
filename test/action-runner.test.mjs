import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/action-runner.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createActionRunner}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(){
 const state={busy:new Set(),status:{controlledThreads:['thread']}},calls=[];
 const deps={state,renderControls:()=>calls.push(['controls',[...state.busy]]),renderStatus:()=>calls.push(['status',[...state.busy]]),usable:()=>false,syncRequestCards:view=>calls.push(['cards',view]),recordError:(e,key)=>calls.push(['error',e,key,[...state.busy]]),messageOf:e=>e.message,toast:(...args)=>calls.push(['toast',...args])};
 return {state,calls,deps,action:createActionRunner(deps)};
}
test('same-key duplicate is ignored while unrelated actions proceed and return values survive',async()=>{
 const f=fixture();let resolve,count=0;const first=f.action('message',()=>{count++;return new Promise(r=>resolve=r);});assert.deepEqual(f.calls,[['controls',['message']]]);
 assert.equal(await f.action('message',()=>{count++;}),undefined);assert.equal(count,1);assert.equal(await f.action('refresh',()=>42),42);assert.deepEqual([...f.state.busy],['message']);resolve({raw:'完整结果'});assert.deepEqual(await first,{raw:'完整结果'});assert.equal(f.state.busy.size,0);assert.deepEqual(f.calls.at(-1),['controls',[]]);
});
test('connection operations refresh status after success or failure without clearing other busy keys',async()=>{
 for(const key of ['connect','disconnect','release'])for(const fail of [false,true]){
  const f=fixture();f.state.busy.add('other');const error=Error('拒绝');await f.action(key,()=>{if(fail)throw error;});assert.deepEqual(f.calls.at(-1),['status',['other']]);assert.equal(f.state.busy.has(key),false);assert.equal(f.calls.some(c=>c[0]==='error'),fail);
 }
});
test('request failures clear their busy flag before availability recovery and keep other requests pending',async()=>{
 const f=fixture(),error=Error('回答失败');f.state.busy.add('request:other');assert.equal(await f.action('request:opaque/?',async()=>{throw error;}),undefined);
 assert.equal(f.calls[1][0],'cards');const view=f.calls[1][1];assert.equal(view.ready,false);assert.equal(view.pending('opaque/?'),false);assert.equal(view.pending('other'),true);assert.equal(view.controlledThreads,f.state.status.controlledThreads);
 assert.deepEqual(f.calls.slice(2),[['error',error,'request:opaque/?',['request:other']],['toast','回答失败',true,11000],['controls',['request:other']]]);
});
test('non-request failure reports original error and restores controls without request-card synchronization',async()=>{
 const f=fixture(),error=Object.assign(Error('发送失败'),{unknown:{raw:true}});await f.action('message',async()=>{throw error;});assert.equal(f.calls.some(c=>c[0]==='cards'),false);assert.equal(f.calls[1][1],error);assert.deepEqual(f.calls[1][3],['message']);assert.deepEqual(f.calls.at(-1),['controls',[]]);
});
test('reporting failure still runs final cleanup; original error handling rejection is not swallowed',async()=>{
 const f=fixture(),reportError=Error('diagnostics unavailable');const action=createActionRunner({...f.deps,recordError:()=>{throw reportError;}});await assert.rejects(action('request:x',()=>{throw Error('offline');}),e=>e===reportError);assert.equal(f.state.busy.size,0);assert.deepEqual(f.calls.at(-1),['controls',[]]);
});
