import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopStream} from '../lib/desktop-stream.mjs';
const id='00000000-0000-0000-0000-000000000001';
function fixture(){const events=[],sent=[];const s=new DesktopStream({kind:'ssh'},e=>events.push(e));s.ids.add(id);s.owners.set(id,'owner');s.clientId='observer';s.send=m=>sent.push(m);const message=(change,source='owner',version=11)=>s.message({type:'broadcast',method:'thread-stream-state-changed',sourceClientId:source,version,params:{hostId:'local',conversationId:id,change}});return {s,events,sent,message};}
test('desktop stream trusts only the discovered owner and resynchronizes revision gaps',()=>{
 const f=fixture();try{
 const snapshot={type:'snapshot',revision:5,conversationState:{id}};
 f.message(snapshot,'other');f.message(snapshot,'owner',10);assert.equal(f.s.ready(id),false);
 f.message(snapshot);assert.equal(f.s.ready(id),true);assert.deepEqual(f.events,[{threadId:id,ready:true}]);
 f.message({type:'patches',baseRevision:5,revision:6,patches:[]});assert.equal(f.s.revisions.get(id),6);
 f.message({type:'patches',baseRevision:7,revision:8,patches:[]});assert.equal(f.s.ready(id),false);assert.equal(f.sent.at(-1).params.following,true);assert.equal(f.events.at(-1).ready,false);
 }finally{f.s.close();}
});
test('desktop observer refuses ownership and releases its last view without stopping tasks',()=>{
 const f=fixture();f.message({type:'snapshot',revision:1,conversationState:{id}});
 f.s.message({type:'client-discovery-request',requestId:'r'});assert.deepEqual(f.sent.at(-1).response,{canHandle:false});
 f.s.set([],false);assert.equal(f.s.ready(id),false);assert.equal(f.sent.some(m=>m.params?.following===false),true);assert.equal(f.sent.some(m=>/start-turn|interrupt|archive/.test(m.method||'')),false);
});
test('frequent patches are coalesced and a disconnected stream invalidates readiness',async()=>{
 const f=fixture();try{f.message({type:'snapshot',revision:0,conversationState:{id}});for(let n=0;n<100;n++)f.message({type:'patches',baseRevision:n,revision:n+1,patches:[]});assert.equal(f.s.timers.size,1);await new Promise(r=>setTimeout(r,800));assert.equal(f.events.length,2);f.s.reset();assert.equal(f.events.at(-1).ready,false);assert.equal(f.s.ready(id),false);}finally{f.s.close();}
});
test('desktop goals retain null, update on patches and disappear on invalidation',()=>{
 const f=fixture();try{
 assert.equal(f.s.goal(id),undefined);
 f.message({type:'snapshot',revision:0,conversationState:{id,threadGoal:{status:'active',objective:'test'}}});
 const read=f.s.goal(id);read.goal.objective='mutated';assert.equal(f.s.goal(id).goal.objective,'test');
 f.message({type:'patches',baseRevision:0,revision:1,patches:[{op:'replace',path:['threadGoal','status'],value:'paused'}]});assert.equal(f.s.goal(id).goal.status,'paused');
 f.message({type:'patches',baseRevision:1,revision:2,patches:[{op:'replace',path:['threadGoal'],value:null}]});assert.deepEqual(f.s.goal(id),{goal:null,error:null});
 f.message({type:'patches',baseRevision:9,revision:10,patches:[]});assert.equal(f.s.goal(id),undefined);
 }finally{f.s.close();}
});
