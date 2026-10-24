import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/workspace-refresh.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createWorkspaceRefresh}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}) {
 const calls=[];
 const deps={showRefresh:async(scope,work)=>{calls.push(['show',scope]);await work();},
 loadStatus:async()=>{calls.push(['status']);},connected:()=>true,
 loadModels:async force=>{calls.push(['models',force]);},loadProjects:async()=>{calls.push(['projects']);},
 loadThreads:async(...args)=>{calls.push(['threads',...args]);},refreshSelected:async()=>{calls.push(['selected']);},
 refreshAccountUsage:async()=>{calls.push(['account']);},...overrides};
 return {calls,refresh:createWorkspaceRefresh(deps)};
}
test('workspace waits for status, coalesces overlapping requests, and permits a new generation',async()=>{
 const status=gate(),model=gate();let statusReads=0,modelReads=0;
 const {calls,refresh}=fixture({loadStatus:()=>{statusReads++;return status.promise;},loadModels:force=>{modelReads++;calls.push(['models',force]);return model.promise;}});
 const a=refresh(true),b=refresh(false,true);await tick();assert.equal(statusReads,1);assert.equal(modelReads,0);
 status.resolve();await tick();assert.equal(modelReads,1);assert.deepEqual(calls,[['show','工作区'],['models',true],['projects'],['threads',false,true],['selected'],['account']]);
 let complete=false;const c=refresh().then(()=>{complete=true;});await tick();assert.equal(complete,false);
 model.resolve();await Promise.all([a,b,c]);await refresh(false,true);assert.equal(statusReads,1);assert.equal(modelReads,2);assert.deepEqual(calls.at(-5),['models',false]);
});
test('workspace preserves disconnection error and never starts catalog or detail reads',async()=>{
 const {calls,refresh}=fixture({connected:()=>false});await assert.rejects(refresh(),{message:'目标机器未连接。请先连接，再刷新。'});
 assert.deepEqual(calls,[['show','工作区'],['status']]);await assert.rejects(refresh(false,true));assert.deepEqual(calls.at(-1),['show','工作区']);
});
test('workspace waits for every read and aggregates failures in original field order',async()=>{
 const late=gate();const {refresh}=fixture({loadModels:async()=>{throw new Error('模型失败');},loadProjects:()=>late.promise,
 refreshSelected:async()=>{throw '原文失败';},refreshAccountUsage:()=>undefined});
 let settled=false;const result=refresh(false,true).catch(e=>{settled=true;return e;});await tick();assert.equal(settled,false);
 late.reject(new Error('项目失败'));assert.equal((await result).message,'模型列表：模型失败；项目列表：项目失败；当前会话：原文失败');
});
test('workspace releases coalescing state when the UI handles failure and on status rejection',async()=>{
 let failures=1;const errors=[];const {refresh,calls}=fixture({loadStatus:async()=>{if(failures--)throw new Error('状态失败');},showRefresh:async(scope,work)=>{try{await work();}catch(e){errors.push(e.message);}}});
 await Promise.all([refresh(),refresh()]);assert.deepEqual(errors,['状态失败']);assert.deepEqual(calls,[]);
 await refresh();assert.equal(calls.filter(c=>c[0]==='models').length,1);
});
