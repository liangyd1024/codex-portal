import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createApp} from '../server.mjs';
test('sidebar routes use target identity and require the existing origin and CSRF guards',async()=>{
 const calls=[];
 const create=id=>Object.assign(new EventEmitter(),{host:{id,alias:id},connection:{state:'connected'},controlled:new Map(),service:{protocolValidation:{policy:4,unsupportedMethods:[]}},requireConnected(){},requireWritable(){},status(){return {}},disconnect(){},rpc:{request:async()=>({workspaceRouting:{chatgptAccountId:id}})},passive:async(action,params)=>{calls.push({id,action,params});return {data:[],projects:[],sections:[],accountScope:id,accountLayoutAvailable:true};}});
 const config={machineId:'a',defaultConnection:'a',connections:[]},managers=new Map([['a',create('a')],['b',create('b')]]),{server}=createApp({config,managers});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const r=await fetch(base+'/api/sidebar?host=b&accountId=spoof').then(r=>r.json());assert.equal(r.accountScope,'b');assert.equal(calls[0].params.accountId,'b');
  assert.equal((await fetch(base+'/api/sidebar/actions?host=b',{method:'POST',body:'{}'})).status,403);
  const {token}=await fetch(base+'/api/csrf').then(r=>r.json());
  assert.equal((await fetch(base+'/api/sidebar/actions?host=b',{method:'POST',headers:{'x-csrf-token':token,origin:'https://elsewhere.test'},body:'{}'})).status,403);
  const result=await fetch(base+'/api/sidebar/actions?host=b',{method:'POST',headers:{'x-csrf-token':token},body:JSON.stringify({action:'createSection',name:'test',accountScope:'b'})});assert.equal(result.status,409);assert.equal((await result.json()).error.code,'FEATURE_UNAVAILABLE');
  assert.equal(calls.at(-1).id,'b');assert.equal((await fetch(base+'/sidebar.js')).status,200);assert.equal((await fetch(base+'/sidebar.css')).status,200);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
