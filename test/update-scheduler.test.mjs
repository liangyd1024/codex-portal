import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/update-scheduler.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createUpdateScheduler}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(){
 const state={streamRender:false,selectedId:'a'},timers=new Map(),calls=[];let id=0,usable=true,fail=false;
 const scheduler=createUpdateScheduler({state,defer:(run,delay)=>{timers.set(++id,{run,delay});return id;},cancel:key=>timers.delete(key),usable:()=>usable,
 renderMessages:()=>calls.push('messages'),renderRequests:()=>calls.push('requests'),renderControls:()=>calls.push('controls'),
 refreshSelected:async()=>{calls.push(state.selectedId);if(fail)throw Error('read failed');},refreshList:()=>calls.push('list'),report:e=>calls.push(e.message)});
 const flush=delay=>{for(const [key,t] of [...timers])if(t.delay===delay){timers.delete(key);t.run();}};
 return{state,timers,calls,scheduler,flush,usable:v=>{usable=v;},fail:v=>{fail=v;}};
}
test('text bursts render once; a structural event promotes the same batch without postponing it',()=>{
 const f=fixture();for(let i=0;i<100;i++)f.scheduler.stream('text');assert.equal(f.timers.size,1);assert.equal(f.state.streamRender,true);f.flush(80);assert.deepEqual(f.calls,['messages']);assert.equal(f.state.streamRender,false);
 f.calls.length=0;f.scheduler.stream('text');const timer=[...f.timers.keys()][0];f.scheduler.stream();f.scheduler.stream('text');assert.deepEqual([...f.timers.keys()],[timer]);f.flush(80);assert.deepEqual(f.calls,['messages','requests','controls']);
 f.calls.length=0;f.scheduler.stream('text');f.flush(80);assert.deepEqual(f.calls,['messages']);
});
test('detail refresh coalesces bursts, reads current selection, and reports failure without blocking later work',async()=>{
 const f=fixture();f.scheduler.detail();f.scheduler.detail();assert.equal(f.timers.size,1);f.state.selectedId='b';f.fail(true);f.flush(650);await Promise.resolve();assert.deepEqual(f.calls,['b','read failed']);f.fail(false);f.scheduler.detail();f.flush(650);await Promise.resolve();assert.deepEqual(f.calls,['b','read failed','b']);
 f.scheduler.detail();f.state.selectedId=null;f.flush(650);assert.equal(f.calls.length,3);f.state.selectedId='c';f.scheduler.detail();f.usable(false);f.flush(650);assert.equal(f.calls.length,3);
});
test('list refresh debounces to the final request and checks connection at execution time',()=>{
 const f=fixture();f.scheduler.list();const first=[...f.timers.keys()][0];f.scheduler.list();assert.equal(f.timers.has(first),false);assert.equal(f.timers.size,1);f.flush(1000);assert.deepEqual(f.calls,['list']);f.scheduler.list();f.usable(false);f.flush(1000);assert.deepEqual(f.calls,['list']);f.usable(true);f.scheduler.list();f.flush(1000);assert.deepEqual(f.calls,['list','list']);
});
