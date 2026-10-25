import test from 'node:test';import assert from 'node:assert/strict';
import {readSidebar,sidebarAction,sidebarCapabilities,PINNED_SECTION} from '../src/server/services/sidebar.ts';
import {Sidebar,sidebarGroups} from '../public/sidebar.js';
import {ArchiveSync} from '../lib/archive-sync.mjs';
function fixture(){
 const calls=[];const t={id:'t',name:'Original',revision:'r',archived:false,readRevision:'rr',sectionId:null};
 const layout={data:[t],sections:[{id:'s',revision:'sr',name:'Section'}],projects:[{id:'p'}],accountScope:'a',accountLayoutAvailable:true,preferences:{pinned:'manual'}};
 const m={service:{protocolValidation:{policy:4,unsupportedMethods:[]}},requireConnected(){},requireWritable(){},autoTitles:new Map([['t',{}]]),controlled:new Map(),subscriptions:new Map(),startingTurns:new Set(),activeTurns:new Map(),async notifyDesktopArchive(id,archived){calls.push(['desktop-notify',{id,archived}]);},saveTitles(){},saveSubscriptions(){},publish(){},withMutation:fn=>fn(),passive:async(action)=>action==='sidebar'?structuredClone(layout):{data:[{status:'completed'}]},rpc:{connected:true,request:async(method,params)=>{calls.push([method,params]);if(method==='account/read')return {workspaceRouting:{chatgptAccountId:'account'}};if(method==='thread/read')return {thread:{status:{type:'notLoaded'}}};if(method.endsWith('/list'))return {data:[]};return {};}}};
 return {m,calls,t,layout,input:(action,extra={})=>({action,id:'t',expectedRevision:'r',accountScope:'a',...extra})};
}
test('pin and rename use allowlisted engine writes and protect manual titles',async()=>{
 const {m,calls,input}=fixture();await sidebarAction(m,input('pin',{pinned:true}));assert.deepEqual(calls.at(-1),['thread/section/move',{threadId:'t',sectionId:PINNED_SECTION}]);
 await assert.rejects(sidebarAction(m,input('moveProject',{projectId:'p'})),e=>e.code==='FEATURE_UNAVAILABLE');
 await sidebarAction(m,input('rename',{name:'Manual'}));assert.equal(m.autoTitles.has('t'),false);assert.equal(calls.at(-1)[0],'thread/name/set');
});
test('conflicting revision, account change, busy mutation and unsupported capabilities never write',async()=>{
 for(const kind of ['revision','account','busy','unsupported']){
  const {m,calls,input}=fixture(),p=input('pin',{pinned:true});if(kind==='revision')p.expectedRevision='old';if(kind==='account')p.accountScope='other';if(kind==='busy')m.sidebarMutation=true;if(kind==='unsupported')m.service.protocolValidation.policy=3;
  await assert.rejects(sidebarAction(m,p));assert.ok(calls.every(([name])=>name==='account/read'));
 }
});
test('active or unknown archive status is blocked; idle archive does not interrupt or delete',async()=>{
 for(const status of ['active','unknown']){const {m,input,calls}=fixture();m.rpc.request=async(name,p)=>{calls.push([name,p]);return name==='account/read'?{}:{thread:{status:{type:status}}};};await assert.rejects(sidebarAction(m,input('archive')));assert.ok(!calls.some(([name])=>name==='thread/archive'));}
 const {m,input,calls}=fixture();await sidebarAction(m,input('archive'));assert.deepEqual(calls.slice(-2).map(([name])=>name),['thread/archive','desktop-notify']);assert.ok(!calls.some(([name])=>/interrupt|delete/.test(name)));
});
test('unknown mutation outcome is not replayed and desktop read state is not modified',async()=>{
 const {m,input,calls}=fixture();const request=m.rpc.request;m.rpc.request=async(name,p)=>{if(name==='thread/section/move'){calls.push([name,p]);throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});}return request(name,p);};
 await assert.rejects(sidebarAction(m,input('pin',{pinned:true})),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(calls.filter(([n])=>n==='thread/section/move').length,1);assert.equal(sidebarCapabilities(m,{}).read.supported,false);assert.equal(m.sidebarMutation,false);
});
test('section rendering deduplicates pins and preserves unassigned chats without fake projects',()=>{
 const t={id:'t'},u={id:'u'};const s={data:[t,u],projects:[{id:'p',threadIds:['t']}],sections:[{id:'s',projectIds:['p'],threadIds:[]}],rootThreadIds:['u'],rootProjectIds:['p'],pinnedThreadIds:['t'],pinnedProjectIds:[],sectionOrder:[]};
 const groups=sidebarGroups(s);assert.equal(groups.find(g=>g.id==='pinned').items[0].value.id,'t');assert.equal(groups.find(g=>g.id==='s').items[0].children.length,0);assert.deepEqual(groups.find(g=>g.id==='chats').items.map(i=>i.value.id),['u']);
});
test('pinned server thread order respects interleaved projects; list modes flatten only root projects',()=>{
 const t={id:'t',recencyAt:10},u={id:'u',recencyAt:11},v={id:'v',recencyAt:12};
 const s={data:[t,u,v],projects:[{id:'p',threadIds:[]},{id:'root',threadIds:['v']}],sections:[],rootThreadIds:[],rootProjectIds:['root'],pinnedThreadIds:['u','t'],pinnedProjectIds:['p'],pinnedOrder:['thread:t','project:p','thread:u'],preferences:{pinned:'manual',grouping:'list'},sectionOrder:[]};
 const groups=sidebarGroups(s);assert.deepEqual(groups[0].items.map(i=>i.value.id),['u','p','t']);assert.deepEqual(groups[1].items.map(i=>i.value.id),['v']);
 s.preferences.grouping='connection';assert.equal(sidebarGroups(s)[1].id,'threads');
 s.preferences.grouping='project';assert.equal(sidebarGroups(s)[1].items[0].kind,'project');
});
test('manual rename waits for any automatic title write already in flight',async()=>{
 const {m,input,calls}=fixture();let finish;const job=new Promise(resolve=>{finish=resolve;});m.titleJobs=new Map([['t',job]]);
 const action=sidebarAction(m,input('rename',{name:'Manual'}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(m.autoTitles.get('t').manual,true);assert.ok(!calls.some(([name])=>name==='thread/name/set'));
 finish();await action;assert.equal(calls.at(-1)[1].name,'Manual');
});
test('archive refuses background activity and cannot reorder outside pinned manual sort',async()=>{
 for(const busy of ['goal','queue','background']){
  const {m,input,calls}=fixture(),original=m.rpc.request;
  m.rpc.request=async(method,p)=>method==='thread/goal/get'&&busy==='goal'?{goal:{status:'active'}}:method==='thread/queue/list'&&busy==='queue'?{data:[{}]}:method==='thread/backgroundTerminals/list'&&busy==='background'?{data:[{}]}:original(method,p);
  await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='THREAD_BUSY');assert.ok(!calls.some(([m])=>m==='thread/archive'));
 }
 const {m,input,t}=fixture();t.sectionId='s';await assert.rejects(sidebarAction(m,input('reorderThread',{beforeThreadId:null})));
});

test('account read failures cannot publish an empty layout or reuse an old account',async()=>{
 const {m}=fixture();const reads=[];const passive=m.passive;
 m.passive=async(action,params)=>{reads.push(params.accountId);return passive(action,params);};
 await readSidebar(m);assert.deepEqual(reads,['account']);
 for(const code of ['RPC_TIMEOUT','RPC_DISCONNECTED']){
  m.rpc.request=async()=>{throw Object.assign(Error('identity unavailable'),{code});};
  await assert.rejects(readSidebar(m),e=>e.code===code);
  assert.deepEqual(reads,['account']);
 }
 m.rpc.request=async()=>({workspaceRouting:{chatgptAccountId:'new-account'}});
 await readSidebar(m);assert.deepEqual(reads,['account','new-account']);
 m.rpc.request=async()=>({account:null,workspaceRouting:null});
 await readSidebar(m);assert.deepEqual(reads,['account','new-account',null]);
});
test('first-load identity failure rejects instead of manufacturing a successful ungrouped sidebar',async()=>{
 const {m}=fixture();let passiveReads=0;m.passive=async()=>{passiveReads++;};
 m.rpc.request=async()=>{throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});};
 await assert.rejects(readSidebar(m),e=>e.code==='RPC_TIMEOUT');assert.equal(passiveReads,0);
});

