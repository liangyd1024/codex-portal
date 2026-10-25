import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {request} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createApp} from './fixtures/legacy-server.mjs';
import {MobileAccess} from '../lib/mobile-access.mjs';
const manifest=JSON.parse(await readFile(new URL('../.framework-build/latest.json',import.meta.url),'utf8'));
const {createFrameworkApp}=await import(pathToFileURL(manifest.output+'/server/application.mjs'));

test('thread presence parity binds view updates to target, live SSE and mobile login',{timeout:10000},async()=>{
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const calls=[],records=[],streams=[],access=new MobileAccess(null);
  const managers=new Map(['a','b'].map(id=>{const m=new EventEmitter();Object.assign(m,{
   host:{id},disconnect(){},status:()=>({connection:{state:'disconnected'},pendingRequests:[]}),
   retention:{attach(key){calls.push([id,'attach',typeof key==='string'?key:'anonymous']);return ()=>{calls.push([id,'release',typeof key==='string'?key:'anonymous']);m.emit('view-released');};},async view(...args){calls.push([id,'view',...args]);}},
  });return [id,m];}));
  const app=await factory({config:{machineId:'fixture',defaultConnection:'a',connections:[]},managers,access,mobileConfig:{origins:['https://phone.test'],ca:'/fixture/unused'},updater:{status:async()=>({}),subscribe:()=>()=>{}}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await new Promise(r=>app.proxyServer.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token:csrf}=await fetch(base+'/api/csrf').then(r=>r.json());
  const cookie=()=> 'rcm_mobile='+access.login(access.createCode().code),cookieA=cookie(),cookieB=cookie();
  const options=(path,remote,cookieValue)=>({hostname:'127.0.0.1',port:(remote?app.proxyServer:app.server).address().port,path,headers:remote?{host:'phone.test',cookie:cookieValue,origin:'https://phone.test'}:{}});
  const record=(path,{remote=false,cookieValue=cookieA,method='GET',data,token=csrf,origin}={})=>new Promise((resolve,reject)=>{
   const init=options(path,remote,cookieValue);init.method=method;init.headers['x-csrf-token']=token;if(origin)init.headers.origin=origin;
   const req=request(init,res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{const row={status:res.statusCode,body:JSON.parse(text),mime:res.headers['content-type']};records.push(row);resolve(row);});});req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));
  });
  const open=(viewId,remote=false)=>new Promise((resolve,reject)=>{
   const req=request(options('/api/events?viewId='+viewId,remote,cookieA),res=>{assert.equal(res.statusCode,200);res.once('data',()=>resolve(req));res.on('error',()=>{});res.resume();});req.on('error',reject);streams.push(req);req.end();
  });
  const viewId='fixture-local-0001',phoneId='fixture-phone-0001',threadId='00000000-0000-0000-0000-000000000001';
  const data={viewId,threadId,revision:1};
  try{
   await record('/api/thread-view',{method:'POST',data});
   await record('/api/thread-view',{method:'POST',data,token:'wrong'});
   await record('/api/events?viewId=bad');assert.equal(calls.length,0);
   const stream=await open(viewId);
   await record('/api/thread-view',{method:'POST',data});
   await record('/api/thread-view?host=b',{method:'POST',data});
   for(const patch of [{revision:-1},{revision:1.5},{revision:'1'},{threadId:'bad'},{viewId:null},{sideThreadId:'bad'},{sideThreadId:1},{sideThreadId:true}])await record('/api/thread-view',{method:'POST',data:{...data,...patch}});
   await record('/api/thread-view',{method:'POST',data:{...data,revision:2,threadId:null,unknown:{keep:true}}});
   await record('/api/thread-view',{method:'POST',data:{...data,revision:3,sideThreadId:threadId}});
   await record('/api/thread-view',{remote:true,method:'POST',data});
   await open(phoneId,true);const phone={...data,viewId:phoneId};
   await record('/api/thread-view',{remote:true,method:'POST',data:phone});
   await record('/api/thread-view',{remote:true,cookieValue:cookieB,method:'POST',data:phone});
   await record('/api/thread-view',{method:'POST',data:phone});
   await record('/api/thread-view',{remote:true,method:'POST',data:phone,origin:'https://other.test'});
   const released=new Promise(r=>managers.get('a').once('view-released',r));stream.destroy();await released;
   await record('/api/thread-view',{method:'POST',data});
   assert.deepEqual(records.map(r=>r.status),[409,403,400,200,409,400,400,400,400,400,400,400,400,200,200,409,200,409,409,403,409]);
   assert.deepEqual(calls.filter(c=>c[1]==='view'),[['a','view',viewId,threadId,1,null],['a','view',viewId,null,2,null],['a','view',viewId,threadId,3,threadId],['a','view',phoneId,threadId,1,null]]);
   outcomes.push({records,calls:structuredClone(calls)});
  }finally{
   for(const stream of streams)stream.destroy();app.proxyServer.closeAllConnections();await new Promise(r=>app.proxyServer.close(r));app.server.closeAllConnections();
   if(app.close)await app.close();else await new Promise(r=>app.server.close(r));
  }
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});
