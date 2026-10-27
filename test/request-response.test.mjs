import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/request-response.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createRequestResponder,requestKey,requestPath}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(r){
 const calls=[],pending=[],busy=new Set(),other={id:'other'},state={selectedId:'thread',localRequests:[r,other],status:{instanceId:'old',pendingRequests:[r,other]},detail:{pendingRequests:[r,other]}};
 let side=null;
 const deps={state,action:async(key,run)=>{if(busy.has(key))return;busy.add(key);try{await run();}finally{busy.delete(key);}},api:(path,options)=>{calls.push({path,...options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));},questionDrafts:{clear:q=>calls.push(['clear',q]),set:(q,value)=>calls.push(['draft',q,value])},document:{activeElement:{closest:()=>({dataset:{requestId:requestPath(r)}})},querySelector:()=>({focus:()=>calls.push('side-focus')})},element:()=>({focus:()=>calls.push('main-focus')}),sideChat:()=>side,renderRequests:()=>calls.push('render'),loadStatus:async()=>calls.push('status')};
 return {deps,respond:createRequestResponder(deps),state,calls,pending,busy,other,setSide:value=>side=value};
}
test('opaque keys are encoded; native answer retains unknown fields and duplicate submission is suppressed',async()=>{
 const r={id:7,key:'request /?中文',threadId:'thread'},f=fixture(r),answer={decision:'accept',future:{raw:'原文'}};
 const work=f.respond(r,answer);await f.respond(r,answer);assert.equal(f.pending.length,1);assert.equal(f.calls[0].path,'/api/requests/'+encodeURIComponent(r.key)+'/respond');assert.equal(f.calls[0].body,answer);
 f.pending[0].resolve();await work;assert.deepEqual(f.state.localRequests,[f.other]);assert.deepEqual(f.state.status.pendingRequests,[f.other]);assert.deepEqual(f.state.detail.pendingRequests,[f.other]);assert.deepEqual(f.calls.slice(-3),['render','main-focus','status']);assert.equal(f.busy.size,0);
});
test('async question preserves answer fields and overrides turn/item with request values; side focus restored',async()=>{
 const r={id:'q',kind:'asyncQuestion',threadId:'side /',params:{turnId:'turn',itemId:'item'}},f=fixture(r),answer={answers:{a:['中文']},turnId:'wrong',itemId:'wrong',future:true};f.setSide({id:r.threadId});
 const work=f.respond(r,answer);assert.equal(f.calls[0].path,'/api/threads/side%20%2F/question-answer');assert.deepEqual(f.calls[0].body,{...answer,turnId:'turn',itemId:'item'});assert.equal(answer.turnId,'wrong');f.pending[0].resolve();await work;assert.deepEqual(f.calls.slice(1),[['clear',r],['draft',r,{sent:true}],'render','side-focus','status']);
});
test('late success clears submitted draft but does not remove a new instance request or move focus',async()=>{
 const r={id:1,threadId:'thread'},f=fixture(r),work=f.respond(r,{decision:'accept'});f.state.status={instanceId:'new',pendingRequests:[r]};const current=f.state.status;f.pending[0].resolve();await work;assert.equal(f.state.status,current);assert.deepEqual(f.state.localRequests,[r,f.other]);assert.deepEqual(f.calls.slice(1),[['clear',r]]);
});
test('failed request preserves drafts and all pending lists for retry',async()=>{
 const r={id:1},f=fixture(r),work=f.respond(r,{});f.pending[0].reject(Error('offline'));await assert.rejects(work,/offline/);assert.equal(f.calls.length,1);assert.deepEqual(f.state.localRequests,[r,f.other]);assert.equal(f.busy.size,0);const retry=f.respond(r,{});f.pending[1].resolve();await retry;
});
test('numeric and string IDs remain distinct while explicit empty keys retain precedence',()=>{
 assert.notEqual(requestKey({id:1}),requestKey({id:'1'}));assert.equal(requestKey({id:1,key:''}),'');assert.equal(requestPath({id:1,key:''}),'');
});

test('selected desktop async answers use the desktop route without claiming web ownership',async()=>{
 const r={id:'q',kind:'asyncQuestion',threadId:'thread',params:{turnId:'turn',itemId:'item'}},f=fixture(r);f.state.desktopMode=true;
 const work=f.respond(r,{answers:{q:{answers:['中文']}}});assert.equal(f.calls[0].path,'/api/desktop/threads/thread/question-answer');f.pending[0].resolve();await work;
});


test('desktop answer refreshes its receipt after success and never refreshes a changed selection',async()=>{
 for(const change of [false,true]){
  const r={id:'q',kind:'asyncQuestion',threadId:'thread',params:{turnId:'turn',itemId:'item'}},f=fixture(r);f.state.desktopMode=true;let refreshes=0;f.deps.refresh=async()=>{refreshes++};
  const work=f.respond(r,{answers:{}});if(change)f.state.selectedId='other';f.pending[0].resolve();await work;assert.equal(refreshes,change?0:1);
 }
});

test('desktop blocking answers preserve native numeric IDs and owner without using generic RPC or async reply',async()=>{
 const r={id:0,key:'desktop-key',kind:'desktopQuestion',threadId:'thread',ownerClientId:'owner',params:{turnId:'turn',itemId:'item'}},f=fixture(r);f.state.desktopMode=true;
 const answer={answers:{choice:{answers:['中文回答']}},requestId:'wrong',ownerClientId:'wrong'};
 const work=f.respond(r,answer);assert.equal(f.calls[0].path,'/api/desktop/threads/thread/question-answer');
 assert.deepEqual(f.calls[0].body,{...answer,turnId:'turn',itemId:'item',requestId:0,ownerClientId:'owner'});f.pending[0].resolve();await work;
 assert.equal(f.calls.some(c=>Array.isArray(c)&&c[0]==='draft'),false);
});