test('archive notification failure reports persisted partial success and never retries the mutation',async()=>{
 const {m,input,calls}=fixture();m.notifyDesktopArchive=async()=>{throw Error('offline');};
 await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='DESKTOP_SYNC_FAILED'&&e.message.includes('已归档'));
 assert.equal(calls.filter(([name])=>name==='thread/archive').length,1);assert.equal(m.sidebarMutation,false);
});
test('restore notifies desktop only after successful engine write',async()=>{
 const {m,input,calls}=fixture();await sidebarAction(m,input('restore'));
 assert.deepEqual(calls.slice(-2),[['thread/unarchive',{threadId:'t'}],['desktop-notify',{id:'t',archived:false}]]);
 const original=m.rpc.request;m.rpc.request=async(name,p)=>{if(name==='thread/archive')throw Error('denied');return original(name,p);};
 const count=calls.filter(([n])=>n==='desktop-notify').length;
 await assert.rejects(sidebarAction(m,input('archive')));assert.equal(calls.filter(([n])=>n==='desktop-notify').length,count);
});
test('archive timeout reconciles persisted state without replay and only then notifies desktop',async()=>{
 for(const confirmed of [true,false]){
  const {m,input,calls}=fixture(),rpc=m.rpc.request,passive=m.passive;
  m.rpc.request=async(name,p)=>{if(name==='thread/archive'){calls.push([name,p]);throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});}return rpc(name,p);};
  m.passive=async(action,p)=>action==='detail'?{thread:{archived:confirmed}}:passive(action,p);
  if(confirmed)assert.equal((await sidebarAction(m,input('archive'))).result.confirmedFromSnapshot,true);
  else await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='OUTCOME_UNKNOWN');
  assert.equal(calls.filter(([n])=>n==='thread/archive').length,1);
  assert.equal(calls.filter(([n])=>n==='desktop-notify').length,confirmed?1:0);
 }
});
test('sidebar refresh finishes delayed archive after an unknown result without a second engine write',async()=>{
 const {m,input,calls,t}=fixture(),rpc=m.rpc.request,passive=m.passive;
 m.archiveSync=new ArchiveSync(m);
 m.passive=async(action,p)=>action==='detail'?{thread:{archived:t.archived}}:passive(action,p);
 m.rpc.request=async(name,p)=>{if(name==='thread/archive'){calls.push([name,p]);throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});}return rpc(name,p);};
 await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='OUTCOME_UNKNOWN');
 assert.equal(m.archiveSync.pending.size,1);assert.ok(!calls.some(([n])=>n==='desktop-notify'));
 t.archived=true;await readSidebar(m);await m.archiveSync.flush('a');
 assert.equal(m.archiveSync.pending.size,0);assert.equal(calls.filter(([n])=>n==='thread/archive').length,1);
 assert.deepEqual(calls.find(([n])=>n==='desktop-notify'),['desktop-notify',{id:'t',archived:true}]);
});
test('an explicit engine rejection removes intent and cannot cause a later notification',async()=>{
 const {m,input,calls}=fixture(),rpc=m.rpc.request;m.archiveSync=new ArchiveSync(m);
 m.rpc.request=async(name,p)=>{if(name==='thread/archive')throw Error('archive rejected');return rpc(name,p);};
 await assert.rejects(sidebarAction(m,input('archive')),/archive rejected/);
 await readSidebar(m);assert.equal(m.archiveSync.pending.size,0);assert.ok(!calls.some(([n])=>n==='desktop-notify'));
});
test('desktop writer conflict is actionable and never hides or notifies an unarchived thread',async()=>{
 const {m,input,calls}=fixture(),rpc=m.rpc.request;m.archiveSync=new ArchiveSync(m);
 m.rpc.request=async(name,p)=>{if(name==='thread/archive')throw Error('thread t already has an active writer');return rpc(name,p);};
 await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='THREAD_WRITER_CONFLICT'&&e.status===409);
 assert.equal(m.archiveSync.pending.size,0);assert.ok(!calls.some(([n])=>n==='desktop-notify'));
});

