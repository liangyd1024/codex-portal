import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installThreadSync} from '../public/thread-sync.js';
import {mergeLiveTurns,selectConnectionStatus} from '../public/connection-state.js';
import {Manager} from '../lib/manager.mjs';
import ts from 'typescript';
const refreshSource=readFileSync(new URL('../src/web/services/selected-refresh.ts',import.meta.url),'utf8');
const refreshOutput=ts.transpileModule(refreshSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createSelectedRefresh}=await import('data:text/javascript;base64,'+Buffer.from(refreshOutput).toString('base64'));

const detailReaderSource=readFileSync(new URL('../src/web/services/detail-reader.ts',import.meta.url),'utf8');
const detailReaderOutput=ts.transpileModule(detailReaderSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createDetailReader}=await import('data:text/javascript;base64,'+Buffer.from(detailReaderOutput).toString('base64'));

const recoverySource=readFileSync(new URL('../src/web/services/detail-recovery.ts',import.meta.url),'utf8');
const recoveryOutput=ts.transpileModule(recoverySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createDetailRecovery}=await import('data:text/javascript;base64,'+Buffer.from(recoveryOutput).toString('base64'));

const viewSource=readFileSync(new URL('../src/web/services/thread-view.ts',import.meta.url),'utf8');
const viewOutput=ts.transpileModule(viewSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createThreadViewReporter}=await import('data:text/javascript;base64,'+Buffer.from(viewOutput).toString('base64'));
const statusSource=readFileSync(new URL('../src/web/services/connection-status.ts',import.meta.url),'utf8');
const statusOutput=ts.transpileModule(statusSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('../../../public/connection-state.js',new URL('../public/connection-state.js',import.meta.url).href);
const {applyControllerStatus}=await import('data:text/javascript;base64,'+Buffer.from(statusOutput).toString('base64'));

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,overrides={}) {
  t.mock.timers.enable({apis:['setTimeout']});
  const window=new EventTarget(),document=new EventTarget(),calls=[];
  window.navigator={onLine:true};document.hidden=false;
  const stop=installThreadSync({window,document,canSync:()=>true,refresh:()=>calls.push('read'),resume:()=>calls.push('resume'),onError:e=>calls.push(e.message),...overrides});
  t.after(stop);
  return {window,document,calls,stop};
}
test('selected history refreshes without SSE or the catalog toggle, and pauses while hidden/offline',async t=>{
  const f=fixture(t);
  t.mock.timers.tick(5000);await settle();assert.deepEqual(f.calls,['read']);
  f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(30000);await settle();assert.equal(f.calls.length,1);
  f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(f.calls.at(-1),'resume');
  f.window.navigator.onLine=false;f.window.dispatchEvent(new Event('offline'));
  t.mock.timers.tick(30000);await settle();assert.equal(f.calls.length,2);
  f.window.navigator.onLine=true;f.window.dispatchEvent(new Event('online'));await settle();assert.equal(f.calls.length,3);
  t.mock.timers.tick(5000);await settle();assert.equal(f.calls.at(-1),'read');
});
test('window focus and bfcache return refresh immediately; pagehide and disposal stop polling',async t=>{
  const f=fixture(t);
  f.window.dispatchEvent(new Event('focus'));await settle();assert.deepEqual(f.calls,['resume']);
  f.window.dispatchEvent(new Event('pagehide'));t.mock.timers.tick(10000);await settle();assert.equal(f.calls.length,1);
  f.window.dispatchEvent(new Event('pageshow'));await settle();assert.equal(f.calls.length,2);
  f.stop();f.window.dispatchEvent(new Event('focus'));t.mock.timers.tick(10000);await settle();assert.equal(f.calls.length,2);
});
test('initial pageshow does not repeat startup reads; persisted restoration still resumes',async t=>{
  const f=fixture(t);
  f.window.dispatchEvent(new Event('pageshow'));await settle();assert.deepEqual(f.calls,[]);
  t.mock.timers.tick(5000);await settle();assert.deepEqual(f.calls,['read']);
  const restored=new Event('pageshow');Object.defineProperty(restored,'persisted',{value:true});
  f.window.dispatchEvent(restored);await settle();assert.deepEqual(f.calls,['read','resume']);
});
test('slow reads do not overlap; foreground queues one fresh read after the old snapshot',async t=>{
  let finish,reads=0;
  const f=fixture(t,{refresh:()=>{reads++;return new Promise(resolve=>finish=resolve);}});
  t.mock.timers.tick(5000);await settle();assert.equal(reads,1);
  t.mock.timers.tick(30000);await settle();assert.equal(reads,1);
  f.window.dispatchEvent(new Event('focus'));f.document.dispatchEvent(new Event('visibilitychange'));
  await settle();assert.equal(f.calls.length,0);
  finish();await settle();assert.deepEqual(f.calls,['resume']);
});
test('temporary failures retry, and disconnected selections do not poll',async t=>{
  let ready=true,reads=0;
  const f=fixture(t,{canSync:()=>ready,refresh:()=>{if(++reads===1)throw Error('temporary');}});
  t.mock.timers.tick(5000);await settle();assert.deepEqual(f.calls,['temporary']);
  t.mock.timers.tick(5000);await settle();assert.equal(reads,2);
  ready=false;t.mock.timers.tick(5000);await settle();assert.equal(reads,2);
  f.window.dispatchEvent(new Event('focus'));await settle();assert.equal(f.calls.at(-1),'resume');
});

