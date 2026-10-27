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

test('only local numbered diagnostic device tests may select a strictly enumerated transport',async t=>{
 const {createPushKeys}=await import('../lib/web-push.mjs');
 const access=new MobileAccess(null),token=access.login(access.createCode().code),requests=[],originalFetch=globalThis.fetch;
 // Fail closed for every unexpected network destination. No real provider traffic.
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://web.push.apple.com/diagnostic-fixture');requests.push(options);return {status:201};};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const manager=Object.assign(new EventEmitter(),{disconnect(){},status:()=>({pendingRequests:[]})});
 const app=await createApp({stateDir:mkdtempSync(path.join(tmpdir(),'portal-diagnostic-routes-')),access,mobileConfig:{origins:['https://phone.test']},config:{defaultConnection:'test',connections:[]},managers:new Map([['test',manager]])});
 app.server.listen(0,'127.0.0.1');app.proxyServer.listen(0,'127.0.0.1');await Promise.all([once(app.server,'listening'),once(app.proxyServer,'listening')]);
 t.after(()=>{app.server.closeAllConnections();app.proxyServer.closeAllConnections();app.server.close();app.proxyServer.close();});
 const local=app.server.address().port,remote=app.proxyServer.address().port,csrf=(await request(local,'/api/csrf')).body.token;
 const headers={'X-CSRF-Token':csrf},phone={...headers,Host:'phone.test',Origin:'https://phone.test',Cookie:'rcm_mobile='+token};
 const subscription={endpoint:'https://web.push.apple.com/diagnostic-fixture',keys:{p256dh:createPushKeys().publicKey,auth:Buffer.alloc(16,2).toString('base64url')}};
 assert.equal((await request(remote,'/api/push/subscribe',phone,{subscription})).status,200);
 const deviceId=(await request(local,'/api/push/devices')).body.data[0].id;
 const data={deviceId,diagnostic:true,testId:'fixture-route-mode-001',deliveryMode:'legacy'};
 for(const change of [{deliveryMode:null},{deliveryMode:''},{deliveryMode:'LEGACY'},{deliveryMode:{}},{deliveryMode:['legacy']},{diagnostic:false},{diagnostic:'true'},{diagnostic:undefined},{testId:undefined},{testId:'short'},{testId:123}])assert.equal((await request(local,'/api/push/test-device',headers,{...data,...change})).status,400,JSON.stringify(change));
 assert.equal((await request(remote,'/api/push/test-device',phone,data)).status,403);
 assert.equal((await request(remote,'/api/push/test-device',{...phone,Origin:'https://evil.test'},data)).status,403);
 assert.equal((await request(local,'/api/push/test-device',{},data)).status,403);
 for(const port of [local,remote])assert.equal((await request(port,'/api/push/test',port===local?headers:phone,{...data,endpoint:subscription.endpoint})).status,400);
 assert.equal(requests.length,0);
 for(const [index,mode] of ['declarative','legacy'].entries())assert.equal((await request(local,'/api/push/test-device',headers,{...data,deliveryMode:mode,testId:'fixture-route-mode-'+index})).status,200);
 assert.deepEqual(requests.map(r=>r.headers['Content-Type']),['application/notification+json','application/octet-stream']);assert.ok(requests.every(r=>Buffer.isBuffer(r.body)));
 const traces=(await request(local,'/api/push/trace')).body.data;assert.deepEqual(traces.map(r=>r.mode),['declarative','legacy']);
 assert.equal((await request(local,'/api/push/test-device',headers,{deviceId,testId:'fixture-default-device'})).status,200);
 assert.equal((await request(remote,'/api/push/test',phone,{endpoint:subscription.endpoint,testId:'fixture-default-phone'})).status,200);
 assert.deepEqual(requests.slice(-2).map(r=>r.headers['Content-Type']),['application/octet-stream','application/octet-stream']);
});

