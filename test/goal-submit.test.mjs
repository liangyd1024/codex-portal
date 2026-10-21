import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGoalSubmission,validateGoalDraft,sendAfterGoal} from '../public/goal-submit.js';
const options=(selection,api)=>({selection,id:'test',text:'  目标内容  ',active:false,api,save:()=>{}});
test('goal is set from message without budget only once, including after message failure',async()=>{
 const selection={goalPending:true},calls=[];const api=async(...args)=>{calls.push(args);return {};};
 await prepareGoalSubmission(options(selection,api));
 assert.deepEqual(calls,[['/api/threads/test/goal',{method:'POST',body:{objective:'目标内容',status:'active'}}]]);
 assert.equal(selection.goalPending,false);
 await prepareGoalSubmission(options(selection,api));assert.equal(calls.length,1);
});
test('blank/image-only, oversized and busy goal submissions are rejected before mutation',async()=>{
 for(const [text,active] of [['',false],['x'.repeat(10001),false],['目标',true]]){
  let calls=0;await assert.rejects(prepareGoalSubmission({...options({goalPending:true},async()=>calls++),text,active}));assert.equal(calls,0);
 }
 assert.doesNotThrow(()=>validateGoalDraft({},'',true));
});
test('uncertain result is read back, never blindly set again',async()=>{
 const selection={goalPending:true};await assert.rejects(prepareGoalSubmission(options(selection,async()=>{throw Error('offline');})));
 assert.equal(selection.goalUncertain,'目标内容');
 const calls=[];await prepareGoalSubmission(options(selection,async(path)=>{calls.push(path);return {goal:{objective:'目标内容',status:'active'}};}));
 assert.deepEqual(calls,['/api/threads/test']);assert.equal(selection.goalPending,false);
});
test('unconfirmed or mismatched native goal preserves pending draft and blocks message continuation',async()=>{
 for(const result of [{goal:null},{goal:{objective:'other',status:'active'}},{goalError:'offline',goal:{objective:'目标内容',status:'active'}}]){
  const selection={goalPending:true,goalUncertain:'目标内容'};
  await assert.rejects(prepareGoalSubmission(options(selection,async()=>result)),/未确认/);assert.equal(selection.goalPending,true);
 }
});
test('definitive rejection permits retry and late completion changes only captured selection',async()=>{
 const selection={goalPending:true};await assert.rejects(prepareGoalSubmission(options(selection,async()=>{throw Object.assign(Error('busy'),{status:409});})));assert.equal(selection.goalUncertain,undefined);
 const another={goalPending:true};let resolve;const pending=prepareGoalSubmission(options(selection,()=>new Promise(r=>resolve=r)));resolve({});await pending;
 assert.equal(selection.goalPending,false);assert.equal(another.goalPending,true);
});

test('native goal activation does not send another turn; subsequent messages use normal sending',async()=>{
 const calls=[],api=async(...args)=>{calls.push(args);return {};};
 await sendAfterGoal({goalStarted:true,id:'test',payload:{text:'目标',images:[]},active:false,api});assert.equal(calls.length,0);
 await sendAfterGoal({goalStarted:false,id:'test',payload:{text:'补充',images:[]},active:false,api});assert.equal(calls[0][0],'/api/threads/test/message');
});
test('goal attachments use native steering when running and preserve errors for retry',async()=>{
 for(const active of [true,false]){
  const calls=[],payload={text:'目标',images:[{url:'image'}],mode:'default'};
  const api=async(path,options)=>{calls.push([path,options]);return {thread:{status:{type:active?'active':'idle'}}};};
  await sendAfterGoal({goalStarted:true,id:'test',payload,active:false,api});
  assert.equal(calls[1][0],'/api/threads/test/'+(active?'steer':'message'));
  assert.deepEqual(calls[1][1].body,active?{text:payload.text,images:payload.images}:payload);
 }
 await assert.rejects(sendAfterGoal({goalStarted:true,id:'test',payload:{images:[{}]},api:async()=>{throw Error('offline');}}),/offline/);
});
test('steering preserves selected references but drops next-turn model and permission settings',async()=>{
 let call;await sendAfterGoal({id:'running',active:true,payload:{text:'$skill',images:[],skills:['/skill'],plugins:['plugin'],mode:'plan',model:'other',access:'full'},api:async(...args)=>{call=args;}});
 assert.equal(call[0],'/api/threads/running/steer');assert.deepEqual(call[1].body,{text:'$skill',images:[],skills:['/skill'],plugins:['plugin']});
});