// Execute the actual browser detail reader with deferred HTTP responses.
function detailFixture() {
  const source=readFileSync(new URL('../src/web/controller.ts',import.meta.url),'utf8');
  const state={selectedId:'a',selectionVersion:1,detailVersion:1,detail:{thread:{id:'a'},turns:[]},loadedOlderHistory:false,
    status:{instanceId:'one',connection:{state:'connected'},controlledThreads:[],handoffs:[]}};
  const requests=[],applied=[],cacheReads=[],navigationUpdates=[];
  const context=vm.createContext({createDetailReader,createSelectedRefresh,applyControllerStatus,state,newChatOpen:false,automations:null,desktopSends:{},performance,document:{body:{dataset:{}}},targetHost:'test',setTimeout,mergeLiveTurns,selectConnectionStatus,retiredStatusInstances:new Set(),
    turnNavigation:{update:()=>navigationUpdates.push(state.selectedId)},reportThreadView:()=>null,turns:()=>state.detail?.turns||[],outputBases:()=>new Map(),decodeOutputs:async x=>x,hydrateOutputs:x=>x,
    readDetailCache:()=>new Promise(resolve=>cacheReads.push(resolve)),scheduleDetailRefresh:()=>{},
    api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject})),
    applyDetail:data=>{state.detail=data;applied.push(data);},
  });
  context.restoreDetail=createDetailRecovery({state,host:'test',read:context.readDetailCache,write:async()=>{},apply:context.applyDetail}).restore;
  runController(source.slice(source.indexOf('const readSelectedDetail='),source.indexOf('async function refreshWorkspace('))+'\nglobalThis.read=refreshSelected;',context);
  const ast=ts.createSourceFile('controller.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const applyStatus=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='applyStatus');
  assert.ok(applyStatus,'status controller exists');
  runController(applyStatus.getText(ast)+'\nglobalThis.status=applyStatus;',context);
  return {state,requests,applied,cacheReads,navigationUpdates,context,read:context.read,status:context.status};
}
test('late thread and connection replies cannot overwrite a new selection; duplicate reads coalesce',async()=>{
  const f=detailFixture(),old=f.read(),duplicate=f.read();assert.equal(f.requests.length,1);
  f.state.selectedId='b';f.state.selectionVersion++;f.state.detail={thread:{id:'b'},turns:[]};
  const next=f.read();assert.equal(f.requests.length,2);
  f.requests[1].resolve({thread:{id:'b'},turns:[]});await next;
  f.requests[0].resolve({thread:{id:'a'},turns:[]});await Promise.all([old,duplicate]);
  assert.equal(f.applied.length,1);assert.equal(f.state.detail.thread.id,'b');
  const stale=f.read(),staleDuplicate=f.read();f.status({...f.state.status,connection:{state:'disconnected'}});
  f.status({...f.state.status,connection:{state:'connected'}});
  const fresh=f.read();assert.equal(f.requests.length,4);
  f.requests[3].resolve({thread:{id:'b',name:'fresh'},turns:[]});await fresh;
  f.requests[2].reject(Error('old connection failed'));await Promise.all([stale,staleDuplicate]);
  assert.equal(f.state.detail.thread.name,'fresh');
});

