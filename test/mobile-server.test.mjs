import http from 'node:http';
import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter,once} from 'node:events';import {createApp} from '../server.mjs';import {MobileAccess} from '../lib/mobile-access.mjs';
function fetch(url,options={}) {return new Promise((resolve,reject)=>{const req=http.request(url,{method:options.method||'GET',headers:options.headers||{}},res=>{const headers={get:key=>Array.isArray(res.headers[key])?res.headers[key].join(';'):res.headers[key]};if(url.endsWith('/api/events')&&res.statusCode===200){const iterator=res[Symbol.asyncIterator]();resolve({status:res.statusCode,headers,body:{getReader:()=>({read:()=>iterator.next()})}});return;}let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,headers,json:async()=>JSON.parse(raw)}));});req.on('error',reject);req.end(options.body);});}
class Fake extends EventEmitter{status(){return {connection:{state:'connected'},pendingRequests:[]};}disconnect(){} }
test('remote ingress requires pairing, exact origin and CSRF; revocation closes SSE',{timeout:5000},async t=>{
 let sendUpdate;
 const a=new MobileAccess(null),fake=new Fake();const {server,proxyServer}=await createApp({config:{defaultConnection:"test",connections:[]},managers:new Map([["test",fake]]),updater:{status:async()=>({}),subscribe:fn=>{sendUpdate=fn;return ()=>{};}},access:a,mobileConfig:{origins:['https://phone.test']}});
 server.listen(0,'127.0.0.1');proxyServer.listen(0,'127.0.0.1');await Promise.all([once(server,'listening'),once(proxyServer,'listening')]);
 t.after(()=>{server.closeAllConnections();proxyServer.closeAllConnections();server.close();proxyServer.close();});
 const local='http://127.0.0.1:'+server.address().port,remote='http://127.0.0.1:'+proxyServer.address().port;
 const headers={Host:'phone.test',Origin:'https://phone.test'};
 for(const route of ['/api/status','/api/events','/api/csrf','/api/threads','/app.js'])assert.equal((await fetch(remote+route,{headers})).status,401);
 assert.equal((await fetch(remote+'/',{headers})).status,200);
 assert.equal((await fetch(remote+'/api/status',{headers:{Host:'localhost:'+server.address().port}})).status,403);
 const csrf=(await (await fetch(local+'/api/csrf')).json()).token;
 const code=(await (await fetch(local+'/api/access/code',{method:'POST',headers:{'X-CSRF-Token':csrf},body:JSON.stringify({sessionTtlSeconds:null})})).json()).code;
 assert.equal((await fetch(remote+'/api/access/login',{method:'POST',headers:{Host:'phone.test'},body:JSON.stringify({code})})).status,403);
 const login=await fetch(remote+'/api/access/login',{method:'POST',headers,body:JSON.stringify({code})});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/Max-Age=34560000/);headers.Cookie=login.headers.get('set-cookie').split(';')[0];
 const status=await fetch(remote+'/api/access/status',{headers});assert.equal((await status.json()).sessionExpires,null);assert.match(status.headers.get('set-cookie'),/Max-Age=34560000/);
 assert.equal((await fetch(remote+'/api/status',{headers})).status,200);
 assert.equal((await fetch(remote+'/api/access/code',{method:'POST',headers:{...headers,'X-CSRF-Token':csrf},body:'{}'})).status,404);
 assert.equal((await fetch(remote+'/api/disconnect',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await fetch(remote+'/api/csrf',{headers:{...headers,Origin:'https://evil.test'}})).status,403);
 const stream=await fetch(remote+'/api/events',{headers});const reader=stream.body.getReader();await reader.read();
 // A queued update may arrive after the first network chunk. It is not a live connection.
 sendUpdate({version:'queued-before-revoke'});
 await fetch(local+'/api/access/revoke',{method:'POST',headers:{'X-CSRF-Token':csrf},body:'{}'});
 let buffered='';for(;;){const chunk=await reader.read();if(chunk.done)break;buffered+=chunk.value.toString();}
 assert.match(buffered,/queued-before-revoke/);assert.equal((await fetch(remote+'/api/status',{headers})).status,401);
});
