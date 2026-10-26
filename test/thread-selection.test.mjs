import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/thread-selection.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createThreadSelection}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(overrides={}){
 const calls=[],pending=[],input={value:'草稿 A'},messages={style:{paddingBottom:'20px'}},state={busy:new Set(),desktopMode:false,drafts:new Map([['b','草稿 B']]),selectionVersion:0,selectedId:'a',detail:{thread:{id:'a'}},historyCursor:'old',loadedOlderHistory:true,loadingDetail:false,historyError:'old'},scroll={schedule:()=>calls.push('scroll')};let automations={threadId:'desktop',close:()=>calls.push('automation-close')};
 const deps={state,location:{href:'http://fixture/?thread=a&host=target#keep'},history:{replaceState:(_s,_t,url)=>calls.push(['url',String(url)])},document:{querySelector:()=>({classList:{toggle:(name,on)=>calls.push([name,on])}})},closeNewChat:()=>calls.push('close-new'),automations:()=>automations,toggleInspector:open=>calls.push(['inspector',open]),element:id=>id==='messages'?messages:input,inputId:()=>state.selectedId,saveView:()=>calls.push(['save',state.selectedId]),resizeInput:()=>calls.push('resize'),renderModels:value=>calls.push(['models',value]),renderThread:()=>calls.push('thread'),renderThreads:()=>calls.push('threads'),renderRequests:()=>calls.push('requests'),saveDetailSoon:()=>calls.push('cache'),compactLayout:()=>true,toggleSidebar:(...args)=>calls.push(['sidebar',...args]),refreshSelected:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),scrollFollow:()=>scroll,messageOf:e=>e.message,recordError:(e,stage)=>calls.push(['error',stage,e.message])};
 return {...createThreadSelection({...deps,...overrides}),state,input,messages,calls,pending,setAutomation:value=>{automations=value;}};
}
test('selection preserves draft and transition order before the pending detail settles',async()=>{
 const f=fixture(),work=f.selectThread('b');
 assert.equal(f.state.drafts.get('a'),'草稿 A');assert.equal(f.input.value,'草稿 B');assert.equal(f.messages.style.paddingBottom,'');assert.equal(f.state.selectedId,'b');assert.equal(f.state.detail,null);assert.equal(f.state.historyCursor,null);assert.equal(f.state.loadedOlderHistory,false);assert.equal(f.state.loadingDetail,true);assert.equal(f.state.historyError,'');
 assert.deepEqual(f.calls,[['url','http://fixture/?host=target#keep'],'close-new','automation-close',['desktop-chat',false],['inspector',false],['save','b'],'resize','thread','threads',['sidebar',false,false]]);
 f.pending[0].resolve();await work;assert.equal(f.calls.at(-1),'scroll');
});
test('late selection success and failure cannot scroll or replace the current error',async()=>{
 for(const fail of [false,true]){
  const f=fixture(),first=f.selectThread('b');f.input.value='编辑 B';const second=f.selectThread('c');const count=f.calls.length;
  if(fail)f.pending[0].reject(Error('old failure'));else f.pending[0].resolve();await first;
  assert.equal(f.calls.length,count);assert.equal(f.state.selectedId,'c');assert.equal(f.state.loadingDetail,true);assert.equal(f.state.historyError,'');assert.equal(f.state.drafts.get('b'),'编辑 B');
  f.pending[1].reject(Error('current failure'));await second;assert.equal(f.state.loadingDetail,false);assert.equal(f.state.historyError,'current failure');assert.deepEqual(f.calls.slice(-2),[['error','thread','current failure'],'thread']);
 }
});
test('creating blocks selection and mutable automation context is read when selection starts',async()=>{
 const f=fixture();f.state.busy.add('create');await f.selectThread('b');assert.deepEqual(f.calls,[]);assert.equal(f.state.selectedId,'a');
 f.state.busy.clear();f.setAutomation({threadId:'b',close:()=>f.calls.push('new-automation')});const work=f.selectThread('b');assert.equal(f.state.desktopMode,true);assert.ok(f.calls.includes('new-automation'));f.pending[0].resolve();await work;
});
test('detail apply retains raw values and same-thread goal on error but never saves recovering previews',()=>{
 const f=fixture(),goal={raw:{future:true}},turns=[{future:'完整原文'}];f.state.detail={thread:{id:'a'},goal};const data={thread:{id:'a',turns},goalError:'unavailable',nextCursor:'next',recovering:true,future:{text:'原始字段'}};f.applyDetail(data,true);
 assert.equal(f.state.detail.goal,goal);assert.equal(f.state.detail.turns,turns);assert.equal(f.state.detail.future,data.future);assert.equal(f.state.historyCursor,'next');assert.deepEqual(f.calls,[['models',true],'thread','requests']);
 f.calls.length=0;f.applyDetail({thread:{id:'b'},goalError:'unavailable',historyCursor:'older'});assert.equal(f.state.detail.goal,undefined);assert.deepEqual(f.state.detail.turns,[]);assert.equal(f.state.historyCursor,'older');assert.deepEqual(f.calls,['thread','requests','cache']);
});
test('verified desktop detail enables the existing composer without changing the draft or selection',()=>{
 const f=fixture();const selection=f.state.selectionVersion;
 f.applyDetail({thread:{id:'a'},controlState:'desktop',desktop:{available:true,canSend:true}});
 assert.equal(f.state.desktopMode,true);assert.equal(f.state.selectionVersion,selection);assert.equal(f.input.value,'草稿 A');assert.deepEqual(f.calls.slice(0,2),[['desktop-chat',true],['save','a']]);
 const cached=fixture();cached.applyDetail({thread:{id:'a'},controlState:'desktop',desktop:{available:true},recovering:true});assert.equal(cached.state.desktopMode,false);
});

test('manual selection cancels pending notification but notification routing does not cancel itself',async()=>{
 let cancelled=0;const f=fixture({cancelNotification:()=>cancelled++});
 let work=f.selectThread('b',{notification:true});f.pending[0].resolve();await work;assert.equal(cancelled,0);
 work=f.selectThread('a');f.pending[1].resolve();await work;assert.equal(cancelled,1);
});
