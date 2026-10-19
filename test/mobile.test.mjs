import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {checkServe,describeTailscale} from '../lib/tailscale-serve.mjs';
import {EventEmitter} from 'node:events';
import {createApp} from '../server.mjs';
class Fake extends EventEmitter {host={id:'local'};disconnect(){} }
async function fixture(options,fn){
 const app=createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]]),...options});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 const {token}=await fetch(base+'/api/csrf').then(r=>r.json());
 const post=(route,headers={})=>fetch(base+route,{method:'POST',headers:{'x-csrf-token':token,...headers},body:'{}'});
 try{await fn(base,post,app);}finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
}
test('missing entrance prevents pairing and preview cannot configure',()=>fixture({},async(base,post)=>{
 const status=await fetch(base+'/api/access/status').then(r=>r.json());assert.deepEqual(status.origins,[]);assert.equal(status.canSetup,false);
 assert.equal((await post('/api/access/code')).status,409);assert.equal((await post('/api/access/setup')).status,409);
}));
test('setup requires local CSRF, publishes addresses and enables pairing without restart',()=>fixture({setupMobile:async()=>({origins:['https://192.0.2.1:4319']})},async(base,post,app)=>{
 assert.equal((await post('/api/access/setup',{'x-csrf-token':''})).status,403);
 assert.equal((await post('/api/access/setup',{origin:'https://evil.example'})).status,403);
 assert.equal((await post('/api/access/setup')).status,200);
 assert.deepEqual((await fetch(base+'/api/access/status').then(r=>r.json())).origins,['https://192.0.2.1:4319']);
 assert.match((await post('/api/access/code').then(r=>r.json())).code,/^\d{6}$/);
 await new Promise(r=>app.proxyServer.listen(0,'127.0.0.1',r));
 try{assert.equal(await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:app.proxyServer.address().port,path:'/api/access/setup',method:'POST',headers:{host:'192.0.2.1:4319',origin:'https://192.0.2.1:4319'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');}),401);}finally{app.proxyServer.closeAllConnections();await new Promise(r=>app.proxyServer.close(r));}
}));
test('failed setup leaves pairing unavailable and can be retried',async()=>{
 let calls=0;await fixture({setupMobile:async()=>{if(!calls++)throw Error('端口已占用');return {origins:['https://192.0.2.1:4319']};}},async(base,post)=>{
 assert.equal((await post('/api/access/setup')).status,502);assert.equal((await post('/api/access/code')).status,409);assert.equal((await post('/api/access/setup')).status,200);
 });
});

test('Tailscale configuration rejects conflicting routes and public Funnel',()=>{
 const config={TCP:{443:{HTTPS:true}},Web:{'test.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:4318'}}}}};
 assert.equal(checkServe({},'test.ts.net'),false);assert.equal(checkServe(config,'test.ts.net'),true);
 for(const change of [c=>c.AllowFunnel={'test.ts.net:443':true},c=>c.Web['test.ts.net:443'].Handlers['/'].Proxy='http://localhost:9999',c=>c.Web['test.ts.net:443'].Handlers['/other']={Path:'/tmp'},c=>c.TCP[443]={TCPForward:'localhost:22'}]){const c=structuredClone(config);change(c);assert.throws(()=>checkServe(c,'test.ts.net'));}
});

test('macOS LAN setup creates trusted TLS and usable QR without Tailscale or Python', {skip:process.platform!=='darwin'},async()=>{
 const {mkdtemp,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{default:path}=await import('node:path'),{default:https}=await import('node:https');
 const home=await mkdtemp(path.join(tmpdir(),'rcm-mobile-tls-'));
 await promisify(execFile)(process.execPath,['scripts/setup-mobile.mjs'],{env:{...process.env,HOME:home},timeout:30000});
 const config=JSON.parse(await readFile(path.join(home,'Library/Application Support/RemoteCodexManager/mobile/config.json'),'utf8'));
 const ca=await readFile(config.ca),qr=await readFile(path.join(path.dirname(config.ca),'lan.png'));assert.equal(qr.subarray(1,4).toString(),'PNG');
 await fixture({mobileConfig:config},async(base,post,app)=>{
  const tls=app.createSecureServer({key:await readFile(config.key),cert:await readFile(config.cert)});await new Promise(r=>tls.listen(0,config.lanIP,r));
  const origin=config.origins[0];
  const request=(pathname,{method='GET',cookie,body,headers={}}={})=>new Promise((resolve,reject)=>{
   const req=https.request({host:config.lanIP,port:tls.address().port,path:pathname,ca,method,headers:{host:new URL(origin).host,origin,...(cookie?{cookie}:{}),...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body&&JSON.stringify(body));
  });
  try{
   assert.equal((await request('/')).status,200);assert.equal((await request('/api/status')).status,401);
   const styles=await request('/mobile-ui.css');assert.equal(styles.status,200);assert.match(styles.headers['content-type'],/text\/css/);
   assert.equal((await request('/input-state.js')).status,401);
   const {code}=await post('/api/access/code').then(r=>r.json());const login=await request('/api/access/login',{method:'POST',body:{code}});assert.equal(login.status,200);
   const cookie=login.headers['set-cookie'][0].split(';')[0];assert.equal((await request('/api/access/status',{cookie})).status,200);
   assert.equal((await request('/api/access/login',{method:'POST',body:{code}})).status,401);
   const {token}=JSON.parse((await request('/api/csrf',{cookie})).text),headers={'x-csrf-token':token};
   for(const action of ['setup','code','revoke'])assert.equal((await request('/api/access/'+action,{method:'POST',cookie,headers,body:{}})).status,404);
   assert.equal((await request('/api/access/ca',{cookie})).status,404);
   const certificate=await fetch(base+'/api/access/ca');assert.equal(certificate.status,200);assert.match(certificate.headers.get('content-disposition'),/attachment/);assert.equal(await certificate.text(),ca.toString());
   assert.equal((await request('/api/access/logout',{method:'POST',cookie,headers})).status,200);
   assert.equal((await request('/api/access/status',{cookie})).status,401);
   const next=await post('/api/access/code').then(r=>r.json()),second=await request('/api/access/login',{method:'POST',body:{code:next.code}});
   const secondCookie=second.headers['set-cookie'][0].split(';')[0];assert.equal((await post('/api/access/revoke')).status,200);
   assert.equal((await request('/api/access/status',{cookie:secondCookie})).status,401);
  }finally{tls.closeAllConnections();await new Promise(r=>tls.close(r));}
 });
 console.log('手机测试数据保留：'+home);
});

test('Tailscale health distinguishes connection and certificate/DNS issues',()=>{
 assert.match(describeTailscale({BackendState:'Stopped'}),/未连接/);
 assert.match(describeTailscale({BackendState:'Running',Health:['DNS unavailable']}),/暂未就绪.*DNS unavailable/);
 assert.match(describeTailscale({BackendState:'Running',Health:[]}),/手机.*验证/);
});
