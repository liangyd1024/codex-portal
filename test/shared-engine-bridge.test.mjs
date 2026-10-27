import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startSharedEngineBridge} from '../lib/shared-engine-bridge.mjs';
import {sharedDesktopState} from '../lib/shared-desktop.mjs';
import {Manager} from '../lib/manager.mjs';
const token='a'.repeat(64);
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'portal-share-')),socketPath=path.join(dir,'native.sock'),seen=[];
 const peers=new Set(),native=net.createServer(s=>{peers.add(s);s.on('close',()=>peers.delete(s));let request='';s.on('data',chunk=>{request+=chunk;if(request.includes('\r\n\r\n')){seen.push(request);s.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nnative-frame');}});});
 await new Promise(r=>native.listen(socketPath,r));const counts=[];
 const bridge=await startSharedEngineBridge({socketPath,token,port:0,onConnections:n=>counts.push(n)});
 t.after(async()=>{await bridge.close();for(const s of peers)s.destroy();await new Promise(r=>native.close(r));});return{dir,socketPath,native,bridge,seen,counts};
}
function request(port,{url='/rpc/'+token,origin,upgrade=true}={}){return new Promise((resolve,reject)=>{const s=net.connect(port,'127.0.0.1');let response='';s.on('error',reject);s.on('data',v=>response+=v);s.on('end',()=>resolve(response));s.on('connect',()=>s.end('GET '+url+' HTTP/1.1\r\nHost: localhost\r\n'+(upgrade?'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n':'Connection: close\r\n')+(origin?'Origin: '+origin+'\r\n':'')+'\r\n'));});}
test('shared bridge forwards native handshake and bytes without exposing its capability',async t=>{
 const f=await fixture(t);const response=await request(f.bridge.port);assert.match(response,/native-frame/);assert.equal(f.seen.length,1);assert.match(f.seen[0],/^GET \/ HTTP/);assert.ok(!f.seen[0].includes(token));assert.ok(f.counts.includes(1));
});
test('shared bridge rejects missing capability and browser Origin before opening native socket',async t=>{
 const f=await fixture(t);for(const options of [{url:'/rpc/bad'},{url:'/'},{origin:'http://evil.example'},{origin:'http://127.0.0.1'}])assert.match(await request(f.bridge.port,options),/403 Forbidden/);assert.equal(f.seen.length,0);assert.match(await request(f.bridge.port,{upgrade:false}),/404/);
});
test('shared bridge validates native socket and does not change occupied port',async t=>{
 const f=await fixture(t);await assert.rejects(startSharedEngineBridge({socketPath:f.socketPath,token,port:f.bridge.port}),{code:'EADDRINUSE'});
 const ordinary=path.join(f.dir,'ordinary');await writeFile(ordinary,'data');await assert.rejects(startSharedEngineBridge({socketPath:ordinary,token,port:0}),/身份或权限/);
 await chmod(f.dir,0o777);await assert.rejects(startSharedEngineBridge({socketPath:f.socketPath,token,port:0}),/身份或权限/);await chmod(f.dir,0o700);
});
test('shared marker protects service before activation, hides handoff only for live verified transport',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'portal-marker-')),h={kind:'local',dataDir},file=path.join(dataDir,'desktop-shared.json');
 assert.deepEqual(sharedDesktopState(h,{now:0}),{configured:false,activated:false});
 await writeFile(file,JSON.stringify({activated:false}));assert.deepEqual(sharedDesktopState(h,{now:1001}),{configured:true,activated:false});
 await writeFile(file,JSON.stringify({activated:true}));await writeFile(file+'.status',JSON.stringify({pid:process.pid,connections:1}));assert.deepEqual(sharedDesktopState(h,{now:2002}),{configured:true,activated:true});
 await writeFile(file+'.status',JSON.stringify({pid:process.pid,connections:0}));assert.deepEqual(sharedDesktopState(h,{now:3003}),{configured:true,activated:false});
 await writeFile(file,'broken');assert.deepEqual(sharedDesktopState(h,{now:4004}),{configured:true,activated:false});
});
test('shared engine release is denied before interruption or native maintenance',async()=>{
 const m=new Manager({host:{kind:'local'}}),calls=[];m.serviceAction=async action=>{calls.push(action);return{sharedDesktop:true}};
 await assert.rejects(m.release({allEntrancesDisconnected:true}),e=>e.code==='SHARED_ENGINE');assert.deepEqual(calls,['ownership']);
});

test('unknown sharing status fails closed before service maintenance',async()=>{const m=new Manager({host:{kind:'local'}});m.serviceAction=async()=>({});await assert.rejects(m.release({allEntrancesDisconnected:true}),e=>e.code==='SHARED_ENGINE_UNKNOWN');});
