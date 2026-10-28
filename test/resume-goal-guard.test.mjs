import test from 'node:test';
import assert from 'node:assert/strict';
import {Manager} from '../lib/manager.mjs';
import {ResumeGoalWarnings} from '../lib/resume-goal-guard.mjs';

const goal=(status='active')=>({objective:'完成专用验收',createdAt:100,updatedAt:200,status,tokensUsed:20,timeUsedSeconds:30});
function fixture({loaded=false,before=null,after=before,activity}={}){
 const m=new Manager({host:{id:'fixture',alias:'测试'}}),calls=[];
 m.connection={state:'connected'};
 m.rpc={connected:true,request:async(method,params)=>{
  calls.push({method,params});
  if(method==='thread/loaded/list')return {data:loaded?['thread']:[]};
  if(method==='thread/goal/get')return {goal:before};
  if(method==='thread/resume')return {thread:{id:'thread',status:{type:'idle'}}};
  throw Error('Unexpected mutation: '+method);
 }};
 m.passive=async(action,params)=>{calls.push({method:action,params});return {thread:{id:'thread',activity},goal:before};};
 m.detail=async()=>({thread:{id:'thread'},controlled:m.controlled.has('thread'),goal:after});
 return {m,calls};
}
test('cross-engine active goals and active desktop turns never resume or mutate native state',async()=>{
 for(const options of [{before:goal()},{activity:{state:'running'}},{before:goal('paused'),activity:{state:'running'}}]){
  const {m,calls}=fixture(options);
  await assert.rejects(m.takeover('thread'),e=>['GOAL_ACTIVE','DESKTOP_ACTIVE'].includes(e.code));
  assert.deepEqual(calls.map(c=>c.method),['thread/loaded/list','takeoverState']);assert.equal(m.controlled.size,0);assert.equal(m.subscriptions.size,0);
 }
});
test('ordinary idle handoff and inactive goals retain the original resume contract',async()=>{
 for(const before of [null,goal('paused'),goal('blocked'),goal('budgetLimited'),goal('usageLimited'),goal('complete')]){
  const {m,calls}=fixture({before,activity:{state:'idle'}});const detail=await m.takeover('thread');
  assert.equal(detail.controlled,true);assert.equal(detail.resumeWarning,null);
  assert.deepEqual(calls.at(-1),{method:'thread/resume',params:{threadId:'thread',excludeTurns:true}});
 }
});
test('same-engine active goals can resubscribe without consulting or replacing desktop ownership',async()=>{
 const {m,calls}=fixture({loaded:true,before:goal()});assert.equal((await m.takeover('thread')).controlled,true);
 assert.deepEqual(calls.map(c=>c.method),['thread/loaded/list','thread/goal/get','thread/resume']);
 await m.takeover('thread');assert.equal(calls.filter(c=>c.method==='thread/resume').length,1);
});
test('temporary same-engine sessions do not require persistent goals',async()=>{
 const {m,calls}=fixture({loaded:true}),request=m.rpc.request;
 m.rpc.request=async(method,params)=>{if(method==='thread/goal/get')throw Error('ephemeral thread does not support goals');return request(method,params);};
 assert.equal((await m.takeover('thread')).controlled,true);assert.equal(calls.at(-1).method,'thread/resume');
});
test('failed, malformed or stale preflight reads cannot trigger resume',async()=>{
 for(const scenario of ['failure','missing','malformed','changed']){
  const {m,calls}=fixture();m.passive=async()=>{
   if(scenario==='failure')throw Error('store locked');
   if(scenario==='changed')m.generation++;
   return scenario==='missing'?{}:{thread:{id:'thread'},goal:scenario==='malformed'?{status:'other'}:null};
  };
  await assert.rejects(m.takeover('thread'));assert.equal(calls.some(c=>c.method==='thread/resume'),false);assert.equal(m.controlled.size,0);
 }
});
test('lost or replaced goals produce a warning while preserving a successful native resume',async()=>{
 for(const after of [null,{...goal('paused'),createdAt:101}]){
  const {m,calls}=fixture({before:goal('paused'),after});const detail=await m.takeover('thread');
  assert.equal(detail.controlled,true);assert.match(detail.resumeWarning,/未保留|不一致/);
  assert.equal(detail.goal,after);assert.equal(m.errors.at(-1).diagnosticOnly,true);
  assert.equal(calls.some(c=>/goal\/(set|clear)|turn\/(start|interrupt)/.test(c.method)),false);
 }
});
test('goal verification errors remain warnings; terminal goals may expire without warnings',async()=>{
 const {m}=fixture({before:goal('paused'),after:null});m.detail=async()=>({controlled:true,goal:null,goalError:'read unavailable'});
 assert.match((await m.takeover('thread')).resumeWarning,/尚未确认/);
 const other=fixture({before:goal('complete'),after:null});assert.equal((await other.m.takeover('thread')).resumeWarning,null);
});
test('warning reconciliation is scoped and never fabricates or restores a native goal',()=>{
 const warnings=new ResumeGoalWarnings();warnings.check('a',goal(),null);warnings.check('b',goal(),null);
 assert.match(warnings.observe('a',null),/未保留/);assert.equal(warnings.observe('a',goal('complete')),null);
 assert.ok(warnings.observe('b',null));warnings.clear('b');assert.equal(warnings.observe('b',null),null);
});
test('reconnection detects missing goals without replaying the pre-resume goal as native state',async()=>{
 const {m}=fixture(),events=[];m.on('event',e=>events.push(e));
 m.rpc.request=async method=>method==='thread/goal/get'?{goal:null}:{data:[]};
 await m.recoverNotices(m.rpc,'thread',0,goal());
 assert.match(m.resumeGoalWarnings.observe('thread',null),/未保留/);
 assert.equal(events.some(e=>e.method==='thread/goal/updated'),false);
});

test('older loaded engines without a goal API retain ordinary session connectivity',async()=>{
 const {m,calls}=fixture({loaded:true}),request=m.rpc.request;
 m.rpc.request=async(method,params)=>{if(method==='thread/goal/get')throw Error('method not found');return request(method,params);};
 assert.equal((await m.takeover('thread')).controlled,true);
 assert.deepEqual(calls.map(c=>c.method),['thread/loaded/list','goal','thread/resume']);
});
test('reconnect preserves verified terminal goal completion receipts',async()=>{
 const {m}=fixture();m.rpc.request=async method=>method==='thread/goal/get'?{goal:null}:{data:[]};
 m.subscriptions.set('thread',{});
 await m.recoverNotices(m.rpc,'thread',0,goal('complete'));
 assert.equal(m.resumeGoalWarnings.observe('thread',null),null);
 assert.equal([...m.notices.values()].some(e=>e.method==='thread/goal/updated'&&e.params.goal.status==='complete'),true);
});

test('late pre-resume history cannot clear a newer missing-goal warning',()=>{
 const warnings=new ResumeGoalWarnings(),version=warnings.version('thread');
 warnings.check('thread',goal(),null);
 assert.match(warnings.observe('thread',goal(),version),/未保留/);
 assert.equal(warnings.observe('thread',goal()),null);
});
