import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {ThreadRetention} from '../lib/thread-retention.mjs';
function fixture(count=11){
 let now=100;const calls=[];const overrides={};
 const rpc={connected:true,close(){this.connected=false;},async request(method,p={}){calls.push({method,p});if(overrides[method])return overrides[method](p);switch(method){
 case 'thread/loaded/list':return {data:[...m.controlled.keys()]};
 case 'thread/read':return {thread:{id:p.threadId,status:{type:'idle'}}};
 case 'thread/goal/get':return {goal:null};
 case 'thread/backgroundTerminals/list':case 'thread/queue/list':return {data:[]};
 case 'thread/unsubscribe':return {status:'unsubscribed'};
 default:throw Error(method);
 }}};
 const m=new Manager({host:{id:'test',alias:'Test'}});m.rpc=rpc;m.connection={state:'connected'};m.service={protocolValidation:{features:{handoff:{supported:true}}}};
 m.retention=new ThreadRetention(m,{now:()=>now});
 for(let i=0;i<count;i++){m.rememberControl({thread:{id:'t'+i,status:{type:'idle'}}});now++;}
 return {m,rpc,calls,overrides,advance:n=>{now+=n;},close:()=>m.disconnect()};
}
test('automatic release restores the connection on startup without treating it as a manual handoff',()=>{
 const f=fixture(0);try{let connects=0;f.m.connect=()=>connects++;f.m.subscriptions.set('a',{handoff:{state:'released',automatic:true}});f.m.restoreConnection();assert.equal(connects,1);f.m.subscriptions.set('a',{handoff:{state:'released'}});f.m.restoreConnection();assert.equal(connects,1);}finally{f.close();}
});
test('desktop count bound releases oldest idle thread without touching other threads or task methods',async()=>{
 const f=fixture();try{await f.m.retention.sweep();assert.deepEqual(f.calls.filter(c=>c.method==='thread/unsubscribe').map(c=>c.p.threadId),['t0']);assert.equal(f.m.controlled.size,10);assert.equal(f.m.subscriptions.get('t0').handoff.automatic,true);assert.ok(!f.m.status().handoffs.some(h=>h.threadId==='t0'));assert.ok(!f.calls.some(c=>/interrupt|terminate|delete|archive/.test(c.method)));}finally{f.close();}
});
test('three-hour lifetime is event scheduled and active views across tabs protect the thread',async()=>{
 const f=fixture(1);try{const r=f.m.retention,a=r.attach('a'),b=r.attach('b');await r.view('a','t0',1);await r.view('b','t0',1);f.advance(10800001);await r.sweep();assert.equal(f.calls.length,0);a();r.changed();await r.sweep();assert.equal(f.calls.length,0);b();f.advance(10799999);await r.sweep();assert.equal(f.calls.length,0);f.advance(2);await r.sweep();assert.equal(f.m.controlled.size,0);}finally{f.close();}
});
test('late selection and old SSE close cannot clear a newer tab selection',async()=>{
 const f=fixture(1);try{const r=f.m.retention,old=r.attach('tab');await r.view('tab','t0',2);await r.view('tab',null,1);assert.equal(r.viewed('t0'),true);const next=r.attach('tab');old();assert.equal(r.viewed('any'),true);await r.view('tab','t0',3);next();assert.equal(r.viewed('t0'),false);}finally{f.close();}
});
test('returning to a thread during native preflight cancels unsubscribe',async()=>{
 const f=fixture(1);try{let release,entered;const started=new Promise(r=>entered=r);f.advance(10800001);f.overrides['thread/goal/get']=()=>new Promise(resolve=>{release=()=>resolve({goal:null});entered();});const pending=f.m.retention.sweep();await started;f.m.retention.attach('tab');const viewed=f.m.retention.view('tab','t0',1);release();await pending;await viewed;assert.ok(!f.calls.some(c=>c.method==='thread/unsubscribe'));assert.equal(f.m.controlled.has('t0'),true);}finally{f.close();}
});
test('native busy, queued work, async questions and persistence errors retain the subscription',async t=>{
 for(const kind of ['active','goal','command','queue','question','save'])await t.test(kind,async()=>{const f=fixture(1);try{f.advance(10800001);if(kind==='active')f.m.activeTurns.set('t0','turn');if(kind==='goal')f.overrides['thread/goal/get']=()=>({goal:{status:'active'}});if(kind==='command')f.overrides['thread/backgroundTerminals/list']=()=>({data:[{}]});if(kind==='queue')f.overrides['thread/queue/list']=()=>({data:[],nextCursor:'next'});if(kind==='question')f.m.pendingQuestions.entries.set('q',{threadId:'t0'});if(kind==='save')f.m.saveSubscriptions=()=>{throw Error('disk full');};await f.m.retention.sweep();assert.equal(f.m.controlled.has('t0'),true);assert.ok(!f.m.subscriptions.get('t0').handoff);assert.ok(!f.calls.some(c=>c.method==='thread/unsubscribe'));}finally{f.close();}});
});
test('automatic release wakes only on a view, merges parallel wakes and never resumes manual handoff',async()=>{
 const f=fixture(1);try{f.advance(10800001);await f.m.retention.sweep();let resumes=0,finish;f.m.takeover=async id=>{resumes++;await new Promise(r=>finish=r);f.m.subscriptions.set(id,{since:0});};const r=f.m.retention;r.attach('a');r.attach('b');const a=r.view('a','t0',1),b=r.view('b','t0',1);await Promise.resolve();await Promise.resolve();finish();await Promise.all([a,b]);assert.equal(resumes,1);f.m.subscriptions.set('manual',{handoff:{state:'released'}});await r.view('a','manual',2);assert.equal(resumes,1);}finally{f.close();}
});
test('side chats are excluded from count limit but expire after three hours and never auto-resume',async()=>{
 const f=fixture(10);try{const events=[];f.m.on('event',e=>events.push(e));f.m.rememberControl({thread:{id:'side',ephemeral:true,status:{type:'idle'}}});f.m.controlled.get('side').lastTurnStatus='completed';f.m.retention.changed();await f.m.retention.sweep();assert.equal(f.calls.length,0);f.advance(10800001);await f.m.retention.sweep();assert.equal(f.m.controlled.size,0);assert.equal(f.m.subscriptions.get('side').handoff.ephemeral,true);assert.ok(events.some(e=>e.method==='side-chat/expired'));f.m.takeover=()=>assert.fail('must not restore expired ephemeral thread');await f.m.retention.wake('side');}finally{f.close();}
});
test('visible and empty side chats stay loaded; closing the last view starts the full TTL',async()=>{
 const f=fixture(0);try{const r=f.m.retention;f.m.rememberControl({thread:{id:'side',ephemeral:true,status:{type:'idle'}}});f.advance(10800001);await r.sweep();assert.equal(f.calls.length,0);f.m.controlled.get('side').lastTurnStatus='completed';r.attach('tab');await r.view('tab',null,1,'side');f.advance(10800001);await r.sweep();assert.equal(f.calls.length,0);await r.view('tab',null,2,null);f.advance(10799999);await r.sweep();assert.equal(f.calls.length,0);f.advance(2);await r.sweep();assert.equal(f.m.controlled.size,0);}finally{f.close();}
});
