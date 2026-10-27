import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import ts from 'typescript';
const loaderSource=readFileSync(new URL('../src/web/services/sidebar-loader.ts',import.meta.url),'utf8');
const output=ts.transpileModule(loaderSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createSidebarLoader}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const source=readFileSync(new URL('../src/web/controller.ts',import.meta.url),'utf8');
const readerSource=readFileSync(new URL('../src/web/services/sidebar-reader.ts',import.meta.url),'utf8');
const readerOutput=ts.transpileModule(readerSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createSidebarReader}=await import('data:text/javascript;base64,'+Buffer.from(readerOutput).toString('base64'));

const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const tick=()=>new Promise(r=>setImmediate(r));
function loader(readThreads){const state={status:{instanceId:'one',connection:{connectedAt:1}},search:'',selectedId:'a'};return {state,load:createSidebarLoader({key:append=>JSON.stringify([state.status.instanceId,state.status.connection.connectedAt,state.search,state.selectedId,append]),read:readThreads})};}
test('same sidebar reads share work while explicit refresh queues a fresh read',async()=>{
 const d=gate();let calls=0;const f=loader(()=>++calls===1?d.promise:Promise.resolve());const a=f.load(),b=f.load(),fresh=f.load(false,true,true);assert.equal(calls,1);d.resolve();await Promise.all([a,b,fresh]);assert.equal(calls,2);
 const d2=gate(),g=loader(()=>d2.promise);const silent=g.load(),visible=g.load(false,true);d2.reject(Error('unavailable'));await silent;await assert.rejects(visible,/unavailable/);
});
test('sidebar search and connection changes never share an old pending read',async()=>{
 let calls=0;const d=gate(),f=loader(()=>{calls++;return d.promise;});const a=f.load();f.state.search='new';const b=f.load();f.state.status.connection.connectedAt=2;const c=f.load();assert.equal(calls,3);d.resolve();await Promise.all([a,b,c]);
});
test('older sidebar completion cannot clear a newer pending read',async()=>{
 const old=gate(),current=gate();let calls=0;
 const f=loader(()=>++calls===1?old.promise:current.promise);
 const a=f.load(false,true);f.state.search='new';const b=f.load(false,true);
 old.resolve();await a;
 assert.equal(f.load(false,true),b);assert.equal(calls,2);
 current.resolve();await b;
});
test('account refresh can drain a snapshot of the pending sidebar read without starting work',async()=>{
 const old=gate(),next=gate();let calls=0,drained=false;
 const f=loader(()=>++calls===1?old.promise:next.promise);
 assert.equal(f.load.pending(),undefined);
 const first=f.load();const snapshot=f.load.pending();
 const drain=Promise.allSettled([snapshot]).then(()=>{drained=true;});
 f.state.selectedId='b';const second=f.load(false,true);
 assert.equal(f.load.pending(),second);assert.notEqual(snapshot,second);
 await tick();assert.equal(drained,false);assert.equal(calls,2);
 old.reject(Error('old account unavailable'));await first;await drain;
 assert.equal(drained,true);assert.equal(f.load.pending(),second);assert.equal(calls,2);
 next.resolve();await second;assert.equal(f.load.pending(),undefined);
});
test('fresh sidebar refresh rechecks current selection after failure and coalesces queued refreshes',async()=>{
 const old=gate(),next=gate(),seen=[];
 const f=loader(append=>{seen.push({selected:f.state.selectedId,append});return seen.length===1?old.promise:next.promise;});
 const initial=f.load(),one=f.load(false,true,true),two=f.load(false,true,true);
 f.state.selectedId='b';old.reject(Error('old read failed'));
 await initial;await tick();assert.deepEqual(seen,[{selected:'a',append:false},{selected:'b',append:false}]);
 next.resolve();await Promise.all([one,two]);
});
test('append sidebar reads remain distinct and subsequent reads retry after failure',async()=>{
 const first=gate(),second=gate();let calls=0;const args=[];
 const f=loader(append=>{args.push(append);return ++calls===1?first.promise:second.promise;});
 const a=f.load(false,true),b=f.load(true,true);assert.equal(calls,2);
 first.resolve();second.reject(Error('append failed'));await a;await assert.rejects(b,/append failed/);
 await assert.rejects(f.load(true,true),/append failed/);assert.deepEqual(args,[false,true,true]);
});
test('late activity is ignored after a new snapshot, account, disconnect or connection generation',async()=>{
 for(const change of ['snapshot','account','disconnect','connection','none']){
  const d=gate(),snapshot={accountScope:'account',data:[{id:'a'}]},state={listVersion:1,sidebar:snapshot,threads:[{id:'a'}],status:{instanceId:'one',connection:{connectedAt:1}}};let connected=true,renders=0;
  const c=vm.createContext({state,connected:()=>connected,api:()=>d.promise,URLSearchParams,renderThreads:()=>renders++,recordError(){}});
  Object.assign(c,createSidebarReader(c));
  const pending=c.loadSidebarActivity(snapshot,1);await tick();
  if(change==='snapshot')state.sidebar={...snapshot};if(change==='disconnect')connected=false;if(change==='connection')state.status.connection.connectedAt=2;
  d.resolve({accountScope:change==='account'?'other':'account',data:[{id:'a',activity:{observedAt:123}}]});await pending;
  assert.equal(renders,['none','account'].includes(change)?1:0);if(change==='account')assert.equal(snapshot.activityPhase,'error');assert.equal(state.threads[0].activity?.observedAt,change==='none'?123:undefined);
 }
});

