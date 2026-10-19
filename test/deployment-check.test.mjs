import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDeploymentIdle} from '../lib/deployment-check.mjs';
const own='00000000-0000-7000-8000-000000000001',other='00000000-0000-7000-8000-000000000002';
const options={connectionId:'local',localConnectionId:'local',deployingThreadId:own};
const status=(ids=[])=>({connection:{state:'connected'},pendingRequests:[],controlledSessions:ids.map(id=>({id,status:{type:'active'},pendingRequests:0}))});
test('deploying conversation can restart its local web entrance without stopping the turn',()=>{
 const s=status([own]),before=structuredClone(s);assert.equal(assertDeploymentIdle(s,options),own);assert.deepEqual(s,before);
 assert.equal(assertDeploymentIdle(status(),options),null);
});
test('other active conversations still block and report their IDs',()=>{
 assert.throws(()=>assertDeploymentIdle(status([own,other]),options),e=>e.message.includes(other)&&!e.message.includes(own));
});
test('missing, invalid, different or remote caller IDs do not grant an exemption',()=>{
 for(const patch of [{deployingThreadId:undefined},{deployingThreadId:'*'},{deployingThreadId:other},{connectionId:'remote'}])assert.throws(()=>assertDeploymentIdle(status([own]),{...options,...patch}),/运行会话/);
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