test('a slow runtime resume does not block the preview or overwrite a newer selection',async()=>{
  const f=detailFixture();f.state.detail=null;let release;
  f.context.reportThreadView=()=>new Promise(r=>release=r);
  const read=f.read();assert.equal(f.requests.length,1);assert.match(f.requests[0].path,/preview=1/);
  f.requests[0].resolve({thread:{id:'a'},turns:[]});await settle();assert.equal(f.applied.length,1);
  f.state.selectedId='b';f.state.selectionVersion++;release();await read;
  assert.equal(f.requests.length,1);assert.equal(f.applied.length,1);
});

test('failed runtime resume leaves the read-only preview and propagates the error',async()=>{
  const f=detailFixture();f.state.detail=null;
  f.context.reportThreadView=()=>Promise.reject(Error('resume failed'));
  const read=f.read();f.requests[0].resolve({thread:{id:'a'},controlled:false,turns:[]});
  await assert.rejects(read,/resume failed/);assert.equal(f.state.detail.controlled,false);
});
test('a reply from before handoff cannot restore control after the released status arrives',async()=>{
  const f=detailFixture();f.status({...f.state.status,controlledThreads:['a']});
  const old=f.read();f.status({...f.state.status,controlledThreads:[],handoffs:[{threadId:'a',state:'released'}]});
  const latest=f.read();f.requests[1].resolve({thread:{id:'a'},controlled:false,handoff:{state:'released'},turns:[]});await latest;
  f.requests[0].resolve({thread:{id:'a'},controlled:true,turns:[]});await old;
  assert.equal(f.state.detail.controlled,false);assert.equal(f.state.detail.handoff.state,'released');
});
test('switching away and back starts a new read; older history and streaming output are preserved',async()=>{
  const f=detailFixture(),old=f.read();f.state.selectionVersion+=2;
  f.state.loadedOlderHistory=true;f.state.historyCursor='older-cursor';
  f.state.detail.turns=[{id:'old-history',items:[]},{id:'live',items:[{id:'text',type:'agentMessage',text:'streamed text'}]}];
  const latest=f.read();assert.equal(f.requests.length,2);
  f.requests[1].resolve({thread:{id:'a'},nextCursor:'new-cursor',turns:[{id:'live',items:[{id:'text',text:'stream'}]},{id:'desktop-new',items:[]}]});await latest;
  f.requests[0].resolve({thread:{id:'a',name:'stale'},turns:[]});await old;
  assert.deepEqual(f.state.detail.turns.map(t=>t.id),['old-history','live','desktop-new']);
  assert.equal(f.state.detail.turns[1].items[0].text,'streamed text');assert.equal(f.state.detail.nextCursor,'older-cursor');
});
test('handoff and desktop-owned detail reads see new history without any engine RPC or resubscription',async()=>{
  const m=new Manager({host:{alias:'test'}});m.connection={state:'connected'};
  m.rpc={connected:true,request(){throw Error('A read-only viewer must not touch the engine');}};
  let history=[];m.passive=async action=>action==='detail'?{thread:{id:'desktop'}}:{data:history,historySource:'snapshot'};
  assert.equal((await m.detail('desktop')).turns.length,0);
  for(const state of ['waiting','released','unknown']){
    m.subscriptions.set('desktop',{handoff:{state}});
    history=[{id:'new-'+state,status:'completed',items:[{id:'reply',type:'agentMessage',text:'桌面端的新消息'}]}];
    const result=await m.detail('desktop');assert.equal(result.turns[0].id,'new-'+state);
    assert.equal(result.controlled,false);assert.equal(result.handoff.state,state);
    assert.deepEqual(m.status().subscribedThreads,[]);assert.deepEqual(m.status().controlledThreads,[]);
  }
});

test('new chat draft ignores old detail replies and pauses history reads',async()=>{
  const f=detailFixture(),old=f.read();
  f.context.newChatOpen=true;f.state.selectionVersion++;
  f.requests[0].resolve({thread:{id:'a',name:'stale'},turns:[]});await old;
  await f.read();assert.equal(f.requests.length,1);assert.equal(f.applied.length,0);
  f.context.newChatOpen=false;f.state.selectionVersion++;
  const fresh=f.read();assert.equal(f.requests.length,2);
  f.requests[1].resolve({thread:{id:'a',name:'fresh'},turns:[]});await fresh;
  assert.equal(f.state.detail.thread.name,'fresh');
});

