import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter,once} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {MobileAccess} from '../lib/mobile-access.mjs';
function request(port,url,headers={},data){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method:data?'POST':'GET',headers},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);});}
test('push diagnostics preserve pairing, Origin, CSRF and ownership; device testing is local only',async t=>{
 const access=new MobileAccess(null),token=access.login(access.createCode().code);
 const manager=Object.assign(new EventEmitter(),{disconnect(){},status:()=>({pendingRequests:[]})});
 const app=await createApp({stateDir:mkdtempSync(path.join(tmpdir(),'portal-push-routes-')),access,mobileConfig:{origins:['https://phone.test']},config:{defaultConnection:'test',connections:[]},managers:new Map([['test',manager]])});
 app.server.listen(0,'127.0.0.1');app.proxyServer.listen(0,'127.0.0.1');await Promise.all([once(app.server,'listening'),once(app.proxyServer,'listening')]);
 t.after(()=>{app.server.closeAllConnections();app.proxyServer.closeAllConnections();app.server.close();app.proxyServer.close();});
 const local=app.server.address().port,remote=app.proxyServer.address().port;
 const csrf=(await request(local,'/api/csrf')).body.token;
 const headers={Host:'phone.test',Origin:'https://phone.test',Cookie:'rcm_mobile='+token,'X-CSRF-Token':csrf};
 assert.equal((await request(remote,'/api/push/trace',{Host:'phone.test'})).status,401);
 assert.equal((await request(remote,'/api/push/trace',{...headers,Origin:'https://wrong.test'},{stage:'page-ready'})).status,403);
 assert.equal((await request(remote,'/api/push/trace',{...headers,'X-CSRF-Token':'wrong'},{stage:'page-ready'})).status,403);
 assert.equal((await request(local,'/api/push/trace',{'X-CSRF-Token':csrf},{stage:'page-ready',threadId:'local-only'})).status,200);
 assert.equal((await request(remote,'/api/push/trace',headers,{stage:'page-target',threadId:'phone'})).status,200);
 assert.deepEqual((await request(remote,'/api/push/trace',headers)).body.data.map(r=>r.threadId),['phone']);
 assert.equal((await request(remote,'/api/push/devices',headers)).status,403);
 assert.equal((await request(remote,'/api/push/test-device',headers,{deviceId:'unknown'})).status,403);
 assert.equal((await request(local,'/api/push/test-device',{}, {deviceId:'unknown'})).status,403);
 assert.equal((await request(local,'/api/push/devices')).status,200);
});

test('background worker script can refresh without a pairing cookie while APIs and other assets remain protected',async t=>{
 const manager=Object.assign(new EventEmitter(),{disconnect(){}});
 const app=await createApp({stateDir:mkdtempSync(path.join(tmpdir(),'portal-worker-access-')),mobileConfig:{origins:['https://phone.test']},config:{defaultConnection:'test',connections:[]},managers:new Map([['test',manager]])});
 app.proxyServer.listen(0,'127.0.0.1');await once(app.proxyServer,'listening');
 t.after(()=>{app.proxyServer.closeAllConnections();app.proxyServer.close();});
 const read=(url,method='GET',headers={})=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:app.proxyServer.address().port,path:url,method,headers:{Host:'phone.test',...headers}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();
 });
 const script=await read('/notification-worker.js?v=6');assert.equal(script.status,200);assert.match(script.headers['content-type'],/javascript/);assert.match(script.body,/notificationclick/);assert.equal(script.headers['set-cookie'],undefined);
 const head=await read('/notification-worker.js?v=6','HEAD');assert.equal(head.status,200);assert.equal(head.body,'');
 assert.equal((await read('/notification-worker.js?v=6','GET',{'If-None-Match':script.headers.etag})).status,304);
 assert.equal((await read('/notification-worker.js','GET',{Origin:'https://evil.test'})).status,403);
 assert.equal((await read('/notification-worker.js','GET',{Host:'evil.test'})).status,403);
 assert.equal((await read('/notification-worker.js','POST',{Origin:'https://phone.test'})).status,401);
 for(const url of ['/api/push/trace','/api/csrf','/api/connections','/notification-platform.js','/notification-worker.js/extra'])assert.equal((await read(url)).status,401,url);
});
