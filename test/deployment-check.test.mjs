import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDeploymentIdle} from '../lib/deployment-check.mjs';
const own='00000000-0000-7000-8000-000000000001',other='00000000-0000-7000-8000-000000000002';
const options={connectionId:'local',localConnectionId:'local',deployingThreadId:own};
const status=(ids=[])=>({connection:{state:'connected'},pendingRequests:[],controlledSessions:ids.map(id=>({id,status:{type:'active'},pendingRequests:0}))});
test('web deployment permits all running local and remote conversations without mutating state',()=>{
 for(const connectionId of ['local','remote']){
  const s=status([own,other]),before=structuredClone(s);
  assert.equal(assertDeploymentIdle(s,{...options,connectionId,deployingThreadId:undefined}),null);
  assert.deepEqual(s,before);
 }
});
test('own pending requests and reconnects still block',()=>{
 const s=status([own]);s.pendingRequests.push({threadId:own});assert.throws(()=>assertDeploymentIdle(s,options),/待处理请求/);
 s.pendingRequests=[];s.controlledSessions[0].pendingRequests=1;assert.throws(()=>assertDeploymentIdle(s,options),/待处理请求/);
 s.controlledSessions[0].pendingRequests=0;for(const state of ['connecting','reconnecting']){s.connection.state=state;assert.throws(()=>assertDeploymentIdle(s,options),/正在连接/);}
});
test('unreadable status fails closed, ordinary idle deployment is allowed',()=>{
 for(const s of [null,{}, {connection:{},controlledSessions:[]}])assert.throws(()=>assertDeploymentIdle(s,options),/无法核对/);
 assert.equal(assertDeploymentIdle(status(),{...options,deployingThreadId:undefined}),null);
});
test('native session state does not gate a web restart',()=>{
 for(const type of ['active','systemError','unknown','idle','notLoaded']){
  const s=status([other]);s.controlledSessions[0].status={type};
  assert.equal(assertDeploymentIdle(s,options),null);
 }
});
test('explicit request exception is local, exact, invocation-only and never hides extra requests',()=>{
 const s=status([other]);s.pendingRequests=[{key:'request-one',threadId:other}];s.controlledSessions[0].pendingRequests=1;
 const allowed={...options,allowedPendingRequestKeys:new Set(['request-one'])},before=structuredClone(s);
 assert.equal(assertDeploymentIdle(s,allowed),null);assert.deepEqual(s,before);
 assert.throws(()=>assertDeploymentIdle(s,options),/待处理请求/);
 assert.throws(()=>assertDeploymentIdle(s,{...allowed,connectionId:'remote'}),/待处理请求/);
 s.pendingRequests.push({key:'request-two',threadId:other});assert.throws(()=>assertDeploymentIdle(s,allowed),/待处理请求/);
 s.pendingRequests.pop();s.controlledSessions[0].pendingRequests=2;assert.throws(()=>assertDeploymentIdle(s,allowed),/待处理请求/);
 s.controlledSessions[0].pendingRequests=1;s.connection.state='reconnecting';assert.throws(()=>assertDeploymentIdle(s,allowed),/正在连接/);
});