test('structured skill confirmation removes optimistic echo without dropping other image messages',()=>{
  const echo={id:'accepted-t',type:'userMessage',localAccepted:true,content:[{type:'text',text:'$skill hello'},{type:'image',url:'data:image/png;base64,AA'}]};
  const actual={id:'real',type:'userMessage',content:[...echo.content,{type:'skill',name:'skill',path:'/skill/SKILL.md'}]};
  const other={...echo,id:'accepted-other',content:[{type:'text',text:'$skill hello'},{type:'image',url:'data:image/png;base64,BB'}]};
  const result=mergeLiveTurns([{id:'t',items:[echo,other]}],[{id:'t',items:[actual]}]);
  assert.deepEqual(result[0].items.map(i=>i.id),['accepted-other','real']);
  assert.deepEqual(mergeLiveTurns(result,[{id:'t',items:[actual]}]),result);
});


test('native management replies cannot replace a newly selected ordinary chat',async()=>{
  const f=detailFixture();f.state.desktopMode=true;
  const old=f.read();assert.equal(f.requests[0].path,'/api/desktop/threads/a');
  f.state.desktopMode=false;f.state.selectedId='b';f.state.selectionVersion++;
  f.requests[0].resolve({thread:{id:'a'},turns:[],desktop:{receipts:{}}});await old;
  assert.equal(f.applied.length,0);
  f.context.automations={opened:true};await f.read();assert.equal(f.requests.length,1);
});


test('cold history starts HTTP without waiting for recovery and reads cache only once',async()=>{
  const f=detailFixture();f.state.detail=null;
  const read=f.read(),duplicate=f.read();
  assert.equal(f.cacheReads.length,1);assert.equal(f.requests.length,1);
  assert.match(f.requests[0].path,/preview=1/);
  f.requests[0].resolve({thread:{id:'a'},turns:[{id:'fresh',items:[]}]});await settle();
  assert.equal(f.applied.length,1);assert.equal(f.requests.length,2);
  f.cacheReads[0]({thread:{id:'a'},turns:[{id:'stale',items:[]}],recovering:true});await settle();
  assert.equal(f.applied.length,1);
  f.requests[1].resolve({thread:{id:'a'},turns:[{id:'fresh',items:[]}]});await Promise.all([read,duplicate]);
  assert.equal(f.state.detail.turns[0].id,'fresh');
});
test('fast recovery can display while HTTP is pending, without granting control',async()=>{
  const f=detailFixture();f.state.detail=null;
  const read=f.read();
  f.cacheReads[0]({thread:{id:'a'},turns:[],controlled:false,recovering:true});await settle();
  assert.equal(f.state.detail.recovering,true);assert.equal(f.state.detail.controlled,false);
  f.requests[0].resolve({thread:{id:'a'},turns:[],controlled:true});await settle();
  f.requests[1].resolve({thread:{id:'a'},turns:[],controlled:true});await read;
  assert.equal(f.state.detail.controlled,true);assert.equal(f.state.detail.recovering,undefined);
});
test('late recovery ignores changed selections, connection versions and failed reads',async()=>{
  for(const change of [f=>f.state.selectionVersion++,f=>f.state.detailVersion++,f=>f.state.historyError='读取失败']){
    const f=detailFixture();f.state.detail=null;const read=f.read();change(f);
    f.cacheReads[0]({thread:{id:'a'},turns:[],recovering:true});await settle();
    assert.equal(f.applied.length,0);
    f.requests[0].reject(Error('read failed'));await read.catch(()=>{});
  }
});

test('latest-only preview expands in original order while retaining later streamed turns',()=>{
  const result=mergeLiveTurns([{id:'latest',items:[{id:'reply',text:'streamed response'}]},{id:'new-live',items:[]}],[{id:'older-a',items:[]},{id:'older-b',items:[]},{id:'latest',items:[{id:'reply',text:'stream'}]}]);
  assert.deepEqual(result.map(t=>t.id),['older-a','older-b','latest','new-live']);
  assert.equal(result[2].items[0].text,'streamed response');
});