test('manual refresh clears progress on success without a success timer; errors remain visible',async()=>{
 const state={},frames=[],timers=[],errors=[];
 const c=vm.createContext({state,Date,refreshNoticeTimer:null,clearTimeout(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},renderRefresh:()=>frames.push({...state}),recordError:e=>errors.push(e)});
 runController(source.slice(source.indexOf('async function showRefresh('),source.indexOf('function recordError(')),c);
 const d=gate(),pending=c.showRefresh('项目',()=>d.promise);
 assert.equal(state.refreshing,true);assert.match(state.refreshMessage,/正在刷新/);
 d.resolve();await pending;
 assert.equal(state.refreshing,false);assert.equal(state.refreshMessage,'');assert.ok(state.lastSync);assert.equal(timers.length,0);
 await c.showRefresh('项目',async()=>{throw Error('连接失败');});
 assert.match(state.refreshMessage,/刷新失败：连接失败/);assert.equal(errors.length,1);assert.equal(timers.at(-1).ms,8000);
 timers.at(-1).fn();assert.equal(state.refreshMessage,'');
});

function readerFixture(api){
 const state={status:{instanceId:'one',connection:{connectedAt:1}},projectId:null,projects:[],listVersion:0,loadingThreads:false,threadPageError:false,search:'',threads:[],threadCursor:null,selectedId:'a',sidebarArchived:false,sidebar:null,selectedArchived:false,threadListSource:null};
 const calls=[],errors=[],frames=[],createdThreads=new Map(),element={scrollTop:50,clientHeight:0,scrollHeight:0};
 const reader=createSidebarReader({state,createdThreads,connected:()=>true,loadProjects:async()=>{},threadName:t=>t.title||t.id,element:()=>element,renderThreads(){},renderControls(){},api,loadThreads:async(...args)=>{calls.push(args);},recordError:(e,stage)=>errors.push({message:e.message,stage}),toast(){},messageOf:String,requestAnimationFrame:fn=>frames.push(fn)});
 return {state,createdThreads,element,calls,errors,frames,...reader};
}
test('older sidebar success or failure cannot replace the latest search result or loading state',async()=>{
 for(const fail of [false,true]){
  const old=gate(),current=gate();let n=0;
  const f=readerFixture(url=>url.startsWith('/api/sidebar/activity?')?Promise.resolve({accountScope:'new',data:[]}):++n===1?old.promise:current.promise);
  const first=f.readThreads(false,true);f.state.search='new';const next=f.readThreads();
  if(fail)old.reject(Error('old failed'));else old.resolve({accountScope:'old',data:[{id:'old'}]});
  if(fail)await assert.rejects(first,/old failed/);else await first;
  assert.equal(f.state.loadingThreads,true);assert.equal(f.state.threadPageError,false);assert.deepEqual(f.errors,[]);assert.deepEqual(f.state.threads,[]);
  current.resolve({accountScope:'new',data:[{id:'new'}],nextCursor:'next'});await next;
  assert.deepEqual(f.state.threads.map(t=>t.id),['new']);assert.equal(f.state.threadCursor,'next');assert.equal(f.state.loadingThreads,false);assert.equal(f.frames.length,1);
 }
});
test('append account change discards optimistic entries and requests a fresh unpaginated read',async()=>{
 const paths=[],f=readerFixture(async path=>{paths.push(path);return {accountScope:'new',data:[{id:'new'}]};});
 f.state.sidebar={accountScope:'old'};f.state.threads=[{id:'old'}];f.state.threadCursor='cursor';f.createdThreads.set('pending',{id:'pending'});
 await f.readThreads(true,true);
 assert.equal(new URL(paths[0],'http://test').searchParams.get('cursor'),'cursor');assert.equal(f.createdThreads.size,0);assert.deepEqual(f.calls,[[false,false,true]]);assert.deepEqual(f.state.threads.map(t=>t.id),['old']);assert.equal(paths.length,1);
});
test('activity batches keep raw extension fields and remove an explicitly absent activity',async()=>{
 const activity={running:true,future:{text:'原始字段'}},ids=Array.from({length:201},(_,i)=>({id:String(i),activity:{old:true}})),paths=[];
 const f=readerFixture(async path=>{paths.push(path);const batch=JSON.parse(new URL(path,'http://test').searchParams.get('ids'));return {accountScope:'same',data:batch.map(id=>({id,activity:id==='0'?null:activity}))};});
 const snapshot={accountScope:'same',data:ids};f.state.sidebar=snapshot;f.state.threads=ids;f.state.listVersion=1;
 await f.loadSidebarActivity(snapshot,1);
 assert.equal(paths.length,2);assert.deepEqual(paths.map(path=>JSON.parse(new URL(path,'http://test').searchParams.get('ids')).length),[200,1]);assert.equal('activity' in ids[0],false);assert.equal(ids[200].activity,activity);assert.equal(ids[1].activity.future.text,'原始字段');
});

function runController(code,context){return vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,context);}

test('activity batches remain pending until the final batch, and failure can be retried',async()=>{
 const last=gate(),ids=Array.from({length:201},(_,i)=>({id:String(i)}));let n=0;
 const f=readerFixture(async()=>++n===1?{accountScope:'same',data:[]}:last.promise);
 const snapshot={accountScope:'same',data:ids,activityPhase:'loading'};f.state.sidebar=snapshot;f.state.threads=ids;f.state.listVersion=1;
 const pending=f.loadSidebarActivity(snapshot,1);await tick();assert.equal(snapshot.activityPhase,'loading');
 last.reject(Error('offline'));await pending;assert.equal(snapshot.activityPhase,'error');
 const empty={accountScope:'same',data:[],activityPhase:'loading'};f.state.sidebar=empty;
 await f.loadSidebarActivity(empty,1);assert.equal(empty.activityPhase,'ready');
});
