import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/auto-refresh.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createAutoRefresh}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}) {
 const calls=[],timers=new Map();let id=0,busy=false;
 const deps={hidden:()=>false,usable:()=>true,refreshing:()=>busy,pendingModels:()=>null,pendingProjects:()=>null,
 showRefresh:async(scope,work)=>{calls.push(['scope',scope]);busy=true;try{await work();}finally{busy=false;}},
 loadProjects:async()=>calls.push(['projects']),loadModels:async force=>calls.push(['models',force]),
 checked:v=>calls.push(['checked',v]),host:()=> 'qa-local',save:(...args)=>calls.push(['save',...args]),recordError:(e,stage)=>calls.push(['error',e.message,stage]),
 schedule:(fn,ms)=>{const handle=++id;timers.set(handle,fn);calls.push(['schedule',ms]);return handle;},
 cancel:handle=>{timers.delete(handle);calls.push(['cancel',handle]);},...overrides};
 return {controller:createAutoRefresh(deps),deps,calls,timers};
}
test('catalog polling skips every baseline guard without starting reads',async()=>{
 for(const [key,value] of [['hidden',true],['usable',false],['refreshing',true],['pendingModels',{}],['pendingProjects',{}]]) {
  const {controller,calls}=fixture({[key]:()=>value});await controller.refresh();assert.deepEqual(calls,[],key);
 }
});
test('catalog polling coalesces while busy, waits for both results, then recovers',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve});let fail=true;
 const {controller,calls,deps}=fixture({loadProjects:async()=>{calls.push(['projects']);await pending;if(fail)throw new Error('项目失败');},loadModels:async force=>{calls.push(['models',force]);if(fail)throw null;}});
 const first=controller.refresh();const rejected=assert.rejects(first,{message:'项目列表：项目失败；模型列表：null'});
 await controller.refresh();await tick();assert.deepEqual(calls,[['scope','项目和模型列表'],['projects'],['models',true]]);assert.equal(deps.refreshing(),true);
 release();await rejected;assert.equal(deps.refreshing(),false);fail=false;await controller.refresh();assert.equal(calls.filter(c=>c[0]==='projects').length,2);
});
test('enable replaces timer, storage failure keeps polling, stop preserves preference and periodic failure is reported',async()=>{
 const {controller,calls,timers}=fixture({save:(key,value)=>{calls.push(['save',key,value]);throw new Error('quota');},showRefresh:async()=>{throw new Error('刷新失败');}});
 controller.setEnabled(true);controller.setEnabled(true);assert.equal(timers.size,1);assert.deepEqual(calls.filter(c=>c[0]==='schedule'),[['schedule',30000],['schedule',30000]]);
 timers.values().next().value();await tick();assert.deepEqual(calls.at(-1),['error','刷新失败','refresh']);
 const writes=calls.filter(c=>c[0]==='save').length;controller.stop();assert.equal(timers.size,0);assert.equal(calls.filter(c=>c[0]==='save').length,writes);
 controller.setEnabled(true);assert.equal(timers.size,1);controller.setEnabled(false);assert.equal(timers.size,0);assert.deepEqual(calls.at(-1),['save','rcm.autoRefresh.qa-local','false']);
});