test('a connected-to-connected restart invalidates old detail, process and sidebar activity',async()=>{
  const f=detailFixture();
  f.state.status.connection.connectedAt='old';
  f.state.threads=[{id:'a',status:{type:'active'},activity:{source:'desktop',state:'running'}}];
  f.state.detail.backgroundTerminals={data:[{processId:'old'}]};
  const pending=f.read();
  f.status({...f.state.status,revision:2,connection:{state:'connected',connectedAt:'new'}});
  assert.equal(f.state.threads[0].activity,undefined);
  assert.equal(f.state.threads[0].status.type,'unknown');
  assert.ok(f.state.detail.backgroundTerminals.error);
  f.requests[0].resolve({thread:{id:'a'},backgroundTerminals:{data:[{processId:'old'}]},turns:[]});
  await pending;assert.equal(f.applied.length,0);
  const next=f.read();f.requests[1].resolve({thread:{id:'a'},backgroundTerminals:{data:[]},turns:[]});await next;
  assert.equal(f.state.detail.backgroundTerminals.data.length,0);
});

test('native metadata repairs missed running notifications without overriding newer events or snapshot state',async()=>{
  for(const mode of ['native','event','snapshot','connection']){
    const m=new Manager({host:{alias:'test'}});m.connection={state:'connected'};m.rpc={connected:true};
    const known={status:{type:'active'}};m.controlled.set('a',known);
    let finish;m.readWithFallback=()=>new Promise(resolve=>finish=resolve);
    const pending=m.readThreadMetadata('a',false);
    if(mode==='event')m.onNotification({method:'thread/status/changed',params:{threadId:'a',status:{type:'active',activeFlags:['waiting']}}});
    if(mode==='snapshot')m.passiveMethods.add('thread/read');
    if(mode==='connection')m.generation++;
    finish({thread:{id:'a',status:{type:'idle'}}});await pending;
    assert.equal(known.status.type,mode==='native'?'idle':'active');
  }
});

function viewReportFixture(){
 const requests=[],refreshes=[];
 const state={transport:true,desktopMode:false,selectedId:'a',detailVersion:1,status:{instanceId:'engine-1',connection:{connectedAt:'time-1'}}};
 const context={state,newChatOpen:false,automations:null,sideChat:null};
 const reporter=createThreadViewReporter({viewId:'fixture-page-0001',host:'local',context:()=>context,
  request:(path,options)=>new Promise((resolve,reject)=>requests.push({path,body:structuredClone(options.body),resolve,reject})),refresh:()=>refreshes.push('refresh')});
 return {state,context,requests,refreshes,report:reporter.report,reconnect:reporter.reset};
}
test('page presence merges duplicate reads and preserves a stable view id across reconnect',async()=>{
 const f=viewReportFixture();const first=f.report(),duplicate=f.report();assert.equal(first,duplicate);assert.equal(f.requests.length,1);
 assert.deepEqual(f.requests[0].body,{viewId:'fixture-page-0001',threadId:'a',sideThreadId:null,revision:1});f.requests[0].resolve({ok:true});await first;
 assert.equal(f.report(),first);f.reconnect();const second=f.report();assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1].body,{viewId:'fixture-page-0001',threadId:'a',sideThreadId:null,revision:2});f.requests[1].resolve({ok:true});await second;
});
test('presence hides thread selection on non-thread pages and skips disconnected transport',async()=>{
 const f=viewReportFixture();f.state.transport=false;await f.report();assert.equal(f.requests.length,0);f.state.transport=true;
 for(const mode of ['new','desktop','automations']){
  f.reconnect();f.context.newChatOpen=mode==='new';f.state.desktopMode=mode==='desktop';f.context.automations={opened:mode==='automations'};
  const pending=f.report();assert.equal(f.requests.at(-1).body.threadId,null);f.requests.at(-1).resolve({ok:true});await pending;
 }
 assert.deepEqual(f.requests.map(r=>r.body.revision),[1,2,3]);
});
test('late presence failure cannot discard a newer selection; current failure remains retryable',async()=>{
 const f=viewReportFixture(),old=f.report();const rejected=assert.rejects(old,/old failure/);
 f.state.selectedId='b';const current=f.report();f.requests[0].reject(Error('old failure'));await rejected;assert.equal(f.report(),current);
 f.requests[1].resolve({ok:true});await current;assert.deepEqual(f.refreshes,[]);
 f.state.status.connection.connectedAt='time-2';const failed=f.report();const failure=assert.rejects(failed,/current failure/);f.requests[2].reject(Error('current failure'));await failure;
 const retry=f.report();assert.equal(f.requests[3].body.revision,4);f.requests[3].resolve({ok:true});await retry;
});
test('only the current presence response schedules a detail refresh after runtime restoration',async()=>{
 const f=viewReportFixture(),old=f.report();f.state.selectedId='b';f.state.detailVersion++;
 const current=f.report();f.state.detailVersion++;f.requests[0].resolve({ok:true});await old;assert.deepEqual(f.refreshes,[]);
 f.requests[1].resolve({ok:true});await current;assert.deepEqual(f.refreshes,['refresh']);
});
test('side chat visibility changes presence without changing the main selection',async()=>{
 const f=viewReportFixture();f.context.sideChat={visibleId:'side-a'};const opened=f.report();f.requests[0].resolve({ok:true});await opened;
 assert.equal(f.requests[0].body.threadId,'a');assert.equal(f.requests[0].body.sideThreadId,'side-a');assert.equal(f.report(),opened);
 f.context.sideChat.visibleId=null;const closed=f.report();f.requests[1].resolve({ok:true});await closed;
 assert.equal(f.requests[1].body.threadId,'a');assert.equal(f.requests[1].body.sideThreadId,null);assert.equal(f.requests[1].body.revision,2);
});

