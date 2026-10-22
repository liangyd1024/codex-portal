import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installThreadSync} from '../public/thread-sync.js';
import {mergeLiveTurns,selectConnectionStatus} from '../public/connection-state.js';
import {Manager} from '../lib/manager.mjs';

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
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const state={selectedId:'a',selectionVersion:1,detailVersion:1,detail:{thread:{id:'a'},turns:[]},loadedOlderHistory:false,
    status:{instanceId:'one',connection:{state:'connected'},controlledThreads:[],handoffs:[]}};
  const requests=[],applied=[],cacheReads=[];
  const context=vm.createContext({state,newChatOpen:false,automations:null,desktopSends:{},performance,document:{body:{dataset:{}}},targetHost:'test',setTimeout,mergeLiveTurns,selectConnectionStatus,retiredStatusInstances:new Set(),
    turns:()=>state.detail?.turns||[],outputBases:()=>new Map(),decodeOutputs:async x=>x,hydrateOutputs:x=>x,
    readDetailCache:()=>new Promise(resolve=>cacheReads.push(resolve)),scheduleDetailRefresh:()=>{},
    api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject})),
    applyDetail:data=>{state.detail=data;applied.push(data);},
  });
  vm.runInContext(source.slice(source.indexOf('async function restoreDetail('),source.indexOf('function applyDetail(')),context);
  vm.runInContext(source.slice(source.indexOf('async function readSelectedDetail('),source.indexOf('async function refreshWorkspace('))+'\nglobalThis.read=refreshSelected;',context);
  vm.runInContext(source.slice(source.indexOf('function applyStatus('),source.indexOf('\nconst $'))+'\nglobalThis.status=applyStatus;',context);
  return {state,requests,applied,cacheReads,context,read:context.read,status:context.status};
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
