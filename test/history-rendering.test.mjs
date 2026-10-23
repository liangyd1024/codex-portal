import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {loadAllEarlier} from '../public/turn-navigation.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const state={historyCursor:'3',selectedId:'thread',detail:{turns:[{id:'latest'}]},selectionVersion:1,busy:new Set()};
 let renders=0,calls=0;
 const c=vm.createContext({state,$:()=>({setAttribute(){}}),turns:()=>state.detail.turns,renderThread:()=>renders++,api:async()=>{calls++;const cursor=Number(state.historyCursor);return{data:[{id:'older-'+cursor}],nextCursor:cursor>1?String(cursor-1):null};},action:async(_key,fn)=>fn()});
 vm.runInContext(source.slice(source.indexOf('async function moreHistory('),source.indexOf('let inputSizeKey;')),c);
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