test('automatic navigation starts after the current detail settles, never after a failed preview resume',async()=>{
 const f=detailFixture();const read=f.read();assert.deepEqual(f.navigationUpdates,[]);
 f.requests[0].resolve({thread:{id:'a'},turns:[]});await read;assert.deepEqual(f.navigationUpdates,['a']);
 const failed=f.read();f.requests[1].reject(Error('offline'));await assert.rejects(failed,/offline/);assert.deepEqual(f.navigationUpdates,['a']);
});

test('desktop accepted receipts clear only the matching draft and current input',async()=>{
 for(const scenario of ['matching','new-draft','retired','wrong-thread','unaccepted']){
  const draft=scenario==='new-draft'?'新的草稿':'已发送内容';
  const state={desktopMode:true,detail:null,loadingDetail:false,drafts:new Map([['a',draft]])};
  const sends={a:{messageId:'receipt-a',text:'已发送内容'}},input={value:draft};let resized=0,saved=0;
  const payload={thread:{id:scenario==='wrong-thread'?'other':'a'},desktop:{receipts:{'receipt-a':{status:scenario==='unaccepted'?'pending':'accepted'}}},unknown:{native:['完整原文']}};
  const reader=createDetailReader({state,sends,reportView:()=>null,recordError:()=>{},request:async()=>payload,input:()=>input,resizeInput:()=>resized++,saveSends:()=>saved++});
  if(scenario==='wrong-thread'){await assert.rejects(reader('a',()=>true),/桌面会话已变化/);assert.ok(sends.a);assert.equal(saved,0);continue;}
  assert.equal(await reader('a',()=>scenario!=='retired'),payload);
  assert.equal(state.drafts.get('a'),scenario==='matching'||scenario==='retired'?'':draft);
  assert.equal(input.value,scenario==='matching'?'':draft);
  assert.equal(resized,scenario==='matching'?1:0);
  assert.equal(saved,scenario==='unaccepted'?0:1);
  assert.equal(Boolean(sends.a),scenario==='unaccepted');
 }
});

test('detail reader preserves the last fifty output bases and unknown native fields through decoding',async()=>{
 for(const gzip of [false,true]){
  const raw={thread:{id:'a'},unknown:{keep:['中文',1]}},bases=new Map(Array.from({length:60},(_,i)=>['item-'+i,{token:'version-'+i}]));
  const calls=[],order=[];const state={desktopMode:false,detail:{thread:{id:'a'}},loadingDetail:false,drafts:new Map()};
  const reader=createDetailReader({state,sends:{},reportView:()=>Promise.resolve(),recordError:()=>{},request:async(path,options)=>{calls.push({path,options});return raw;},now:()=>0,canDecompress:()=>gzip,turns:()=>[],outputBases:()=>bases,decode:async data=>{order.push('decode');assert.equal(data,raw);return data;},hydrate:(data,received)=>{order.push('hydrate');assert.equal(received,bases);return data;}});
  assert.equal(await reader('a',()=>true),raw);assert.deepEqual(order,['decode','hydrate']);
  assert.equal(calls[0].path,'/api/threads/a?outputEncoding='+(gzip?'gzip-base64':'plain')+'&lazyTools=1');
  assert.deepEqual(JSON.parse(calls[0].options.headers['X-Output-Versions']),Object.fromEntries([...bases].slice(10).map(([id,b])=>[id,b.token])));
  assert.deepEqual(raw.unknown,{keep:['中文',1]});
 }
});

