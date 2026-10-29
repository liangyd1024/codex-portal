import test from 'node:test';
import assert from 'node:assert/strict';
import {createThreadFromDraft} from '../src/web/services/thread-create.ts';
import {NewChatDraft} from '../public/new-chat.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const values=new Map(),draft=new NewChatDraft({getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},'fixture');draft.cwd='/fixture/project';
 const state={busy:new Set(),model:'model',effort:'high',drafts:new Map([['other','另一份草稿']]),threads:[],projects:[{id:'project',roots:['/fixture/project']}],desktopMode:true,sidebarArchived:true,selectedArchived:true,selectedId:'other',selectionVersion:2,loadingDetail:true,projectId:null,search:'old',historyCursor:'old',loadedOlderHistory:true,historyError:'old'};
 const input={value:'首条中文消息\n保留空行\n'},response=deferred(),calls=[],createdThreads=new Map();
 const d={state,draft,draftId:'new',access:'full',createdThreads,input:()=>input,hasAttachments:()=>false,attachmentsPending:()=>false,validate(){},toast:(...a)=>calls.push(['toast',...a]),hideError:()=>calls.push(['hide']),showError:e=>calls.push(['error',e.message]),recordError:(e,stage)=>calls.push(['record',stage,e.message]),
 action:async(key,run)=>{state.busy.add(key);try{await run();}finally{state.busy.delete(key);}},post:body=>{calls.push(['post',body]);return response.promise;},moveAttachments:(...a)=>calls.push(['images',...a]),moveComposer:(...a)=>calls.push(['composer',...a]),close:v=>calls.push(['close',v]),expandProject:id=>calls.push(['project',id]),clearSearch:()=>calls.push(['search']),saveView:()=>calls.push(['view']),applyDetail:(...a)=>calls.push(['detail',...a]),renderThreads:()=>calls.push(['render']),send:async()=>calls.push(['send',state.busy.has('create')]),loadThreads:async()=>calls.push(['threads']),loadStatus:async()=>calls.push(['status'])};
 return {state,draft,input,response,calls,createdThreads,d,create:createThreadFromDraft(d)};
}
test('create adopts native detail and moves draft before first send, releasing create lock first',async()=>{
 const f=fixture(),creating=f.create();await f.create();assert.equal(f.calls.filter(c=>c[0]==='post').length,1);assert.equal(f.draft.phase,'pending');
 assert.deepEqual(f.calls.find(c=>c[0]==='post')[1],{cwd:'/fixture/project',model:'model',effort:'high',access:'full'});
 f.response.resolve({thread:{id:'native',name:'原始标题',unknown:{keep:true}},extra:{raw:'保持'}});await creating;
 assert.deepEqual(f.state.drafts.get('native'),'首条中文消息\n保留空行\n');assert.equal(f.state.drafts.has('new'),false);assert.equal(f.state.drafts.get('other'),'另一份草稿');assert.equal(f.state.selectedId,'native');assert.equal(f.state.selectionVersion,3);assert.equal(f.state.projectId,'project');assert.equal(f.state.desktopMode,false);assert.equal(f.state.historyCursor,null);assert.equal(f.draft.phase,'editing');
 assert.deepEqual(f.calls.find(c=>c[0]==='detail').slice(1),[{thread:{id:'native',name:'原始标题',unknown:{keep:true},cwd:'/fixture/project'},extra:{raw:'保持'},controlled:true},true]);assert.deepEqual(f.calls.find(c=>c[0]==='send'),['send',false]);assert.deepEqual(f.calls.filter(c=>['images','composer'].includes(c[0])),[['images','new','native'],['composer','new','native']]);assert.equal(f.createdThreads.get('native'),f.state.threads[0]);
});
test('explicit failure permits retry while unknown creation blocks repeated requests and retains draft',async()=>{
 for(const unknown of [false,true]){const f=fixture(),creating=f.create();f.response.reject(Object.assign(Error('创建失败'),{status:409,code:unknown?'CREATE_OUTCOME_UNKNOWN':'INVALID_REQUEST'}));await creating;
 assert.equal(f.draft.phase,unknown?'uncertain':'editing');assert.equal(f.state.drafts.get('new'),f.input.value);assert.equal(f.state.selectedId,'other');assert.equal(f.calls.some(c=>c[0]==='send'),false);assert.equal(f.state.busy.size,0);
 if(unknown){await f.create();assert.equal(f.calls.filter(c=>c[0]==='post').length,1);}
 }
});
test('missing native id is uncertain and never creates local thread or sends first message',async()=>{
 const f=fixture(),creating=f.create();f.response.resolve({extra:true});await creating;assert.equal(f.draft.phase,'uncertain');assert.equal(f.state.threads.length,0);assert.equal(f.createdThreads.size,0);assert.equal(f.calls.some(c=>c[0]==='send'),false);assert.match(f.calls.find(c=>c[0]==='error')[1],/未返回会话 ID/);
});
test('first send failure leaves adopted native thread and draft rather than creating another thread',async()=>{
 const f=fixture();f.d.send=async()=>{throw Error('首条发送失败');};const creating=f.create();f.response.resolve({id:'native'});await assert.rejects(creating,/首条发送失败/);assert.equal(f.state.selectedId,'native');assert.equal(f.state.drafts.get('native'),f.input.value);assert.equal(f.draft.phase,'editing');assert.equal(f.calls.filter(c=>c[0]==='post').length,1);assert.equal(f.calls.some(c=>c[0]==='threads'),false);
});
test('blank, pending image, invalid goal and unavailable creation states do not create',async()=>{
 for(const reason of ['blank','image','goal','busy','uncertain','cwd']){const f=fixture();if(reason==='blank')f.input.value='  ';if(reason==='image')f.d.attachmentsPending=()=>true;if(reason==='goal')f.d.validate=()=>{throw Error('目标无效');};if(reason==='busy')f.state.busy.add('create');if(reason==='uncertain')f.draft.phase='uncertain';if(reason==='cwd')f.draft.cwd='';await f.create();assert.equal(f.calls.some(c=>c[0]==='post'),false,reason);}
});
test('desktop native detail selects desktop sending and preserves the first draft',async()=>{
 const f=fixture();f.d.preferDesktop=()=>true;const creating=f.create();
 assert.equal(f.calls.find(c=>c[0]==='post')[1].preferDesktop,true);
 const desktop={canSend:true,settings:{model:'native'}};
 f.response.resolve({thread:{id:'native'},controlled:false,controlState:'desktop',desktop,creationReady:true});await creating;
 assert.equal(f.state.desktopMode,true);assert.equal(f.calls.find(c=>c[0]==='detail')[1].controlled,false);
 assert.equal(f.calls.find(c=>c[0]==='detail')[1].desktop,desktop);assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
});
test('known creation with incomplete handoff retains its identity and draft without sending',async()=>{
 const f=fixture(),creating=f.create();f.response.resolve({thread:{id:'native'},controlled:false,controlState:'desktop',creationReady:false,creationError:'桌面暂不可用'});await creating;
 assert.equal(f.state.selectedId,'native');assert.equal(f.state.desktopMode,true);assert.equal(f.state.drafts.get('native'),f.input.value);
 assert.equal(f.calls.some(c=>c[0]==='send'),false);assert.equal(f.calls.find(c=>c[0]==='toast')[1],'桌面暂不可用');
});
