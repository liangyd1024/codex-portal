import test from 'node:test';
import assert from 'node:assert/strict';
import {sendWithGoalResume} from '../lib/goal-follow-up.mjs';
const expected={createdAt:1,objective:'test goal'};
function fixture(status='blocked'){
 const calls=[];let goal={...expected,status};const rpc={request:async(method,params)=>{calls.push({method,params});return method==='thread/goal/get'?{goal}:{goal:{...goal,status:'active'}}}};
 const m={rpc,generation:1,service:{},assertControl(){},requireCapability(){},withMutation:fn=>fn()};
 const send=async()=>{calls.push({method:'input'});return {turn:{id:'accepted'}}};return {m,calls,send,setGoal:g=>goal=g};
}
test('blocked goal resumes only after accepted supplement and keeps native goal identity',async()=>{
 const f=fixture();const r=await sendWithGoalResume(f.m,'test',{resumeBlockedGoal:expected},f.send);assert.deepEqual(f.calls.map(c=>c.method),['input','thread/goal/get','thread/goal/set']);assert.deepEqual(f.calls[2].params,{threadId:'test',status:'active',origin:'user'});assert.equal(r.turn.id,'accepted');assert.equal(r.goalResume.status,'active');
});
test('paused, limited, completed, replaced and cleared goals are never automatically resumed',async()=>{
 for(const goal of [null,...['paused','budgetLimited','usageLimited','active','complete'].map(status=>({...expected,status})),{...expected,status:'blocked',createdAt:2},{...expected,status:'blocked',objective:'changed'}]){const f=fixture();f.setGoal(goal);await sendWithGoalResume(f.m,'test',{resumeBlockedGoal:expected},f.send);assert.equal(f.calls.some(c=>c.method==='thread/goal/set'),false);}
});
test('send rejection never resumes; resume failure never invalidates accepted input',async()=>{
 const f=fixture();await assert.rejects(sendWithGoalResume(f.m,'test',{resumeBlockedGoal:expected},async()=>{throw Error('not sent')}));assert.equal(f.calls.length,0);
 f.m.rpc.request=async()=>{throw Error('offline')};const r=await sendWithGoalResume(f.m,'test',{resumeBlockedGoal:expected},f.send);assert.equal(r.turn.id,'accepted');assert.match(r.goalResumeError,/消息已发送/);
});
test('ordinary input needs no goal query, and plan-only input cannot activate a goal',async()=>{
 const f=fixture();await sendWithGoalResume(f.m,'test',{},f.send);assert.equal(f.calls.length,1);await assert.rejects(sendWithGoalResume(f.m,'test',{mode:'plan',resumeBlockedGoal:expected},f.send));assert.equal(f.calls.length,1);
});
test('connection changes while sending or reading never resume a goal on another engine',async()=>{
 const f=fixture();const r=await sendWithGoalResume(f.m,'test',{resumeBlockedGoal:expected},async()=>{f.m.generation++;return {turn:{id:'accepted'}}});assert.equal(f.calls.length,0);assert.match(r.goalResumeError,/连接已变化/);
 const g=fixture();g.m.rpc.request=async()=>{g.m.generation++;return {goal:{...expected,status:'blocked'}}};const result=await sendWithGoalResume(g.m,'test',{resumeBlockedGoal:expected},g.send);assert.match(result.goalResumeError,/连接已变化/);
});
