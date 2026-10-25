import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createStaticResponse,acceptsGzip} from '../lib/http/static-response.mjs';
import {shareRead} from '../lib/core/pending-read.mjs';
import {readSidebar,readSidebarActivity} from '../src/server/services/sidebar.ts';
import {sshArgs} from '../lib/transports/ssh-options.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('static representations preserve bytes, negotiate compression, revalidate and notice edits',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rcm-static-')),file=path.join(dir,'asset.js'),serve=createStaticResponse();
 const source='const text="中文";\n'.repeat(200);await writeFile(file,source);
 const request=async(headers={},method='GET')=>{const result={};await serve({headers,method},{writeHead(status,headers){Object.assign(result,{status,headers});},end(body){result.body=body;}},file);return result;};
 const plain=await request(),gzip=await request({'accept-encoding':'br, gzip'});
 assert.equal(plain.body.toString(),source);assert.equal(gunzipSync(gzip.body).toString(),source);assert.ok(gzip.body.length<plain.body.length);assert.notEqual(plain.headers.ETag,gzip.headers.ETag);
 assert.equal((await request({'if-none-match':plain.headers.ETag})).status,304);
 assert.equal((await request({'if-none-match':plain.headers.ETag,'accept-encoding':'gzip'})).status,200);
 assert.equal((await request({},'HEAD')).body,undefined);
 assert.equal(acceptsGzip('gzip;q=0, *;q=1'),false);assert.equal(acceptsGzip('*;q=0.5'),true);
 await writeFile(file,'changed');const changed=await request({'if-none-match':plain.headers.ETag});assert.equal(changed.status,200);assert.equal(changed.body.toString(),'changed');
});
test('pending reads share only matching owners and keys, recover after failure and never cache completed values',async()=>{
 const owner={},gate=deferred();let calls=0;const read=()=>{calls++;return gate.promise;};
 const a=shareRead(owner,'a',read),b=shareRead(owner,'a',read);assert.equal(a,b);
 await Promise.resolve();assert.equal(calls,1);gate.reject(Error('failed'));await assert.rejects(a);await assert.rejects(b);
 assert.equal(await shareRead(owner,'a',()=>2),2);assert.equal(await shareRead(owner,'a',()=>3),3);
 assert.equal(await shareRead({},'a',()=>4),4);
});
test('deferred sidebar reads do not await activity and late activity cannot cross connections',async()=>{
 const calls=[],gate=deferred();const manager={generation:1,rpc:{request:async()=>({workspaceRouting:{chatgptAccountId:'account'}})},requireConnected(){},service:{},controlled:new Map(),passive:async(action,params)=>{calls.push({action,params});if(action==='sidebarActivity')return gate.promise;return {data:[],accountScope:'account'};}};
 await Promise.all([readSidebar(manager,{activity:'deferred'}),readSidebar(manager,{activity:'deferred'})]);assert.equal(calls.length,1);assert.equal(calls[0].params.includeActivity,false);
 const activity=readSidebarActivity(manager,{ids:'["thread-a"]',accountId:'spoof'});await new Promise(r=>setImmediate(r));assert.equal(calls[1].params.accountId,'account');manager.generation++;gate.resolve({data:[]});await assert.rejects(activity,{code:'CONNECTION_CHANGED'});
 await assert.rejects(readSidebarActivity(manager,{ids:'["../bad"]'}));
});
test('SSH sharing is explicit and retains host and identity verification; writes default to independent connections',()=>{
 const host={port:22,identityFile:'/safe/key',controlPath:'/private/session/socket'};
 const plain=sshArgs(host),read=sshArgs(host,{reuse:true}),master=sshArgs(host,{master:true});
 assert.equal(plain[1],'none');assert.equal(read[1],host.controlPath);assert.ok(master.includes('ControlMaster=yes'));
 for(const args of [plain,read,master]){assert.ok(args.includes('StrictHostKeyChecking=yes'));assert.ok(args.includes('IdentityAgent=none'));assert.ok(args.includes('ControlPersist=no'));}
 assert.equal(sshArgs({...host,controlPath:undefined},{reuse:true})[1],'none');
});
