import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/workspace-lifecycle.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {installWorkspaceLifecycle,installOfflineDraftGuard}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture({preference=null,blocked=false}={}){
 const handlers={window:new Map(),document:new Map()},calls=[],state={transport:true};let input={checked:false};
 const window={addEventListener:(name,fn)=>handlers.window.set(name,fn)};
 const document={hidden:false,addEventListener:(name,fn)=>handlers.document.set(name,fn)};
 const deps={window,document,host:'qa-a',syncNotificationPreference:()=>calls.push('notification'),readPreference:key=>{calls.push(['read',key]);if(blocked)throw Error('storage denied');return preference;},autoRefreshInput:()=>input,setAutoRefresh:value=>{input.checked=value;calls.push(['auto',value]);},stopAutoRefresh:()=>calls.push('stop'),flushDrafts:()=>calls.push('flush')};
 installWorkspaceLifecycle(deps);
 return{calls,state,window,document,deps,input:()=>input,replaceInput:value=>input={checked:value},fire:(scope,name,event={})=>handlers[scope].get(name)(event),installOffline:()=>installOfflineDraftGuard({window,state,flushDrafts:deps.flushDrafts,renderStatus:()=>calls.push(['status',state.transport]),renderControls:()=>calls.push(['controls',state.transport])})};
}
test('preference reads stay connection-scoped and storage denial defaults to disabled',()=>{
 for(const preference of [null,'true','false','TRUE','1']){const f=fixture({preference});assert.deepEqual(f.calls,[['read','rcm.autoRefresh.qa-a'],['auto',preference==='true']]);}
 assert.deepEqual(fixture({blocked:true}).calls,[['read','rcm.autoRefresh.qa-a'],['auto',false]]);
});
test('focus and only the current target notification key synchronize preferences',()=>{
 const f=fixture();f.calls.length=0;f.fire('window','focus');
 for(const key of [null,'rcm.taskNotifications.qa-b','rcm.autoRefresh.qa-a'])f.fire('window','storage',{key});
 f.fire('window','storage',{key:'rcm.taskNotifications.qa-a'});assert.deepEqual(f.calls,['notification','notification']);
});
test('checkbox changes and persisted pageshow read current control state without initial pageshow restart',()=>{
 const f=fixture({preference:'true'});f.calls.length=0;
 f.input().onchange({target:{checked:false}});f.fire('window','pageshow',{persisted:false});assert.deepEqual(f.calls,[['auto',false]]);
 f.replaceInput(true);f.fire('window','pageshow',{persisted:true});assert.deepEqual(f.calls,[['auto',false],['auto',true]]);
});
test('pagehide flushes before stopping refresh; only hidden visibility flushes drafts',()=>{
 const f=fixture();f.calls.length=0;f.fire('window','pagehide');f.fire('document','visibilitychange');
 f.document.hidden=true;f.fire('document','visibilitychange');assert.deepEqual(f.calls,['flush','stop','flush']);
});
test('offline guard is installed separately and flushes before disabling and rendering',()=>{
 const f=fixture();f.calls.length=0;f.installOffline();f.fire('window','offline');
 assert.deepEqual(f.calls,['flush',['status',false],['controls',false]]);assert.equal(f.state.transport,false);
});
test('flush exceptions preserve the baseline early exit without changing transport or stopping refresh',()=>{
 const f=fixture();const error=Error('flush failed');f.deps.flushDrafts=()=>{throw error;};f.installOffline();f.calls.length=0;
 assert.throws(()=>f.fire('window','offline'),e=>e===error);assert.equal(f.state.transport,true);assert.deepEqual(f.calls,[]);
 // A fresh installation captures the supplied flusher for page lifecycle callbacks.
 installWorkspaceLifecycle(f.deps);f.calls.length=0;
 assert.throws(()=>f.fire('window','pagehide'),e=>e===error);assert.deepEqual(f.calls,[]);
});
