import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import ts from 'typescript';
import {DraftStore} from '../public/input-state.js';
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const stateCode=compile('../src/web/state.ts').replace(/(['"])zustand\/vanilla\1/,JSON.stringify(import.meta.resolve('zustand/vanilla')));
const code=compile('../src/web/controller-state.ts').replace(/(['"])\.\/state\1/,JSON.stringify(data(stateCode)));
const {createControllerState}=await import(data(code));
const create=drafts=>createControllerState({desktopMode:false,selectedId:'test-thread',projectId:'test-project',drafts});
test('controller preserves the original persistent draft store and its acknowledgement guard',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const drafts=new DraftStore({storage,host:'fixture'});drafts.set('test-thread','初始草稿');const state=create(drafts);
 assert.equal(state.drafts,drafts);const receipt=state.drafts.capture('test-thread','已提交文本');state.drafts.set('test-thread','提交后的新草稿');
 assert.equal(state.drafts.acknowledge(receipt),false);assert.equal(drafts.get('test-thread'),'提交后的新草稿');assert.equal(JSON.parse(values.get('rcm.drafts.fixture'))[0][1],'提交后的新草稿');
});
test('native payload assignment retains complete raw records and object identity',()=>{
 const state=create(new Map()),payload={thread:{id:'test-thread'},vendorField:{bytes:'完整原文\n'.repeat(200)},turns:[{id:'turn',unknown:{value:1}}]};
 state.detail=payload;state.status={unknown:payload.vendorField};state.threads=[payload.thread];
 assert.equal(state.detail,payload);assert.equal(state.threads[0],payload.thread);assert.equal(state.status.unknown,payload.vendorField);
 state.detail.turns[0].unknown.value=2;assert.equal(payload.turns[0].unknown.value,2);
 assert.equal(state.detail.vendorField.bytes,'完整原文\n'.repeat(200));
});
test('independent controller instances cannot share busy flags, versions or native arrays',()=>{
 const a=create(new Map()),b=create(new Map());a.busy.add('connect');a.selectionVersion++;a.errors.push({message:'fixture',stage:'connect',time:1});a.threads.push({id:'only-a'});a.runtimeNotices.set('test-thread',new Map([['notice',{raw:true}]]));
 assert.equal(b.busy.size,0);assert.equal(b.selectionVersion,0);assert.equal(b.errors.length,0);assert.equal(b.threads.length,0);assert.equal(b.runtimeNotices.size,0);
 assert.equal(a.selectedId,'test-thread');assert.equal(a.projectId,'test-project');
});