test('sidebar reads do not wait for pending desktop notification delivery',async()=>{
 const {m}=fixture();let finish;const delivery=new Promise(resolve=>finish=resolve);
 m.archiveSync={flush:()=>delivery};
 try{await readSidebar(m);assert.equal(m.sidebarAccountId,'account');}finally{finish();}
});
test('sidebar failure is visible and controls unlock before a stalled refresh completes',async()=>{
 const events=[];let finish;
 const ui={render(){},enqueue:Sidebar.prototype.enqueue,pending:false,snapshot:{accountScope:'a'},progress:{},setBusy(value){events.push(['busy',value]);},focusAnchor(){},
 o:{connected:()=>true,api:async()=>{throw Error('目标响应超时');},toast:message=>{events.push(message);return {remove(){}};},refresh:()=>new Promise(resolve=>{events.push('refresh');finish=resolve;})}};
 await Sidebar.prototype.run.call(ui,'archive',{id:'t',revision:'r'});
 assert.ok(events.indexOf('目标响应超时')<events.indexOf('refresh'));assert.equal(ui.pending,false);assert.deepEqual(events.at(-1),['busy',false]);finish();
});
test('successful mutation stays silent before list refresh and distinguishes a refresh failure',async()=>{
 const events=[];const ui={render(){},enqueue:Sidebar.prototype.enqueue,pending:false,snapshot:{accountScope:'a'},progress:{},setBusy(){},focusAnchor(){},o:{connected:()=>true,api:async()=>{},toast:message=>{events.push(message);return {remove(){}};},changed:async()=>{assert.ok(!events.includes('会话已归档'));throw Error('列表超时');},refresh:async()=>{}}};
 await Sidebar.prototype.run.call(ui,'archive',{id:'t'});
 assert.ok(events.includes('操作已完成，但刷新失败：列表超时'));assert.equal(ui.pending,false);
});

