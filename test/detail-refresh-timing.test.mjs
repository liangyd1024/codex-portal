import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
async function service(name){const source=readFileSync(new URL('../src/web/services/'+name+'.ts',import.meta.url),'utf8');const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));}
const {createDetailReader}=await service('detail-reader');
const {createSelectedRefresh}=await service('selected-refresh');
const {createUpdateScheduler}=await service('update-scheduler');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
// Integrate the production reader, selection deduplication and delayed scheduler.
// A manually completed HTTP response makes the overlap boundary deterministic.
function fixture(){
 let now=0,next=0;const timers=new Map(),requests=[],errors=[],applied=[];
 const defer=(run,delay)=>{const id=++next;timers.set(id,{run,at:now+delay});return id;};
 const advance=async time=>{for(;;){const due=[...timers].filter(([,v])=>v.at<=time).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].run();await settle();}now=time;};
 const state={selectedId:'a',selectionVersion:1,detailVersion:1,detail:null,desktopMode:false,drafts:new Map(),loadingDetail:true,loadedOlderHistory:false,historyCursor:null,streamRender:false};
 const request=(path)=>new Promise(resolve=>requests.push({path,at:now,resolve}));
 const apply=data=>{state.detail=data;applied.push(data.thread.id);};
 const turns=()=>state.detail?.turns||[];
 let refresh;
 const scheduler=createUpdateScheduler({state,defer,cancel:id=>timers.delete(id),usable:()=>true,renderMessages(){},renderRequests(){},renderControls(){},refreshSelected:()=>refresh(),refreshList(){},report:e=>errors.push(e)});
 const read=createDetailReader({state,sends:{},reportView:()=>Promise.resolve(),recordError:e=>errors.push(e),request,input:()=>({value:''}),resizeInput(){},saveSends(){},now:()=>now,host:()=> 'fixture',canDecompress:()=>false,applyPreview:apply,turns,outputBases:()=>new Map(),decode:async x=>x,hydrate:x=>x,recordTiming(){},defer,refreshSoon:()=>scheduler.detail()});
 refresh=createSelectedRefresh({state,blocked:()=>false,newChatOpen:()=>false,restore:async()=>{},read,turns,merge:(_old,incoming)=>incoming,apply,updated(){}}).refresh;
 const finish=async(index,id='a')=>{requests[index].resolve({thread:{id},turns:[],nextCursor:null});await settle();};
 const select=id=>{state.selectionVersion++;state.selectedId=id;state.detail=null;state.loadingDetail=true;return refresh();};
 return{state,requests,errors,applied,advance,finish,select,refresh:()=>refresh()};
}
async function initial(f){const pending=f.refresh();assert.equal(f.requests.length,1);await f.finish(0);assert.equal(f.requests.length,2);await f.finish(1);await pending;await f.advance(1000);}
test('queued cold-read refresh merges with the same selection read that is still pending',async()=>{
 const f=fixture();await initial(f);await f.advance(1600);const selected=f.select('a');await f.finish(2);assert.equal(f.requests.length,4);await f.advance(1650);assert.equal(f.requests.length,4);await f.finish(3);await selected;assert.equal(f.state.detail.thread.id,'a');assert.deepEqual(f.errors,[]);
});
test('queued cold-read refresh issues one warm read when selection completed before its deadline',async()=>{
 const f=fixture();await initial(f);await f.advance(1600);const selected=f.select('a');await f.finish(2);await f.advance(1620);await f.finish(3);await selected;await f.advance(1650);assert.equal(f.requests.length,5);assert.equal(f.requests[4].at,1650);assert(!f.requests[4].path.includes('preview=1'));assert(!f.requests[4].path.includes('fast=1'));await f.finish(4);assert.deepEqual(f.errors,[]);
});
test('queued refresh uses the new selection and ignores the older selection response',async()=>{
 const f=fixture();await initial(f);await f.advance(1600);const old=f.select('a');await f.finish(2);await f.advance(1620);const current=f.select('b');await f.finish(4,'b');await f.advance(1650);assert.equal(f.requests.length,6);assert(f.requests[5].path.startsWith('/api/threads/b?'));await f.finish(3,'a');await old;assert.equal(f.state.detail.thread.id,'b');await f.finish(5,'b');await current;assert.equal(f.state.detail.thread.id,'b');assert.deepEqual(f.errors,[]);
});
