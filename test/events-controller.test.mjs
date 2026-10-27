import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/events.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createEventHandler}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const turns=[],calls=[],state={selectedId:'a',listVersion:0,sidebar:{},threads:[{id:'a'}],projects:[{}],models:[{}],threadCursor:'cursor',localRequests:[],status:{connection:{state:'connected',connectedAt:'one'},service:{},pendingRequests:[]},detail:{thread:{id:'a'},pendingRequests:[]},runtimeNotices:new Map()};let version=0,pending=Promise.resolve();
 const record=name=>(...args)=>calls.push({name,args});
 const ensureTurn=id=>{let t=turns.find(t=>t.id===id);if(!t){t={id,items:[]};turns.push(t);}return t;};
 const loadThreads=Object.assign(record('threads'),{pending:()=>pending});
 const deps={state,sideChat:()=>({event:record('side')}),accountVersion:{next:()=>++version,get:()=>version},createdThreads:new Map([['old',{}]]),workspaceStarting:()=>false,
  renderThreads:record('renderThreads'),renderProjects:record('renderProjects'),renderModels:record('renderModels'),refreshAccountUsage:record('usage'),catalogs:{pendingModels:()=>pending,pendingProjects:()=>pending},loadThreads,loadModels:record('models'),loadProjects:record('projects'),connected:()=>state.status.connection.state==='connected',recordError:record('error'),scheduleListRefresh:record('list'),scheduleDetailRefresh:record('detail'),scheduleStreamRender:record('stream'),authRecoveryMessage:()=>false,notifyTaskEvent:record('notify'),applyStatus:s=>{state.status=s;},renderStatus:record('status'),renderRequests:record('requests'),renderThread:record('thread'),resumeWorkspace:async()=>{calls.push({name:'resume',args:[]});},notifyManagerError:()=>true,toast:record('toast'),messageOf:v=>String(v),requestKey:r=>r.key??typeof r.id+':'+String(r.id),updateExtensionNotice:record('extension'),upsertTurn:record('turn'),upsertItem:record('item'),ensureTurn,turns:()=>turns};
 const handle=createEventHandler(deps);return{state,turns,calls,deps,handle,emit:(method,params={},extra={})=>handle({data:JSON.stringify({method,params,...extra})}),hold:()=>{pending=new Promise(resolve=>{deps.release=resolve;});return()=>deps.release();}};
}
test('stream events keep complete text and unknown payloads while ignoring other selections',()=>{
 const f=fixture();f.handle({data:'{invalid'});assert.equal(f.calls.length,0);
 f.emit('item/agentMessage/delta',{threadId:'b',turnId:'t',itemId:'i',delta:'wrong'});assert.equal(f.turns.length,0);
 for(const delta of ['中文\n','<tag>完整原文</tag>'])f.emit('item/agentMessage/delta',{threadId:'a',turnId:'t',itemId:'i',delta});
 assert.equal(f.turns[0].items[0].text,'中文\n<tag>完整原文</tag>');
 const item={id:'future',type:'futureType',opaque:{all:['保留',7]}};f.emit('item/completed',{threadId:'a',turnId:'t',item});assert.deepEqual(f.calls.find(c=>c.name==='item').args,['t',item]);
 assert.deepEqual(f.calls.filter(c=>c.name==='stream').map(c=>c.args),[['text'],['text'],[]]);
});
test('command journal bypasses inline output; reasoning and fallback output retain full deltas',()=>{
 const f=fixture();f.state.status.service.outputJournal=true;f.emit('item/commandExecution/outputDelta',{threadId:'a',turnId:'t',itemId:'cmd',delta:'journal'});assert.equal(f.turns.length,0);assert.equal(f.calls.at(-1).name,'detail');
 f.state.status.service.outputJournal=false;for(const delta of ['甲','乙'])f.emit('item/commandExecution/outputDelta',{threadId:'a',turnId:'t',itemId:'cmd',delta});assert.equal(f.turns[0].items[0].aggregatedOutput,'甲乙');
 for(const delta of ['推理','原文'])f.emit('item/reasoning/summaryTextDelta',{threadId:'a',turnId:'t',itemId:'reason',summaryIndex:1,delta});assert.equal(f.turns[0].items[1].summary[1],'推理原文');
});
test('resolved requests remove only the matching key from every displayed collection',()=>{
 const f=fixture();for(const id of [1,'1'])f.emit('manager/request',{id,opaque:{keep:true}});assert.equal(f.state.localRequests.length,2);f.state.status.pendingRequests=f.state.localRequests.slice();f.state.detail.pendingRequests=f.state.localRequests.slice();
 f.emit('manager/requestResolved',{requestId:1});for(const list of [f.state.localRequests,f.state.status.pendingRequests,f.state.detail.pendingRequests]){assert.equal(list.length,1);assert.equal(list[0].id,'1');assert.deepEqual(list[0].opaque,{keep:true});}
});
test('account changes drain old reads and reload only the latest account without discarding errors',async()=>{
 const f=fixture(),release=f.hold();f.deps.loadModels=()=>Promise.reject(Error('models unavailable'));
 // Use the final dependency at installation, as the application does.
 const handler=createEventHandler(f.deps);handler({data:JSON.stringify({method:'account/updated'})});handler({data:JSON.stringify({method:'account/updated'})});
 assert.equal(f.state.models.length,0);assert.equal(f.state.threadCursor,null);assert.equal(f.deps.createdThreads.size,0);assert.equal(f.calls.filter(c=>c.name==='threads').length,0);release();await settle();
 assert.equal(f.calls.filter(c=>c.name==='threads').length,1);assert.equal(f.calls.filter(c=>c.name==='projects').length,1);assert.equal(f.calls.filter(c=>c.name==='error').length,1);assert.equal(f.calls.find(c=>c.name==='error').args[1],'账号切换刷新');
});
test('replayed events skip notifications and connection changes resume only after startup',async()=>{
 const f=fixture();f.emit('turn/completed',{threadId:'b',turn:{id:'old',items:[]}},{replayed:true});assert.equal(f.calls.filter(c=>c.name==='notify').length,0);
 f.emit('manager/status',{status:{instanceId:'new',connection:{state:'connected',connectedAt:'two'},pendingRequests:[]}});await settle();assert.equal(f.calls.filter(c=>c.name==='resume').length,1);
 f.emit('manager/status',{status:f.state.status});await settle();assert.equal(f.calls.filter(c=>c.name==='resume').length,1);
});
test('native goal resume updates the visible goal immediately without waiting for a detail reload',()=>{const f=fixture();f.state.detail.goal={status:'blocked'};const goal={status:'active',objective:'native',updatedAt:2};f.emit('thread/goal/updated',{threadId:'a',goal});assert.deepEqual(f.state.detail.goal,goal);f.emit('thread/goal/updated',{threadId:'other',goal:{status:'blocked'}});assert.equal(f.state.detail.goal.status,'active');f.emit('thread/goal/cleared',{threadId:'a'});assert.equal(f.state.detail.goal,null);});
