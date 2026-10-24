import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createStopFeedback} from '../public/feedback.js';
const source=readFileSync(new URL('../src/web/services/stop-request.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createStopRequest}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(desktop=false){
 const state={busy:new Set(),desktopMode:desktop,selectedId:'one',selectionVersion:1};
 const calls=[],feedback=createStopFeedback(),errors=[];let refreshes=0;
 const c={state,newChatOpen:false,stopFeedback:feedback,stopContext:()=>String(state.desktopMode)+':'+state.selectedId,turns:()=>[{id:'turn-one',status:'inProgress'}],typeOf:s=>s?.type||s,controlled:()=>true,running:()=>true,api:async(path,options)=>calls.push({path,options}),action:async(_key,work)=>{try{await work();}catch(e){errors.push(e);}},refreshSelected:async()=>{refreshes++;},recordError:e=>errors.push(e)};
 c.interruptThread=createStopRequest({state,newChatOpen:()=>c.newChatOpen,context:()=>c.stopContext(),turns:()=>c.turns(),kind:v=>c.typeOf(v),controlled:()=>c.controlled(),running:()=>c.running(),feedback,action:(...v)=>c.action(...v),api:(...v)=>c.api(...v),refresh:()=>c.refreshSelected(),recordError:(...v)=>c.recordError(...v)});
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

test('stop guards retain ownership and new-chat boundaries, and desktop selects the latest active turn',async()=>{
 for(const guard of ['busy','newChat','noSelection','unowned','desktopIdle']){const f=fixture(guard==='desktopIdle');if(guard==='busy')f.state.busy.add('interrupt');if(guard==='newChat')f.c.newChatOpen=true;if(guard==='noSelection')f.state.selectedId=null;if(guard==='unowned')f.c.controlled=()=>false;if(guard==='desktopIdle')f.c.turns=()=>[{id:'done',status:'completed'}];await f.c.interruptThread();assert.equal(f.calls.length,0);assert.equal(f.refreshes(),0)}
 const f=fixture(true);f.state.selectedId='a/b';f.c.turns=()=>[{id:'old',status:'inProgress'},{id:'latest',status:{type:'running'}},{id:'done',status:'completed'}];await f.c.interruptThread();assert.equal(f.calls[0].path,'/api/desktop/threads/a%2Fb/interrupt');assert.deepEqual(f.calls[0].options,{method:'POST',body:{turnId:'latest'}});
});
test('late failures settle the original context and never refresh another selection',async()=>{
 for(const code of ['INVALID_REQUEST','OUTCOME_UNKNOWN']){const f=fixture(true);let reject;f.c.api=()=>new Promise((_,r)=>{reject=r});const pending=f.c.interruptThread();f.state.selectedId='two';f.state.selectionVersion++;reject(Object.assign(Error('late rejection'),{status:409,code}));await pending;assert.equal(f.refreshes(),0);assert.equal(f.feedback.has('true:one'),code==='OUTCOME_UNKNOWN');assert.equal(f.feedback.has('true:two'),false);assert.equal(f.errors.length,1)}
});
test('native background stop has no turn payload and remains pending until background completion is observed',async()=>{
 const f=fixture();f.c.turns=()=>[];f.c.running=()=>false;await f.c.interruptThread();assert.deepEqual(f.calls[0].options,{method:'POST'});assert.equal(f.feedback.observe('false:one',{confirmed:true,status:'idle',turns:[],background:'running'}),true);assert.equal(f.feedback.observe('false:one',{confirmed:true,status:'idle',turns:[],background:'idle'}),false);
});
