import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createApp} from '../server.mjs';
test('system update requires CSRF, rejects caller-supplied execution parameters and returns progress',async()=>{
 class Fake extends EventEmitter{host={id:'local'};disconnect(){}}
 let starts=0;const updater={status:async()=>({available:true,job:null}),start:async()=>{starts++;return {available:true,job:{phase:'queued'}};}};
 const app=await createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]]),updater});
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
test('existing SSE sends machine-wide update events to both entries and unsubscribes on close',async()=>{
 class Fake extends EventEmitter{host={id:'local'};status(){return {pendingRequests:[]};}disconnect(){}}
 const listeners=new Set();let checks=0;
 const updater={status:async()=>({version:'a',job:null}),checkLatest:async()=>{checks++;},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
 const app=await createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]]),updater});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const controllers=[new AbortController(),new AbortController()];
 try{
  const readers=await Promise.all(controllers.map(async c=>(await fetch(base+'/api/events',{signal:c.signal})).body.getReader()));
  const readUntil=async(reader,value)=>{let text='';while(!text.includes(value)){const chunk=await reader.read();if(chunk.done)throw Error('closed');text+=new TextDecoder().decode(chunk.value);}return text;};
  await Promise.all(readers.map(r=>readUntil(r,'system/update')));assert.equal(listeners.size,2);
  for(const listener of listeners)listener({version:'a',job:{phase:'testing'}});
  for(const reader of readers)assert.match(await readUntil(reader,'testing'),/system\/update/);
  await fetch(base+'/api/system/update?check=1');assert.equal(checks,1);
 }finally{controllers.forEach(c=>c.abort());app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
 for(let i=0;i<50&&listeners.size;i++)await new Promise(r=>setTimeout(r,10));assert.equal(listeners.size,0);
});