test('archive reads native history without opening passive history or taking ownership',async()=>{
 const {m,input,calls}=fixture(),passive=m.passive,rpc=m.rpc.request;
 m.passive=async(action,p)=>{if(action==='history')assert.fail('must not open the passive history database');return passive(action,p);};
 m.rpc.request=async(method,p)=>{if(method==='thread/turns/list'){calls.push([method,p]);return {data:[{status:'completed'}]};}return rpc(method,p);};
 await sidebarAction(m,input('archive'));
 assert.deepEqual(calls.find(([name])=>name==='thread/turns/list'),['thread/turns/list',{threadId:'t',limit:5,sortDirection:'desc',itemsView:'summary'}]);
 assert.equal(calls.filter(([name])=>name==='thread/archive').length,1);
 assert.ok(!calls.some(([name])=>/resume|interrupt|start$/.test(name)));
});
test('archive native history fails closed for active, unknown, malformed and failed native reads',async()=>{
 for(const result of [{data:[{status:'inProgress'}]},{data:[{status:'unknown'}]},{},null,Error('native unavailable')]){
  const {m,input,calls}=fixture(),passive=m.passive,rpc=m.rpc.request;
  m.passive=async(action,p)=>{if(action==='history')assert.fail('must not open the passive history database');return passive(action,p);};
  m.rpc.request=async(method,p)=>{if(method==='thread/turns/list'){if(result instanceof Error)throw result;return result;}return rpc(method,p);};
  await assert.rejects(sidebarAction(m,input('archive')));
  assert.ok(!calls.some(([name])=>name==='thread/archive'||name==='desktop-notify'));assert.equal(m.sidebarMutation,false);
 }
});
test('archive refuses unavailable native history without attempting a write',async()=>{
 const {m,input,calls}=fixture();m.service.protocolValidation.unsupportedMethods.push('thread/turns/list');
 await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='FEATURE_UNAVAILABLE');
 assert.ok(!calls.some(([name])=>['thread/turns/list','thread/archive','desktop-notify'].includes(name)));
});

