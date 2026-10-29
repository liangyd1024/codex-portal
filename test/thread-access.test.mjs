import test from 'node:test';
import assert from 'node:assert/strict';
import {createThreadAccess} from '../src/web/services/thread-access.ts';
function fixture(overrides={}){
 const calls=[],detail={thread:{id:'a'},controlled:false};let key='selection-1',current=true;
 const desktop={thread:{id:'a'},controlState:'desktop',desktop:{available:true,canSend:true}};
 const deps={key:()=>key,ready:()=>true,desktop:async id=>{calls.push(['desktop',id]);return desktop;},resume:async id=>{calls.push(['resume',id]);return {...detail,controlled:true};},messageOf:e=>e.message,...overrides};
 const access=createThreadAccess(deps);
 return {access,deps,detail,desktop,calls,resolve:()=>access.resolve('a',detail,()=>current),change:()=>{key='selection-2';current=false;}};
}
test('desktop owner is selected without a resume or sending a message, including running sessions',async()=>{
 for(const canSend of [true,false]){const f=fixture();f.desktop.desktop.canSend=canSend;assert.equal(await f.resolve(),f.desktop);assert.deepEqual(f.calls,[['desktop','a']]);}
});
test('native resume is used only after a successful desktop read reports no owner',async()=>{
 const f=fixture();f.desktop.desktop.available=false;assert.equal((await f.resolve()).controlled,true);assert.deepEqual(f.calls,[['desktop','a'],['resume','a']]);
});
test('owned, archived, cached, disconnected and pending handoff sessions never probe or resume',async()=>{
 for(const change of [{controlled:true},{recovering:true},{thread:{id:'a',archived:true}},{handoff:{state:'waiting'}},{handoff:{state:'unknown'}},{handoff:{state:'checking'}}]){const f=fixture();Object.assign(f.detail,change);assert.equal(await f.resolve(),f.detail);assert.deepEqual(f.calls,[]);}
 const f=fixture({ready:()=>false});await f.resolve();assert.deepEqual(f.calls,[]);
});
test('released handoff may follow desktop but can never auto-resume in the web engine',async()=>{
 const f=fixture();f.detail.handoff={state:'released'};assert.equal(await f.resolve(),f.desktop);
 f.access.reset();f.desktop.desktop.available=false;f.desktop.desktop.error='请在电脑端打开';const unavailable=await f.resolve();assert.equal(unavailable.accessError,'请在电脑端打开');assert.equal(unavailable.controlState,'desktop');assert.deepEqual(unavailable.handoff,{state:'released'});assert.equal(f.calls.some(c=>c[0]==='resume'),false);
});
test('network failure does not claim a session; repeated refreshes do not retry until explicit reset',async()=>{
 const f=fixture({desktop:async()=>{f.calls.push('probe');throw Error('offline');}});
 assert.equal((await f.resolve()).accessError,'offline');assert.equal((await f.resolve()).accessError,'offline');assert.deepEqual(f.calls,['probe']);
 f.access.reset();await f.resolve();assert.deepEqual(f.calls,['probe','probe']);
});
test('writer conflict and unknown outcome keep history and never replay resume on refresh',async()=>{
 for(const code of ['WRITER_CONFLICT','OUTCOME_UNKNOWN']){
  const f=fixture({resume:async()=>{f.calls.push('resume');throw Object.assign(Error('unknown'),{code});}});f.desktop.desktop.available=false;
  const result=await f.resolve();assert.equal(result.thread,f.detail.thread);assert.equal(result.controlled,false);assert.ok(result.accessError);
  await f.resolve();assert.deepEqual(f.calls,[['desktop','a'],'resume']);
 }
});
test('late owner lookup cannot trigger a resume or change the new selection',async()=>{
 let finish;const f=fixture({desktop:()=>new Promise(r=>finish=r)});const pending=f.resolve();f.change();finish({thread:{id:'a'},desktop:{available:false}});assert.equal(await pending,f.detail);assert.deepEqual(f.calls,[]);
});
test('unexpected desktop thread is rejected without native mutation',async()=>{
 const f=fixture();f.desktop.thread.id='b';assert.match((await f.resolve()).accessError,/会话已变化/);assert.deepEqual(f.calls,[['desktop','a']]);
});
test('a temporary busy state during discovery defers native resume and permits a later check',async()=>{
 let finish,ready=true;const f=fixture({ready:()=>ready,desktop:()=>new Promise(r=>finish=r)});
 const pending=f.resolve();ready=false;finish({thread:{id:'a'},desktop:{available:false}});await pending;assert.deepEqual(f.calls,[]);
 ready=true;f.deps.desktop=async()=>f.desktop;assert.equal(await f.resolve(),f.desktop);
});

test('observed CLI activity never probes or resumes the target, but completion permits discovery',async()=>{
 const f=fixture();f.detail.thread.activity={source:'cli',state:'running',observedAt:Date.now()};
 assert.equal(await f.resolve(),f.detail);assert.deepEqual(f.calls,[]);
 delete f.detail.thread.activity;await f.resolve();assert.deepEqual(f.calls,[['desktop','a']]);
});