test('detail cache scheduling coalesces slow writes and preserves snapshot identity and signature rules',async()=>{
 const state={selectedId:'a',selectionVersion:1,detailVersion:1,loadingDetail:false,detail:{thread:{id:'a'},turns:[]}};
 const scheduled=[],writes=[];let release;
 const recovery=createDetailRecovery({state,host:'fixture',read:async()=>null,apply:()=>{},defer:(run,delay)=>{scheduled.push({run,delay});return scheduled.length;},write:async(...args)=>{writes.push(args);await new Promise(resolve=>release=resolve);}});
 recovery.saveSoon();recovery.saveSoon();assert.equal(scheduled.length,1);assert.equal(scheduled[0].delay,5000);
 state.selectedId='b';state.detail={thread:{id:'b'},turns:[{id:'turn',items:[{id:'item',text:'original',aggregatedOutput:'large'}]}],unknownNative:{kept:true}};
 const first=scheduled.shift().run();assert.equal(writes.length,1);assert.equal(writes[0][0],'fixture');assert.equal(writes[0][1],'b');assert.strictEqual(writes[0][2],state.detail);
 recovery.saveSoon();assert.equal(scheduled.length,0);release();await first;
 state.detail.turns[0].items[0].aggregatedOutput='changed large output';state.detail.turns[0].items[0].outputCompressed={data:'ignored'};
 recovery.saveSoon();await scheduled.shift().run();assert.equal(writes.length,1);
 state.detail.turns[0].items[0].text='new message';recovery.saveSoon();const second=scheduled.shift().run();assert.equal(writes.length,2);release();await second;
});
test('detail cache skips transient views and permits retry after a failed writer',async()=>{
 const state={selectedId:'a',selectionVersion:1,detailVersion:1,loadingDetail:false,detail:null};const scheduled=[];let writes=0,fail=true;
 const recovery=createDetailRecovery({state,host:'fixture',read:async()=>null,apply:()=>{},defer:run=>{scheduled.push(run);return 1;},write:async()=>{writes++;if(fail)throw Error('fixture write failure');}});
 for(const detail of [null,{recovering:true},{outputPreview:true}]){state.detail=detail;recovery.saveSoon();await scheduled.shift()();}assert.equal(writes,0);
 state.detail={thread:{id:'a'},turns:[]};recovery.saveSoon();await assert.rejects(scheduled.shift()(),/fixture write failure/);fail=false;
 recovery.saveSoon();await scheduled.shift()();assert.equal(writes,2);recovery.saveSoon();await scheduled.shift()();assert.equal(writes,2);
});


test('clearing recovery cancels the queued save without rescheduling it after a failed clear',()=>{
 const state={selectedId:'a',selectionVersion:1,detailVersion:1,loadingDetail:false,detail:{thread:{id:'a'},turns:[]}};
 const handle={fixtureTimer:true},scheduled=[],cancelled=[];
 const recovery=createDetailRecovery({state,host:'fixture',read:async()=>null,write:async()=>{},apply:()=>{},defer:run=>{scheduled.push(run);return handle;},cancel:id=>cancelled.push(id)});
 recovery.saveSoon();recovery.cancelScheduled();assert.strictEqual(cancelled[0],handle);
 recovery.saveSoon();assert.equal(scheduled.length,1);
});

test('status migration preserves native unknown fields and ignores an older revision without cloning',()=>{
 const opaque={future:['原始字段',{value:7}]},incoming={instanceId:'same',revision:3,connection:{state:'connected',connectedAt:'time'},controlledThreads:[],handoffs:[],opaque};
 const state={status:null,selectedId:'a',listVersion:0,loadingThreads:false,threads:[],detailVersion:0,csrf:'token',localRequests:[],detail:null};
 const retired=new Set();applyControllerStatus(state,incoming,retired);
 assert.equal(state.status,incoming);assert.equal(state.status.opaque,opaque);
 applyControllerStatus(state,{...incoming,revision:2,opaque:{incorrect:true}},retired);
 assert.equal(state.status,incoming);assert.equal(state.detailVersion,0);assert.equal(state.csrf,'token');
});

function runController(code,context){return vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,context);}