function failedThreadFixture(turns=[{id:'failed-turn',status:'failed',completedAt:123}]){
 const f=fixture(),request=f.m.rpc.request;
 f.m.rpc.request=async(method,p)=>{
  if(method==='thread/read'){f.calls.push([method,p]);return {thread:{status:{type:'systemError'}}};}
  if(method==='thread/turns/list'){f.calls.push([method,p]);return {data:turns};}
  return request(method,p);
 };
 return f;
}
test('native systemError archives terminal history once without resuming or retrying execution',async()=>{
 const {m,input,calls}=failedThreadFixture([{status:'failed'},{status:'interrupted'},{status:'completed'}]);
 await sidebarAction(m,input('archive'));
 assert.equal(calls.filter(([name])=>name==='thread/archive').length,1);
 assert.equal(calls.filter(([name])=>name==='thread/read').length,1);
 assert.equal(calls.filter(([name])=>name==='thread/turns/list').length,1);
 assert.ok(!calls.some(([name])=>/resume|interrupt|start$/.test(name)));
 assert.equal(calls.at(-1)[0],'desktop-notify');
});
test('systemError without terminal history fails closed and records status-only diagnostics',async()=>{
 for(const turns of [[],[{id:'x',status:'unknown',text:'private content'}],[null]]){
  const {m,input,calls}=failedThreadFixture(turns),records=[];m.record=(...args)=>records.push(args);
  await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='STATUS_UNKNOWN'&&e.details.threadStatus==='systemError'&&e.message.includes('连接诊断'));
  assert.equal(records.length,1);assert.equal(records[0][2].diagnosticOnly,true);
  assert.ok(!records[0][0].message.includes('private content'));
  assert.ok(!calls.some(([name])=>name==='thread/archive'||name==='desktop-notify'));
 }
});
test('failed thread still refuses running turns, background work, queues, goals and pending requests',async()=>{
 for(const busy of ['turn','background','queue','goal','request','question']){
  const {m,input,calls}=failedThreadFixture(busy==='turn'?[{status:'inProgress'}]:undefined),request=m.rpc.request;
  m.rpc.request=async(method,p)=>{
   if(method==='thread/backgroundTerminals/list'&&busy==='background')return {data:[{}]};
   if(method==='thread/queue/list'&&busy==='queue')return {data:[{}]};
   if(method==='thread/goal/get'&&busy==='goal')return {goal:{status:'active'}};
   return request(method,p);
  };
  if(busy==='request')m.requests=new Map([['r',{threadId:'t'}]]);
  if(busy==='question')m.pendingQuestions={entries:new Map([['q',{threadId:'t'}]])};
  await assert.rejects(sidebarAction(m,input('archive')),e=>e.code==='THREAD_BUSY');
  assert.ok(!calls.some(([name])=>name==='thread/archive'));
 }
});
test('archive rechecks connection, account and activity after asynchronous checks',async()=>{
 for(const change of ['connection','account','turn','request']){
  const {m,input,calls}=failedThreadFixture(),request=m.rpc.request;
  m.rpc.request=async(method,p)=>{
   const result=await request(method,p);
   if(method==='thread/queue/list'){
    if(change==='connection')m.generation=1;
    if(change==='account')m.accountRevision=1;
    if(change==='turn')m.activeTurns.set('t','new-turn');
    if(change==='request')m.requests=new Map([['r',{threadId:'t'}]]);
   }
   return result;
  };
  await assert.rejects(sidebarAction(m,input('archive')),e=>['CONNECTION_CHANGED','THREAD_BUSY'].includes(e.code));
  assert.ok(!calls.some(([name])=>name==='thread/archive'||name==='desktop-notify'));
  assert.equal(m.sidebarMutation,false);
 }
});