test('device delivery settings require local Origin, CSRF, revision and a live device on the selected host',async t=>{
 const {writeFileSync}=await import('node:fs'),{homedir,userInfo}=await import('node:os'),{createPushKeys}=await import('../lib/web-push.mjs');
 const directory=mkdtempSync(path.join(tmpdir(),'portal-device-delivery-')),file=path.join(directory,'connections.json');
 const config={formatVersion:1,machineId:'fixture-machine',defaultConnection:'test',connections:[{id:'test',machineId:'fixture-machine',kind:'local',alias:'Fixture',user:userInfo().username,home:homedir(),binary:process.execPath}]};
 writeFileSync(file,JSON.stringify(config));
 const access=new MobileAccess(null),token=access.login(access.createCode().code);
 const manager=Object.assign(new EventEmitter(),{disconnect(){},status:()=>({pendingRequests:[]})});
 const app=await createApp({stateDir:directory,connectionConfigFile:file,access,mobileConfig:{origins:['https://phone.test']},config,managers:new Map([['test',manager],['other',manager]])});
 app.server.listen(0,'127.0.0.1');app.proxyServer.listen(0,'127.0.0.1');await Promise.all([once(app.server,'listening'),once(app.proxyServer,'listening')]);
 t.after(()=>app.close());
 const local=app.server.address().port,remote=app.proxyServer.address().port,csrf=(await request(local,'/api/csrf')).body.token,revision=(await request(local,'/api/connection-config')).body.revision;
 const headers={'X-CSRF-Token':csrf,'X-RCM-Config-Revision':revision},phone={...headers,Host:'phone.test',Origin:'https://phone.test',Cookie:'rcm_mobile='+token};
 const subscription={endpoint:'https://web.push.apple.com/setting-fixture',keys:{p256dh:createPushKeys().publicKey,auth:Buffer.alloc(16,2).toString('base64url')}};
 assert.equal((await request(remote,'/api/push/subscribe',phone,{subscription})).status,200);
 const deviceId=(await request(local,'/api/push/devices')).body.data[0].id,data={deviceId,deliveryMode:'legacy'},url='/api/push/device-delivery';
 assert.equal((await request(remote,url,{Host:'phone.test',Origin:'https://phone.test'},data)).status,401);
 assert.equal((await request(remote,url,phone,data)).status,403);
 assert.equal((await request(local,url,{...headers,Origin:'https://evil.test'},data)).status,403);
 assert.equal((await request(local,url,{'X-RCM-Config-Revision':revision},data)).status,403);
 assert.equal((await request(local,url,{...headers,'X-RCM-Config-Revision':'old'},data)).status,409);
 assert.equal((await request(local,url+'?host=missing',headers,data)).status,404);
 assert.equal((await request(local,url+'?host=other',headers,data)).status,404);
 for(const change of [{deliveryMode:undefined},{deliveryMode:null},{deliveryMode:'auto'},{deliveryMode:['legacy']},{deliveryMode:{}},{deviceId:123},{deviceId:'0'.repeat(64)},{payload:{title:'injected'}},{url:'https://evil.test/'}])assert.equal((await request(local,url,headers,{...data,...change})).status,change.deviceId==='0'.repeat(64)?404:400);
 assert.equal((await request(local,'/api/push/devices')).body.data[0].deliveryMode,undefined);
 assert.equal((await request(local,url,headers,data)).status,200);
 assert.equal((await request(local,'/api/push/devices')).body.data[0].deliveryMode,'legacy');
 assert.equal((await request(remote,'/api/push/subscribe',phone,{subscription})).status,200);
 assert.equal((await request(local,'/api/push/devices')).body.data[0].deliveryMode,'legacy');
 for(const deliveryMode of ['declarative','default']){assert.equal((await request(local,url,headers,{deviceId,deliveryMode})).status,200);assert.equal((await request(local,'/api/push/devices')).body.data[0].deliveryMode,deliveryMode==='default'?undefined:deliveryMode);}
 // Failure reports are writable from the owning paired worker, with the same
 // Origin/CSRF/revision protection, and can only reference a real send.
 const requests=[],originalFetch=globalThis.fetch;
 globalThis.fetch=async(endpoint,options)=>{assert.equal(endpoint,subscription.endpoint);requests.push(options);return {status:201};};
 t.after(()=>{globalThis.fetch=originalFetch;});
 assert.equal((await request(remote,'/api/push/test',phone,{endpoint:subscription.endpoint})).status,200);
 const {readFileSync}=await import('node:fs');const deliveryId=Object.keys(JSON.parse(readFileSync(path.join(directory,'web-push.json'),'utf8')).deliveries)[0];
 const failure={deliveryId,stage:'show'},failureUrl='/api/push/delivery-failure';
 assert.equal((await request(remote,failureUrl,{Host:'phone.test',Origin:'https://phone.test'},failure)).status,401);
 assert.equal((await request(remote,failureUrl,{...phone,Origin:'https://evil.test'},failure)).status,403);
 assert.equal((await request(remote,failureUrl,{...phone,'X-CSRF-Token':'wrong'},failure)).status,403);
 assert.equal((await request(remote,failureUrl,{...phone,'X-RCM-Config-Revision':'old'},failure)).status,409);
 assert.equal((await request(remote,failureUrl+'?host=other',phone,failure)).status,404);
 assert.equal((await request(remote,failureUrl+'?host=missing',phone,failure)).status,404);
 assert.equal((await request(local,failureUrl,headers,failure)).status,404);
 const another=access.login(access.createCode().code);
 assert.equal((await request(remote,failureUrl,{...phone,Cookie:'rcm_mobile='+another},failure)).status,404);
 for(const change of [{stage:'timeout'},{stage:undefined},{payload:{title:'arbitrary'}},{url:'https://evil.test/'}])assert.equal((await request(remote,failureUrl,phone,{...failure,...change})).status,400);
 assert.equal((await request(remote,failureUrl,phone,{...failure,deliveryId:crypto.randomUUID()})).status,404);
 assert.equal(requests.length,1);
 assert.equal((await request(remote,failureUrl,phone,failure)).status,200);
 assert.equal((await request(remote,failureUrl,phone,failure)).status,200);
 assert.deepEqual(requests.map(r=>r.headers['Content-Type']),['application/octet-stream','application/notification+json']);
 // Revoking the pairing makes the formerly valid device unmodifiable.
 for(const key of Object.keys(access.sessions))delete access.sessions[key];
 assert.equal((await request(local,url,headers,data)).status,404);
});
