import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
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
async function create(factory,options={}){const calls=[],managers=new Map(['a','b'].map(id=>[id,target(id,calls)]));
 const access=new MobileAccess(null),updater={status:async()=>({version:'fixture',state:'idle'}),subscribe(){return ()=>{};}};
 const app=await factory({config,managers,access,updater,buildVersion:'fixture',staticRoot:path.join(root,'public'),...options});
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
test('native process summary module is reachable with JavaScript MIME type',async()=>{
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory);
  try{const response=await fetch(env.base+'/process-summary.js');
   assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
   assert.equal(await response.text(),await readFile(path.join(root,'public/process-summary.js'),'utf8'));
  }finally{await env.close();}
 }
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


test('mobile setup keeps validation, CSRF order and setup callback behavior',async()=>{
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const calls=[];
  const env=await create(factory,{setupMobile:async mode=>{calls.push(mode);return {origins:['https://mobile.example.test:4339'],ca:'/fixture/ca.crt',key:'/fixture/server.key',cert:'/fixture/server.crt'};}});
  try{
   const records=[];
   const request=async(body,auth=true)=>{const response=await fetch(env.base+'/api/access/setup',{method:'POST',headers:{'content-type':'application/json',...(auth?{'x-csrf-token':env.token}:{})},body});records.push({status:response.status,body:await response.json(),calls:[...calls]});};
   await request('{',false);
   await request(JSON.stringify({mode:'invalid'}));
   await request('{}');
   await request(JSON.stringify({mode:'tailscale'}));
   const status=await fetch(env.base+'/api/access/status').then(r=>r.json());
   assert.equal(status.canSetup,true);assert.deepEqual(status.origins,['https://mobile.example.test:4339']);
   assert.deepEqual(calls,['lan','tailscale']);
   assert.equal(records[0].status,403);assert.equal(records[1].status,400);
   assert.equal(records[2].status,200);assert.equal(records[3].status,200);
   outcomes.push({records,status});
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('Fastify preserves file bytes, range and HEAD semantics with transfer cleanup',async()=>{
 const outcomes=[];
 const requests=[
  ['?mode=content',{}],['?mode=download',{}],['?mode=text',{}],['?mode=meta',{}],
  ['?mode=content',{method:'HEAD'}],
  ['?reference=opaque%2Fref',{headers:{range:'bytes=2-5','if-range':'"fixture"'}}],
  ['',{headers:{range:'bytes=99-'}}],['?mode=invalid',{}],
 ];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),records=[];
  try{
   for(const [query,init] of requests){
    const calls=[];let cancellations=0;
    env.managers.get('b').openFile=async(thread,item,options)=>{
     calls.push({thread,item,options});
     const content=Buffer.from('0123456789'),partial=options.range==='bytes=2-5',invalid=options.range==='bytes=99-';
     return {meta:invalid?{error:'请求范围无效。',status:416,size:10}:{
      status:partial?206:200,size:10,length:partial?4:10,start:partial?2:0,end:partial?5:9,
      name:'验收文件 (1).txt',mime:'text/plain; charset=utf-8',etag:'"fixture"',kind:'text',
     },body:Readable.from([partial?content.subarray(2,6):content]),cancel(){cancellations++;}};
    };
    const response=await fetch(env.base+'/api/threads/qa-thread/items/qa-item/file'+(query?query+'&host=b':'?host=b'),init);
    const bytes=Buffer.from(await response.arrayBuffer()).toString('hex');
    // Allow the server's pipeline finally block to run after the client receives EOF.
    await new Promise(resolve=>setImmediate(resolve));
    records.push({status:response.status,bytes,calls,cancellations,headers:Object.fromEntries([
     'content-type','content-length','content-disposition','content-range','accept-ranges','etag','cache-control','content-security-policy',
    ].map(key=>[key,response.headers.get(key)]))});
   }
   assert.deepEqual(records.map(r=>r.status),[200,200,200,200,200,206,416,400]);
   assert.equal(records[0].bytes,Buffer.from('0123456789').toString('hex'));
   assert.equal(records[4].bytes,'');assert.equal(records[5].bytes,Buffer.from('2345').toString('hex'));
   assert.equal(records[5].headers['content-range'],'bytes 2-5/10');
   assert.equal(records[6].headers['content-range'],'bytes */10');
   assert.equal(records[5].calls[0].options.reference,'opaque/ref');
   assert.equal(records[5].calls[0].options.ifRange,'"fixture"');
   assert.equal(records[4].calls[0].options.head,true);
   assert.ok(records.slice(0,7).every(r=>r.cancellations>=1));assert.equal(records[7].calls.length,0);
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('Fastify keeps connection and thread action dispatch including native error details',async()=>{
 const routes=[
  ['/api/connect','connect',[]],['/api/disconnect','disconnect',[]],
  ['/api/account/reload','reloadLogin'],['/api/service/release','release'],
  ['/api/notices/ack','acknowledgeNotice',['notice-key']],['/api/diagnostics/clear','clearDiagnosticHistory',[]],
  ['/api/threads/qa-thread/takeover','takeover',['qa-thread']],
  ['/api/threads/qa-thread/handoff','handoff',['qa-thread']],
  ['/api/threads/qa-thread/interrupt','interrupt',['qa-thread']],
  ['/api/threads/qa-thread/steer','steer'],['/api/threads/qa-thread/question-answer','answerQuestions'],
 ];
 const payload={key:'notice-key',text:'中文原文\n第二行',future:{keep:[1,{unknown:true}]}};
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),records=[];
  try{
   for(const [route,method,explicitArgs] of routes){
    const args=explicitArgs??(route.startsWith('/api/threads/')?['qa-thread',payload]:[payload]);
    for(const failure of [false,true]){
     // connect intentionally acknowledges immediately while its asynchronous failure is handled.
     if(failure&&method==='connect')continue;
     const calls=[];
     env.managers.get('b')[method]=(...values)=>{
      calls.push(values);
      if(failure)throw Object.assign(new Error('原生拒绝：保持原文。'),{status:409,code:'NATIVE_BUSY',details:{future:['原文',7]}});
      return {ok:true,unknown:{verbatim:'保留'}};
     };
     const response=await fetch(env.base+route+'?host=b',{method:'POST',headers:{'x-csrf-token':env.token},body:JSON.stringify(payload)});
     const data=await response.json();
     assert.deepEqual(calls,[args],route);
     assert.equal(response.status,failure?409:method==='connect'?202:200,route);
     if(failure)assert.deepEqual(data,{error:{message:'原生拒绝：保持原文。',code:'NATIVE_BUSY',details:{future:['原文',7]}}});
     records.push({route,failure,status:response.status,data,calls});
    }
   }
   outcomes.push(records);
  }finally{
   // Teardown is separate from the intentionally failing disconnect route case.
   env.managers.get('b').disconnect=()=>{};await env.close();
  }
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('connection services preserve catalog cache rules, account reads and asynchronous connect acknowledgement',async()=>{
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),manager=env.managers.get('b'),records=[];
  try{
   for(const scenario of ['cached','forced','other-refresh','empty','offline','catalog-error','projects','projects-error','api-key','chatgpt','account-error','connect-async-error','connect-sync-error']){
    const calls=[],nativeError=()=>Object.assign(new Error('原生读取拒绝。'),{status:409,code:'NATIVE_STATE',details:{future:['保留',3]}});
    manager.models=scenario==='empty'?[]:[{id:'cached',future:{keep:true}}];
    manager.requireConnected=()=>{calls.push(['requireConnected']);if(scenario==='offline')throw nativeError();};
    manager.refreshCatalog=async kind=>{calls.push(['refreshCatalog',kind]);if(scenario.endsWith('error'))throw nativeError();return [{id:'fresh-'+kind,future:{keep:'原文'}}];};
    manager.generation=1;manager.accountRevision=0;
    manager.rpc={request:async(method,params,options)=>{
     calls.push(['rpc',method,params,options]);if(scenario==='account-error')throw nativeError();
     if(method==='account/read')return {account:scenario==='api-key'?{type:'apiKey',apiKey:'test-secret-never-public'}:{type:'chatgpt',email:'tester@example.test',token:'test-secret-never-public'}};
     return {rateLimits:{primary:{usedPercent:25,future:{unknown:true}}}};
    }};
    manager.connect=()=>{calls.push(['connect']);if(scenario==='connect-sync-error')throw nativeError();return Promise.reject(nativeError());};
    const account=['api-key','chatgpt','account-error'].includes(scenario),connect=scenario.startsWith('connect-');
    const route=connect?'/api/connect':account?'/api/account/usage':scenario.startsWith('projects')?'/api/projects':'/api/models';
    const refresh=scenario==='forced'||scenario==='catalog-error'?'&refresh=1':scenario==='other-refresh'?'&refresh=2':'';
    const response=await fetch(env.base+route+'?host=b'+refresh,connect?{method:'POST',headers:{'x-csrf-token':env.token},body:'{}'}:{});
    const data=await response.json();
    const failure=['offline','catalog-error','projects-error','account-error','connect-sync-error'].includes(scenario);
    assert.equal(response.status,failure?409:connect?202:200,scenario);
    if(failure)assert.deepEqual(data,{error:{message:'原生读取拒绝。',code:'NATIVE_STATE',details:{future:['保留',3]}}});
    if(['cached','other-refresh'].includes(scenario)){assert.equal(data.data[0].id,'cached');assert.deepEqual(calls,[['requireConnected']]);}
    if(['forced','empty'].includes(scenario)){assert.equal(data.data[0].id,'fresh-models');assert.deepEqual(calls,[['requireConnected'],['refreshCatalog','models']]);}
    if(scenario==='offline')assert.deepEqual(calls,[['requireConnected']]);
    if(scenario==='projects')assert.deepEqual(calls,[['refreshCatalog','projects']]);
    if(scenario==='api-key'){assert.deepEqual(data,{visible:false,account:{type:'apiKey'}});assert.equal(calls.filter(c=>c[0]==='rpc').length,1);}
    if(scenario==='chatgpt'){assert.equal(calls.filter(c=>c[0]==='rpc').length,3);assert.deepEqual(data.rateLimits.primary.future,{unknown:true});}
    assert.ok(!JSON.stringify(data).includes('test-secret-never-public'));
    if(connect)assert.deepEqual(calls,[['connect']]);
    records.push({scenario,status:response.status,data,calls});
   }
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});
