import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskNotificationPolicy} from '../src/server/services/task-notification-policy.ts';
import {taskNotice} from '../shared/connection-state.js';
import {notificationPreview} from '../shared/notification-text.js';
const active={createdAt:10,updatedAt:10,objective:'test goal',status:'active'};
function fixture(readGoal){
 let connection={},reads=0;const events=[],notices=[];
 const emit=(method,params)=>{events.push({method,params});const notice=taskNotice(method,params,{host:'test',known:true});if(notice)notices.push(notice);};
 const policy=new TaskNotificationPolicy({context:()=>connection,readGoal:async id=>{reads++;return readGoal(id);},emit});
 return {policy,events,notices,reads:()=>reads,disconnect:()=>{connection={};},event:(method,params)=>emit(method,policy.prepare(method,{threadId:'chat',...params}))};
}
const turn=(id,status='completed',startedAt=20)=>({id,status,startedAt,items:[{type:'agentMessage',phase:'final_answer',text:'original reply'}]});
test('ordinary terminal remains immediate in UI, with one deferred notification and original preview',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));f.event('turn/completed',{turn:turn('one')});
 assert.equal(f.events[0].method,'turn/completed');assert.equal(f.notices.length,0);await Promise.resolve();resolve({goal:null});await f.policy.settled();
 assert.equal(f.notices.length,1);assert.equal(notificationPreview(f.events[1].method,f.events[1].params),'original reply');
 f.event('turn/completed',{turn:turn('one')});await f.policy.settled();assert.equal(f.reads(),1);assert.equal(f.notices.length,1);
});
test('multiple goal turns and retryable failures stay silent, questions still notify',async()=>{
 const f=fixture(async()=>({goal:active}));f.event('thread/goal/updated',{goal:active});
 for(const status of ['completed','failed','interrupted']){f.event('turn/started',{turn:turn(status)});f.event('turn/completed',{turn:turn(status,status)});await f.policy.settled();}
 assert.equal(f.notices.length,0);assert.equal(f.reads(),3);
 f.event('manager/request',{id:'question',kind:'question',params:{threadId:'chat'}});assert.equal(f.notices[0].label,'需要你回答');
});
test('goal completion before or after final turn yields only the goal notification',async()=>{
 for(const first of [true,false]){
  let goal=active;const f=fixture(async()=>({goal}));f.event('turn/started',{turn:turn('final')});f.event('thread/goal/updated',{goal});
  const complete=()=>{goal={...active,status:'complete',updatedAt:30};f.event('thread/goal/updated',{goal});};
  if(first)complete();f.event('turn/completed',{turn:turn('final')});await f.policy.settled();if(!first)complete();
  assert.deepEqual(f.notices.map(n=>n.label),['目标已完成']);
  f.event('thread/goal/updated',{goal:{...goal,timeUsedSeconds:999}});assert.equal(f.notices[0].key,f.notices[1].key);
 }
});
test('clearing completed goal during final turn never adds a turn alert; later ordinary turn does',async()=>{
 let goal=active;const f=fixture(async()=>({goal}));f.event('turn/started',{turn:turn('final')});f.event('thread/goal/updated',{goal});
 f.event('thread/goal/updated',{goal:{...active,status:'complete',updatedAt:30}});goal=null;f.event('thread/goal/cleared',{});f.event('turn/completed',{turn:turn('final')});await f.policy.settled();assert.equal(f.notices.length,1);
 f.event('turn/started',{turn:turn('ordinary','inProgress',40)});goal={...active,status:'complete',updatedAt:30};f.event('turn/completed',{turn:turn('ordinary','completed',40)});await f.policy.settled();assert.equal(f.notices[1].label,'本次执行已完成');
});
test('blocked and limited goals alert without redundant failed turn notifications',async()=>{
 for(const status of ['blocked','usageLimited','budgetLimited']){const goal={...active,status};const f=fixture(async()=>({goal}));f.event('thread/goal/updated',{goal});f.event('turn/completed',{turn:turn('failed','failed')});await f.policy.settled();assert.equal(f.notices.length,1);}
});
test('failed goal lookup cannot announce success; known active goal remains quiet',async()=>{
 const f=fixture(async()=>{throw Error('offline');});f.event('turn/completed',{turn:turn('unknown')});await f.policy.settled();assert.equal(f.notices.length,0);
 f.event('turn/completed',{turn:turn('failure','failed')});await f.policy.settled();assert.equal(f.notices[0].label,'执行失败');
 f.event('turn/started',{turn:turn('active')});f.event('thread/goal/updated',{goal:active});f.event('turn/completed',{turn:turn('active','failed')});await f.policy.settled();assert.equal(f.notices.length,1);
});
test('late native lookup after connection replacement cannot notify or poll again',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));f.event('turn/completed',{turn:turn('late')});await Promise.resolve();f.disconnect();resolve({goal:null});await f.policy.settled();assert.equal(f.notices.length,0);assert.equal(f.reads(),1);
});

test('native paused state allows an explicit stop alert while goal pause alone stays silent',async()=>{
 const paused={...active,status:'paused',updatedAt:30},f=fixture(async()=>({goal:paused}));
 f.event('turn/started',{turn:turn('stop')});f.event('thread/goal/updated',{goal:active});f.event('thread/goal/updated',{goal:paused});assert.equal(f.notices.length,0);
 f.event('turn/completed',{turn:turn('stop','interrupted')});await f.policy.settled();assert.deepEqual(f.notices.map(n=>n.label),['本次执行已停止']);
});
test('ordinary notifications carry only assistant preview, not duplicate command output',async()=>{
 const f=fixture(async()=>({goal:null}));const value=turn('output');value.items.push({type:'commandExecution',aggregatedOutput:'large tool output'});
 f.event('turn/completed',{turn:value});await f.policy.settled();assert.equal(f.events[0].params.turn.items.length,2);assert.equal(f.events[1].params.turn.items.length,1);
});

test('notification delivery errors are reported without rejecting the native event pipeline',async()=>{
 const errors=[];let calls=0;
 const policy=new TaskNotificationPolicy({context:()=>1,readGoal:async()=>({goal:null}),emit:()=>{calls++;throw Error('storage failed');},onError:error=>errors.push(error.message)});
 policy.prepare('turn/completed',{threadId:'chat',turn:turn('first')});await policy.settled();
 policy.prepare('turn/completed',{threadId:'chat',turn:turn('second')});await policy.settled();assert.equal(calls,2);assert.deepEqual(errors,['storage failed','storage failed']);
});