function queuedUI(api,changed=async()=>{}){
 const messages=[];
 const ui=Object.assign(Object.create(Sidebar.prototype),{snapshot:{accountScope:'a'},render(){},progress:{},setBusy(){},focusAnchor(){},undo(){},o:{connected:()=>true,api,changed,refresh:async()=>{},toast:message=>{messages.push(message);return {remove(){}};}}});
 return {ui,messages};
}
test('sidebar queues different targets, rejects duplicate clicks, and proceeds before a stalled refresh',async()=>{
 const writes=[];let finishFirst,finishRefresh;
 const refresh=new Promise(resolve=>{finishRefresh=resolve;});
 const {ui}=queuedUI(async(_url,{body})=>{writes.push(body.id);if(body.id==='a')await new Promise(resolve=>{finishFirst=resolve;});},async(_action,t)=>{if(t.id==='a')await refresh;});
 const a=ui.run('archive',{id:'a'}),b=ui.run('archive',{id:'b'});
 await ui.run('archive',{id:'a'});await new Promise(setImmediate);
 assert.deepEqual(writes,['a']);assert.equal(ui.operations.size,2);
 finishFirst();await b;assert.deepEqual(writes,['a','b']);assert.equal(ui.operations.size,1);
 finishRefresh();await a;assert.equal(ui.pending,false);
});
test('a failed archive does not cancel the next operation or replay the failed write',async()=>{
 const writes=[];const {ui,messages}=queuedUI(async(_url,{body})=>{writes.push(body.id);if(body.id==='a')throw Error('归档失败');});
 await Promise.all([ui.run('archive',{id:'a'}),ui.run('archive',{id:'b'})]);
 assert.deepEqual(writes,['a','b']);assert.ok(messages.includes('归档失败'));assert.equal(ui.pending,false);
});
test('account change cancels queued writes and ignores late success',async()=>{
 let finish;const writes=[],changes=[];
 const {ui,messages}=queuedUI(async(_url,{body})=>{writes.push(body.id);await new Promise(resolve=>{finish=resolve;});},async()=>changes.push('changed'));
 const a=ui.run('archive',{id:'a'}),b=ui.run('archive',{id:'b'});await new Promise(setImmediate);
 ui.snapshot={accountScope:'new'};finish();await Promise.all([a,b]);
 assert.deepEqual(writes,['a']);assert.deepEqual(changes,[]);assert.ok(!messages.includes('会话已归档'));assert.equal(ui.pending,false);
});

test('archive hides immediately through stale refreshes and rolls back without waiting for failure refresh',async()=>{
 let reject;const {ui,messages}=queuedUI(()=>new Promise((_,r)=>reject=r));
 const t={id:'a'},other={id:'b'};ui.snapshot={accountScope:'a',data:[t,other]};
 const shown=[];ui.render=function(s){shown.push(this.archiveDisplay(s).data.map(t=>t.id));};
 const work=ui.run('archive',t);assert.deepEqual(shown.at(-1),['b']);
 assert.deepEqual(ui.snapshot.data,[t,other]);
 ui.render({...ui.snapshot});assert.deepEqual(shown.at(-1),['b']);
 assert.deepEqual(ui.archiveDisplay({...ui.snapshot,accountScope:'other'}).data,[t,other]);
 await new Promise(setImmediate);reject(Error('权限不足'));await work;
 assert.deepEqual(shown.at(-1),['a','b']);assert.ok(messages.includes('权限不足'));
});
test('confirmed archive stays hidden when refresh fails, but remains visible in archived view',async()=>{
 const {ui}=queuedUI(async()=>{},async()=>{throw Error('刷新失败');});
 const t={id:'a'};ui.snapshot={accountScope:'a',data:[t]};await ui.run('archive',t);
 assert.deepEqual(ui.archiveDisplay(ui.snapshot).data,[]);
 assert.deepEqual(ui.archiveDisplay({...ui.snapshot,archived:true}).data,[t]);
});

test('sidebar success refreshes the result without a success toast and preserves refresh errors',async()=>{
 for(const action of ['archive','restore','rename','pin','moveProject','moveSection','read','reorderThread','createSection','renameSection','deleteSection']){
  const changes=[];const {ui,messages}=queuedUI(async()=>{},async a=>changes.push(a));
  await ui.run(action,{id:'a'});
  assert.deepEqual(changes,[action]);
  assert.deepEqual(messages,[],'no floating progress or success notice for '+action);
 }
 const {ui,messages}=queuedUI(async()=>{},async()=>{throw Error('列表不可用');});
 await ui.run('archive',{id:'a'});
 assert.ok(messages.includes('操作已完成，但刷新失败：列表不可用'));
});


test('sidebar dialog errors propagate once without a duplicate floating alert',async()=>{
 const {ui,messages}=queuedUI(async()=>{throw Error('无法重命名');});
 await assert.rejects(ui.run('rename',{id:'a'},{name:'new'},true),/无法重命名/);
 assert.deepEqual(messages,[]);assert.equal(ui.pending,false);
 const next=queuedUI(async()=>{},async()=>{throw Error('列表不可用');});
 await assert.rejects(next.ui.run('rename',{id:'a'},{name:'new'},true),/操作已完成，但刷新失败：列表不可用/);
 assert.deepEqual(next.messages,[]);
});
