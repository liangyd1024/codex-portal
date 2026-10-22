import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createStopFeedback} from '../public/feedback.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(desktop=false){
 const state={busy:new Set(),desktopMode:desktop,selectedId:'one',selectionVersion:1};
 const calls=[],feedback=createStopFeedback(),errors=[];let refreshes=0;
 const c=vm.createContext({state,newChatOpen:false,stopFeedback:feedback,stopContext:()=>String(state.desktopMode)+':'+state.selectedId,turns:()=>[{id:'turn-one',status:'inProgress'}],typeOf:s=>s?.type||s,controlled:()=>true,running:()=>true,api:async(path,options)=>calls.push({path,options}),action:async(_key,work)=>{try{await work();}catch(e){errors.push(e);}},refreshSelected:async()=>{refreshes++;},recordError:e=>errors.push(e)});
 vm.runInContext(source.slice(source.indexOf('async function interruptThread()'),source.indexOf('async function moreHistory()')),c);
 return {c,state,calls,feedback,errors,refreshes:()=>refreshes};
}
test('native and desktop stop requests stay pending after acknowledgement and are not duplicated',async()=>{
 for(const desktop of [false,true]){
  const f=fixture(desktop);await f.c.interruptThread();await f.c.interruptThread();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,desktop?'/api/desktop/threads/one/interrupt':'/api/threads/one/interrupt');
  assert.equal(f.calls[0].options.body?.turnId,desktop?'turn-one':undefined);assert.equal(f.refreshes(),1);
  assert.equal(f.feedback.has(desktop+':one'),true);assert.deepEqual(f.errors,[]);
 }
});
test('late stop acknowledgement does not refresh another selected conversation',async()=>{
 const f=fixture();let resolve;f.c.api=()=>new Promise(r=>resolve=r);
 const pending=f.c.interruptThread();f.state.selectedId='two';f.state.selectionVersion++;resolve();await pending;
 assert.equal(f.refreshes(),0);assert.equal(f.feedback.has('false:two'),false);assert.equal(f.feedback.has('false:one'),true);
});
test('failed refresh does not undo an accepted stop, while explicit rejection allows retry',async()=>{
 const f=fixture();f.c.refreshSelected=async()=>{throw Object.assign(Error('refresh failed'),{status:404});};await f.c.interruptThread();
 assert.equal(f.feedback.has('false:one'),true);assert.equal(f.errors.length,1);
 const g=fixture();g.c.api=async()=>{throw Object.assign(Error('stop rejected'),{status:409});};await g.c.interruptThread();
 assert.equal(g.feedback.has('false:one'),false);assert.equal(g.errors.length,1);
});
