import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {MobileAccess} from '../lib/mobile-access.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));
const {createFrameworkApp,PreviewMobileAccess}=await import(pathToFileURL(path.join(manifest.output,'server/application.mjs')));
const config={formatVersion:1,machineId:'fixture',defaultConnection:'a',connections:[]};
function target(id,calls){return Object.assign(new EventEmitter(),{
 host:{id,alias:'Fixture '+id},connection:{state:'connected'},controlled:new Map(),models:[{id:'fixture-model'}],
 status(){return {connection:this.connection,unknownNativeField:{keep:['all',1]},pendingRequests:[]};},
 disconnect(){},restoreConnection(){},requireConnected(){},
 threads:async data=>{calls.push([id,'threads',data]);return {data:[],unknown:{preserve:true}};},
 history:async(...args)=>{calls.push([id,'history',args]);return {raw:'原文\n\n',extra:[1,2]};},
 detail:async(...args)=>{calls.push([id,'detail',args]);return {thread:{id:args[0]},unrecognized:'retained'};},
 newThread:async data=>{calls.push([id,'newThread',data]);return {id:'fixture-thread',data};},
 message:async(...args)=>{calls.push([id,'message',args]);return {ok:true};},
 respond:(...args)=>{calls.push([id,'respond',args]);return {ok:true};},
 });}
async function create(factory){const calls=[],managers=new Map(['a','b'].map(id=>[id,target(id,calls)]));
 const access=new MobileAccess(null),updater={status:async()=>({version:'fixture',state:'idle'}),subscribe(){return ()=>{};}};
 const app=await factory({config,managers,access,updater,buildVersion:'fixture',staticRoot:path.join(root,'public')});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const {token}=await fetch(base+'/api/csrf').then(r=>r.json());calls.length=0;
 return {app,base,token,calls,access,managers,async close(){app.server.closeAllConnections();if(app.close)await app.close();else await new Promise(r=>app.server.close(r));}};
}
const cases=[
 ['/api/version'],['/api/connections'],['/api/status'],['/api/status?host=unknown'],['/api/models'],
 ['/api/threads?host=b&search=a&search=b&cursor=opaque'],['/api/threads/id/history?cursor=a%2Fb'],
 ['/api/threads/id?preview=1&fast=1&outputEncoding=delta',{headers:{'x-output-versions':'{"x":3}'}}],
 ['/api/threads/id',{headers:{'x-output-versions':'invalid'}}],['/api/not-a-route'],
 ['/api/threads',{method:'POST',body:'{"unknown":{"a":1},"text":"中文"}',auth:true}],
 ['/api/threads',{method:'POST',body:'',auth:true}],
 ['/api/threads',{method:'POST',body:'null',auth:true}],
 ['/api/threads',{method:'POST',body:'[]',auth:true}],
 ['/api/threads',{method:'POST',body:'{',auth:true}],
 ['/api/threads',{method:'POST',body:'{',headers:{origin:'https://untrusted.test'}}],
 ['/api/threads',{method:'POST',body:'{'}],
 ['/api/threads',{method:'POST',body:'{"x":1}',auth:true,headers:{'content-type':'application/octet-stream'}}],
 ['/api/requests/request%3A1/respond',{method:'POST',body:'{"answer":true}',auth:true}],
 ['/api/threads/id/message',{method:'POST',body:JSON.stringify({text:'x'.repeat(1100000)}),auth:true}],
 ['/api/threads',{method:'POST',body:JSON.stringify({text:'x'.repeat(1100000)}),auth:true}],
 ['/api/status',{method:'PUT'}],['/styles.css',{method:'HEAD'}],['/missing-resource'],
 ['/api/status',{headers:{host:'untrusted.test'}}],
];
test('Fastify matches baseline status, JSON, security headers and native call arguments',async()=>{
 const old=await create(createApp),next=await create(createFrameworkApp);
 try{for(const [url,options={}] of cases){const results=[];for(const env of [old,next]){env.calls.length=0;
  const {auth,...init}=options;const response=await fetch(env.base+url,{...init,headers:{...init.headers,...(auth?{'x-csrf-token':env.token}:{})}});
  const body=await response.text();results.push({status:response.status,body,headers:Object.fromEntries(['content-type','cache-control','x-content-type-options','referrer-policy','content-security-policy','vary'].map(k=>[k,response.headers.get(k)])),calls:structuredClone(env.calls)});
 }assert.deepEqual(results[1],results[0],url+' '+(options.method||'GET'));}}
 finally{await old.close();await next.close();}
});
test('Fastify preserves SSE original payloads and target filtering',async()=>{
 const next=await create(createFrameworkApp);const abort=new AbortController();
 try{const response=await fetch(next.base+'/api/events?host=b',{signal:abort.signal});assert.equal(response.headers.get('content-type'),'text/event-stream; charset=utf-8');
 const reader=response.body.getReader(),initial=new TextDecoder().decode((await reader.read()).value);assert.match(initial,/unknownNativeField/);
 next.managers.get('a').emit('event',{method:'must-not-leak'});next.managers.get('b').emit('event',{method:'native/unknown',params:{verbatim:'原文',future:{x:1}}});
 let output='';while(!output.includes('native/unknown'))output+=new TextDecoder().decode((await reader.read()).value);
 assert.ok(!output.includes('must-not-leak'));assert.ok(output.includes('"future":{"x":1}'));abort.abort();
 }finally{abort.abort();await next.close();}
});
test('built client retains every CSS byte and stylesheet order',async()=>{
 const baseline=await readFile(path.join(root,'public/index.html'),'utf8'),built=await readFile(path.join(manifest.output,'public/index.html'),'utf8');
 const sheets=s=>[...s.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(sheets(built),sheets(baseline));
 for(const sheet of sheets(baseline))assert.deepEqual(await readFile(path.join(manifest.output,'public',sheet.slice(1))),await readFile(path.join(root,'public',sheet.slice(1))));
 assert.match(await readFile(path.join(manifest.output,'public/bootstrap.js'),'utf8'),/import\('\.\/framework.js'\)/);
});

test('preview phone cookies cannot replace or authorize production phone sessions',()=>{
 const production=new MobileAccess(null),preview=new PreviewMobileAccess(null);
 const prodToken=production.login(production.createCode().code),previewToken=preview.login(preview.createCode().code);
 const prodCookie=production.cookie(prodToken).split(';')[0],previewCookie=preview.cookie(previewToken).split(';')[0];
 assert.ok(prodCookie.startsWith('rcm_mobile='));assert.ok(previewCookie.startsWith('rcm_mobile_preview='));
 assert.equal(production.valid({headers:{cookie:previewCookie}}),false);assert.equal(preview.valid({headers:{cookie:prodCookie}}),false);
 const both={headers:{cookie:prodCookie+'; '+previewCookie}};assert.ok(production.valid(both));assert.ok(preview.valid(both));
 preview.revoke();assert.ok(production.valid(both));assert.equal(preview.valid(both),false);
});
