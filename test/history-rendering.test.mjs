import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {loadAllEarlier} from '../public/turn-navigation.js';
const source=readFileSync(new URL('../src/web/services/history-pagination.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createHistoryPagination}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(){
 const state={historyCursor:'3',selectedId:'thread',detail:{turns:[{id:'latest'}]},selectionVersion:1,busy:new Set()};
 let renders=0,calls=0;
 const c={renderThread:()=>renders++};
 c.moreHistory=createHistoryPagination({state,busy(){},turns:()=>state.detail.turns,render:c.renderThread,read:async()=>{calls++;const cursor=Number(state.historyCursor);return{data:[{id:'older-'+cursor}],nextCursor:cursor>1?String(cursor-1):null};},action:async(_key,fn)=>fn()});
 return{c,state,renders:()=>renders,calls:()=>calls};
}
test('complete-history requests merge every page without repeatedly rendering the transcript',async()=>{
 const f=fixture();
 await loadAllEarlier({context:()=>({hasEarlier:!!f.state.historyCursor,cursor:f.state.historyCursor}),isCurrent:()=>true,loadEarlier:()=>f.c.moreHistory({deferRender:true}),yieldPage:async()=>{}});
 assert.equal(f.calls(),3);assert.equal(f.renders(),0);assert.equal(f.state.detail.turns.length,4);assert.equal(f.state.loadedOlderHistory,true);
 f.c.renderThread();assert.equal(f.renders(),1);
});
test('ordinary scroll pagination still renders its page immediately',async()=>{
 const f=fixture();await f.c.moreHistory();assert.equal(f.renders(),1);assert.equal(f.state.detail.turns.length,2);
});

test('history preserves existing turn objects, reverses older pages, and encodes desktop cursors',async()=>{
 const existing={id:'shared',text:'live text',extra:{native:true}},state={historyCursor:'cursor/+?',selectedId:'thread/one',selectionVersion:2,desktopMode:true,loadingDetail:false,loadedOlderHistory:false,busy:new Set(),detail:{turns:[existing,{id:'latest'}]}};
 const paths=[],busy=[];let renders=0;
 const load=createHistoryPagination({state,busy:v=>busy.push(v),action:async(_key,work)=>work(),read:async p=>{paths.push(p);return{data:[{id:'shared',text:'stale'},{id:'old'}],nextCursor:'next',historySource:'snapshot'};},turns:()=>state.detail.turns,render:()=>renders++});
 assert.equal(await load(),true);assert.deepEqual(paths,['/api/desktop/threads/thread%2Fone/history?cursor=cursor%2F%2B%3F&lazyTools=1&threadId=thread%2Fone']);
 assert.deepEqual(state.detail.turns.map(t=>t.id),['old','shared','latest']);assert.equal(state.detail.turns[1],existing);assert.equal(state.detail.historySource,'snapshot');assert.equal(state.historyCursor,'next');assert.equal(renders,1);assert.deepEqual(busy,[true,false]);
});
test('late history results cannot replace another selection, while failures always release the busy indicator',async()=>{
 for(const failed of [false,true]){
  let release,reject;const pending=new Promise((a,b)=>{release=a;reject=b;});const state={historyCursor:'cursor',selectedId:'a',selectionVersion:1,desktopMode:false,busy:new Set(),detail:{turns:[]}},busy=[];
  const load=createHistoryPagination({state,busy:v=>busy.push(v),action:async(_key,work)=>work(),read:()=>pending,turns:()=>state.detail.turns,render:()=>assert.fail('late render')});
  const request=load(),newDetail={turns:[{id:'b'}]};state.selectedId='b';state.selectionVersion++;state.detail=newDetail;
  if(failed){reject({code:'HISTORY_CURSOR_CHANGED'});await assert.rejects(request,{message:'历史记录已更新。请刷新会话后再向上滚动。'});}else{release({data:[{id:'old-a'}],nextCursor:null});assert.equal(await request,undefined);}
  assert.equal(state.detail,newDetail);assert.equal(state.historyCursor,'cursor');assert.deepEqual(busy,[true,false]);
 }
});
test('history guards avoid reads and duplicate pages while an action is in flight',async()=>{
 const state={historyCursor:'cursor',selectedId:'a',selectionVersion:1,desktopMode:false,loadingDetail:false,busy:new Set(),detail:{turns:[]}};let release,reads=0;const pending=new Promise(r=>{release=r});const busy=[];
 const load=createHistoryPagination({state,busy:v=>busy.push(v),action:async(key,work)=>{state.busy.add(key);try{return await work();}finally{state.busy.delete(key);}},read:()=>{reads++;return pending;},turns:()=>state.detail.turns,render(){}});
 state.loadingDetail=true;await load();assert.equal(reads,0);state.loadingDetail=false;const first=load();await load();assert.equal(reads,1);release({data:[],nextCursor:null});await first;await load();assert.equal(reads,1);assert.deepEqual(busy,[true,false]);
});
