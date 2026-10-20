import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createApp} from '../server.mjs';
test('system update requires CSRF, rejects caller-supplied execution parameters and returns progress',async()=>{
 class Fake extends EventEmitter{host={id:'local'};disconnect(){}}
 let starts=0;const updater={status:async()=>({available:true,job:null}),start:async()=>{starts++;return {available:true,job:{phase:'queued'}};}};
 const app=createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]]),updater});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{
  assert.equal((await fetch(base+'/api/system/update').then(r=>r.json())).available,true);
  const post=(headers={},body={})=>fetch(base+'/api/system/update',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await post()).status,403);const {token}=await fetch(base+'/api/csrf').then(r=>r.json());const headers={'x-csrf-token':token};
  assert.equal((await post({...headers,origin:'https://elsewhere.test'})).status,403);
  assert.equal((await post(headers,{threadId:'forged',sourceRoot:'/other'})).status,400);
  assert.equal((await post(headers)).status,202);assert.equal(starts,1);
 }finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});
