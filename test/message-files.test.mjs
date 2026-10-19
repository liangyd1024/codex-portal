import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createApp} from '../server.mjs';
import {itemFileUrl} from '../public/message-files.js';

test('file URLs preserve Chinese, spaces, percent and code line references',()=>{
 const ref='/tmp/中文 (1) 100%.js:12';const url=new URL(itemFileUrl('t','i',ref,'remote','meta'),'http://localhost');
 assert.equal(url.searchParams.get('reference'),ref);assert.equal(url.searchParams.get('host'),'remote');assert.equal(url.searchParams.get('mode'),'meta');
});
test('scoped file route streams bytes and preserves ranges, downloads and access checks',async()=>{
 const calls=[];let cancelled=0;
 class Fake extends EventEmitter {
  disconnect(){}
  async openFile(threadId,itemId,payload){calls.push({threadId,itemId,payload});return {meta:{status:payload.range?206:200,name:'中文 (1).mp4',mime:'video/mp4',kind:'video',size:20,length:3,start:2,end:4,etag:'"v1"'},body:Readable.from([Buffer.from([0,128,255])]),cancel(){cancelled++;}};}
 }
 const app=createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]])});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const route=base+itemFileUrl('thread','item','/tmp/中文.mp4','local');
 try {
  const result=await fetch(route,{headers:{Range:'bytes=2-4'}});assert.equal(result.status,206);assert.equal(result.headers.get('content-range'),'bytes 2-4/20');assert.deepEqual(Buffer.from(await result.arrayBuffer()),Buffer.from([0,128,255]));
  assert.equal(calls[0].payload.reference,'/tmp/中文.mp4');assert.equal(calls[0].threadId,'thread');assert.equal(calls[0].itemId,'item');
  assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('x-content-type-options'),'nosniff');
  const download=await fetch(route.replace('mode=content','mode=download'));assert.match(download.headers.get('content-disposition'),/^attachment;.*filename\*=UTF-8''%E4/);assert.equal(download.headers.get('content-type'),'application/octet-stream');await download.arrayBuffer();
  const head=await fetch(route,{method:'HEAD'});assert.equal(head.headers.get('content-length'),'3');assert.equal(await head.text(),'');
  const meta=await fetch(route.replace('mode=content','mode=meta')).then(r=>r.json());assert.equal(meta.name,'中文 (1).mp4');
  assert.equal((await fetch(route,{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(route.replace('host=local','host=unknown'))).status,404);
  assert.equal((await fetch(route.replace('mode=content','mode=exec'))).status,400);assert.equal(calls.length,4);assert.equal(cancelled,4);
 } finally {app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});

test('binary reader preserves non-UTF8 bytes across header chunks and cancels producers',async()=>{
 const {runFileReader}=await import('../lib/file-transfer.mjs');
 const script="import sys,json\nsys.stdout.buffer.write(json.dumps({'status':200,'size':256}).encode()+b'\\n')\nsys.stdout.buffer.write(bytes(range(256)))\nsys.stdout.buffer.flush()\n";
 const transfer=await runFileReader({kind:'local'},script);const chunks=[];for await(const c of transfer.body)chunks.push(c);assert.deepEqual(Buffer.concat(chunks),Buffer.from(Array.from({length:256},(_,i)=>i)));
 const controller=new AbortController();
 const running=await runFileReader({kind:'local'},"import sys,time\nprint('{\"status\":200}',flush=True)\nwhile True:\n sys.stdout.buffer.write(b'x'*65536)\n sys.stdout.buffer.flush()\n time.sleep(0.01)\n",{signal:controller.signal});
 const closed=new Promise(resolve=>running.body.once('close',resolve));controller.abort();await closed;assert.equal(running.body.destroyed,true);
 await assert.rejects(runFileReader({kind:'local'},"print('invalid header')\n"),/JSON|Unexpected/);
});

test('transfer errors and invalid ranges remain actionable HTTP errors',async()=>{
 class Fake extends EventEmitter {disconnect(){}async openFile(){return {meta:{status:416,error:'范围无效',size:20},body:Readable.from([]),cancel(){}};}}
 const app=createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]])});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try {const result=await fetch('http://127.0.0.1:'+app.server.address().port+itemFileUrl('t','i','/tmp/a','local'));assert.equal(result.status,416);assert.equal(result.headers.get('content-range'),'bytes */20');assert.equal((await result.json()).error.message,'范围无效');}
 finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});

test('unpaired mobile clients cannot read file bytes',async()=>{
 let calls=0;class Fake extends EventEmitter {disconnect(){}async openFile(){calls++;throw Error('must not run');}}
 const mobileConfig={origins:[]};const app=createApp({mobileConfig,config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]])});
 await new Promise(r=>app.proxyServer.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.proxyServer.address().port;mobileConfig.origins.push(base);
 try {const response=await fetch(base+itemFileUrl('t','i','/tmp/a','local'));assert.equal(response.status,401);assert.equal(calls,0);}
 finally {app.proxyServer.closeAllConnections();await new Promise(r=>app.proxyServer.close(r));}
});
