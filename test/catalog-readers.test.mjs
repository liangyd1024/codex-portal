import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/catalogs.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createCatalogReaders}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(overrides={}){
 const state={models:[],projects:[],projectId:null,loadingModels:false,loadingProjects:false};
 let version=0;const renders=[];
 const readers=createCatalogReaders({state,version:()=>version,modelId:m=>m.model||m.id,
  readModels:async()=>({data:[]}),readProjects:async()=>({data:[]}),
  renderModels:()=>renders.push(['models',state.loadingModels]),renderProjects:()=>renders.push(['projects',state.loadingProjects]),...overrides});
 return {state,renders,readers,retire:()=>{version++;}};
}
test('catalog pages preserve model identity, unknown data and first visible unique entry',async()=>{
 for(const force of [false,true]){
  const calls=[],model={id:'native-id',model:'model-a',future:{raw:'完整\n原文'}},second={id:'model-b'};
  const f=fixture({readModels:async path=>{calls.push(path);return calls.length===1?{data:[{model:'model-a',hidden:true},model,{model:'model-a',displayName:'duplicate'}],nextCursor:'页/2 &'}:{data:[{},second]};}});
  await f.readers.loadModels(force);
  assert.deepEqual(calls,['/api/models'+(force?'?refresh=1':''),'/api/models'+(force?'?refresh=1&':'?')+'cursor='+encodeURIComponent('页/2 &')]);
  assert.deepEqual(f.state.models,[model,second]);assert.equal(f.state.models[0],model);assert.equal(f.state.models[0].future,model.future);
  assert.deepEqual(f.renders,[['models',true],['models',false]]);assert.equal(f.readers.pendingModels(),null);
 }
});
test('concurrent model reads share the existing refresh policy and failed work is retryable',async()=>{
 const pending=gate(),calls=[];const f=fixture({readModels:path=>{calls.push(path);return calls.length===1?pending.promise:Promise.resolve({data:[]});}});
 const first=f.readers.loadModels(),second=f.readers.loadModels(true),error=Error('catalog failed');
 const results=Promise.allSettled([first,second,f.readers.pendingModels()]);
 assert.deepEqual(calls,['/api/models']);pending.reject(error);
 for(const r of await results){assert.equal(r.status,'rejected');assert.equal(r.reason,error);}
 assert.equal(f.state.loadingModels,false);assert.equal(f.readers.pendingModels(),null);
 await f.readers.loadModels(true);assert.deepEqual(calls,['/api/models','/api/models?refresh=1']);
});
test('retired model pagination finishes draining but cannot overwrite a new account catalog',async()=>{
 const pending=gate(),calls=[],f=fixture({readModels:path=>{calls.push(path);return calls.length===1?pending.promise:Promise.resolve({data:[{id:'old-second'}]});}});
 const read=f.readers.loadModels();const newer=[{id:'new-account'}];f.retire();f.state.models=newer;
 pending.resolve({data:[{id:'old-first'}],nextCursor:'old-next'});await read;
 assert.equal(calls.length,2);assert.equal(f.state.models,newer);assert.equal(f.state.loadingModels,false);
});
test('project reads coalesce, preserve records, and clear only a missing selected project',async()=>{
 const pending=gate();let calls=0;const f=fixture({readProjects:()=>{calls++;return pending.promise;}});
 const project={id:'p',unknown:{keep:true}};f.state.projectId='p';
 const first=f.readers.loadProjects(),second=f.readers.loadProjects();assert.equal(calls,1);
 pending.resolve({data:[project]});await Promise.all([first,second]);
 assert.equal(f.state.projects[0],project);assert.equal(f.state.projectId,'p');assert.equal(f.readers.pendingProjects(),null);
 const empty=fixture();empty.state.projectId='gone';await empty.readers.loadProjects();assert.equal(empty.state.projectId,null);
});
test('late and failed project reads retain the current account selection and reset progress',async()=>{
 for(const fail of [false,true]){
  const pending=gate(),f=fixture({readProjects:()=>pending.promise});
  const read=f.readers.loadProjects();const result=Promise.allSettled([read]);
  f.retire();const newer=[{id:'new'}];f.state.projects=newer;f.state.projectId='new';
  if(fail)pending.reject(Error('old failure'));else pending.resolve({data:[{id:'old'}]});
  assert.equal((await result)[0].status,fail?'rejected':'fulfilled');
  assert.equal(f.state.projects,newer);assert.equal(f.state.projectId,'new');assert.equal(f.state.loadingProjects,false);
  assert.deepEqual(f.renders,[['projects',true],['projects',false]]);
 }
});
