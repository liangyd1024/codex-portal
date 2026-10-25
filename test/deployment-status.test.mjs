import test from 'node:test';import assert from 'node:assert/strict';
import {deploymentStatus} from '../lib/deployment-status.mjs';
import {checkDeploymentEntrance} from '../lib/deployment-entrance.mjs';
const snapshot={connection:{state:'connected'},controlledSessions:[{id:'ended',status:{type:'active'},lastTurnStatus:'completed',pendingRequests:0}],pendingRequests:[]};
test('deployment snapshot does not read native threads or alter running state',async()=>{
 const manager={status:()=>structuredClone(snapshot),rpc:{request:()=>assert.fail('must not read native state')}};
 assert.deepEqual(await deploymentStatus(manager),snapshot);
});
test('disconnected and connecting targets are never connected by a deployment read',async()=>{
 for(const state of ['disconnected','connecting','reconnecting']){const m={status:()=>({...snapshot,connection:{state}}),rpc:{request:()=>assert.fail('must not call RPC')}};assert.equal((await deploymentStatus(m)).connection.state,state);}
});
test('preflight retries connection recovery, uses only one status read per stable target',async()=>{
 const urls=[];let reads=0,waits=0;
 const fetchImpl=async url=>{urls.push(url);return {ok:true,status:200,json:async()=>url.endsWith('/api/connections')?{data:[{id:'local',host:{alias:'本机'}}]}:{...snapshot,connection:{state:++reads===1?'reconnecting':'connected'}}};};
 await checkDeploymentEntrance({localConnectionId:'local',fetchImpl,wait:async()=>{waits++;}});
 assert.equal(reads,2);assert.equal(waits,1);assert.ok(urls.every(u=>['/api/connections','/api/status'].includes(new URL(u).pathname)));
});

test('local deployment endpoint returns web connection state without opening a target',async()=>{
 const {EventEmitter}=await import('node:events');const {createApp}=await import('../server.mjs');
 const manager=Object.assign(new EventEmitter(),{host:{id:'local'},status:()=>structuredClone(snapshot),disconnect(){},connect(){assert.fail('must not connect');},rpc:{request:async()=>({thread:{status:{type:'idle'},name:'已完成'}})}});
 const app=await createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',manager]])});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/system/deployment-status');assert.equal(r.status,200);assert.equal((await r.json()).controlledSessions[0].status.type,'active');}finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});

test('preflight forwards only the explicitly allowed local request key',async()=>{
 const fetchImpl=async url=>({ok:true,status:200,json:async()=>url.endsWith('/api/connections')?{data:[{id:'local',host:{alias:'本机'}}]}:{connection:{state:'connected'},controlledSessions:[{id:'running',status:{type:'active'},pendingRequests:1}],pendingRequests:[{key:'known-request',threadId:'running'}]}});
 await assert.rejects(checkDeploymentEntrance({localConnectionId:'local',fetchImpl,attempts:1}),/待处理请求/);
 await checkDeploymentEntrance({localConnectionId:'local',fetchImpl,attempts:1,allowedPendingRequestKeys:new Set(['known-request'])});
 await assert.rejects(checkDeploymentEntrance({localConnectionId:'local',fetchImpl,attempts:1,allowedPendingRequestKeys:new Set(['other-request'])}),/待处理请求/);
});
