import test from 'node:test';import assert from 'node:assert/strict';
import {deploymentStatus} from '../lib/deployment-status.mjs';
import {checkDeploymentEntrance} from '../lib/deployment-entrance.mjs';
const snapshot={connection:{state:'connected'},controlledSessions:[{id:'ended',status:{type:'active'},lastTurnStatus:'completed',pendingRequests:0}],pendingRequests:[]};
test('deployment reads native status rather than trusting a stale active cache or previous completed turn',async()=>{
 const methods=[],manager={status:()=>structuredClone(snapshot),generation:1,statusRevision:1,rpc:{request:async(method,args)=>{methods.push([method,args]);return {thread:{name:'已完成的会话',status:{type:'idle'}}};}}};
 const result=await deploymentStatus(manager);assert.equal(result.controlledSessions[0].status.type,'idle');assert.equal(snapshot.controlledSessions[0].status.type,'active');assert.deepEqual(methods,[['thread/read',{threadId:'ended',includeTurns:false}]]);
 manager.rpc.request=async()=>({thread:{status:{type:'active'}}});assert.equal((await deploymentStatus(manager)).controlledSessions[0].status.type,'active');
 manager.rpc.request=async()=>{manager.statusRevision++;return {thread:{status:{type:'idle'}}};};await assert.rejects(deploymentStatus(manager),/状态发生变化/);
});
test('disconnected and connecting targets are never connected by a deployment read',async()=>{
 for(const state of ['disconnected','connecting','reconnecting']){const m={status:()=>({...snapshot,connection:{state}}),rpc:{request:()=>assert.fail('must not call RPC')}};assert.equal((await deploymentStatus(m)).connection.state,state);}
});
test('preflight retries short native settling window, keeps ongoing activity blocked and uses display names',async()=>{
 let reads=0,waits=0;const fetchImpl=async url=>({ok:true,status:200,json:async()=>url.endsWith('/api/connections')?{data:[{id:'local',host:{alias:'本机'}}]}:{...snapshot,controlledSessions:[{id:'ended',name:'部署验收会话',status:{type:++reads===1?'active':'idle'},pendingRequests:0}]}});
 await checkDeploymentEntrance({localConnectionId:'local',fetchImpl,wait:async()=>{waits++;}});assert.equal(reads,2);assert.equal(waits,1);
 reads=0;await assert.rejects(checkDeploymentEntrance({localConnectionId:'local',fetchImpl,attempts:1}),/部署验收会话/);
});

test('local deployment endpoint returns fresh native state without opening a target',async()=>{
 const {EventEmitter}=await import('node:events');const {createApp}=await import('../server.mjs');
 const manager=Object.assign(new EventEmitter(),{host:{id:'local'},status:()=>structuredClone(snapshot),disconnect(){},connect(){assert.fail('must not connect');},rpc:{request:async()=>({thread:{status:{type:'idle'},name:'已完成'}})}});
 const app=createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',manager]])});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/system/deployment-status');assert.equal(r.status,200);assert.equal((await r.json()).controlledSessions[0].status.type,'idle');}finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});
