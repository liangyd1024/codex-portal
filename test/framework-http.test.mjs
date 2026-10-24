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


test('thread routes preserve query rules, helper validation and native queue forwarding',async()=>{
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),m=env.managers.get('a');
  Object.assign(m,{generation:1,activeTurns:new Set(),service:{protocolValidation:{features:{capacityRetry:{supported:true}}}},
   requireLogin(){},requireWritable(){},assertControl(id){env.calls.push(['control',id]);},
   requireCapability(name){env.calls.push(['capability',name]);},
   withMutation:async(fn,id)=>{env.calls.push(['mutation',id]);return fn();},
   rpc:{connected:true,request:async(method,params,options)=>{env.calls.push(['rpc',method,params,options??null]);return method==='thread/read'?{thread:{status:{type:'idle'}}}:{raw:'原文\n\n',future:{preserved:true}};}},
  });
  const requests=[
   ['/api/thread-references?search=first&search=last&cursor=one&cursor=two',undefined,200],
   ['/api/threads?search=first&search=last&cursor=one&cursor=two',undefined,200],
   ['/api/threads/id/history?cursor=one&cursor=two',undefined,200],
   ['/api/threads/id/side-chat-view',undefined,410],
   ['/api/threads/id/side-chat',{},400],
   ['/api/threads/id/retry-capacity',{},400],
   ['/api/threads/id/queue-add',{threads:['reference']},400],
   ['/api/threads/id/queue-delete',{},400],
   ['/api/threads/id/queue-delete',{queuedSubmissionId:'queue-1',future:42},200],
   ['/api/threads/id/queue-steer',{queuedSubmissionId:'queue-2'},200],
   ['/api/threads/id/goal',{clear:true},200],
   ['/api/threads/id/goal',{tokenBudget:-1},400],
   ['/api/threads/id/history',{},404],
   ['/api/threads/id/message',undefined,404],
   ['/api/threads/invalid.id',undefined,404],
   ['/api/threads/'+ 'x'.repeat(161),undefined,404],
  ];
  try{
   const records=[];
   for(const [url,data,status] of requests){env.calls.length=0;
    const response=await fetch(env.base+url,data===undefined?{}:{method:'POST',headers:{'x-csrf-token':env.token},body:JSON.stringify(data)});
    assert.equal(response.status,status,url);
    records.push({status:response.status,body:await response.json(),calls:structuredClone(env.calls)});
   }
   assert.deepEqual(records[0].calls,[['a','threads',{search:'first',cursor:'one'}]]);
   assert.deepEqual(records[1].calls,[['a','threads',{search:'last',cursor:'two'}]]);
   assert.deepEqual(records[2].calls,[['a','history',['id','one']]]);
   assert.deepEqual(records[8].calls.filter(c=>c[0]==='rpc'),[['rpc','thread/queue/delete',{threadId:'id',queuedSubmissionId:'queue-1'},null]]);
   assert.deepEqual(records[9].calls.filter(c=>c[0]==='rpc'),[['rpc','thread/read',{threadId:'id',includeTurns:false},null],['rpc','thread/queue/start',{threadId:'id',queuedSubmissionId:'queue-2'},null]]);
   assert.deepEqual(records[10].calls.filter(c=>c[0]==='rpc'),[['rpc','thread/goal/clear',{threadId:'id',origin:'user'},{timeoutMs:10000}]]);
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});


test('file client cancellation releases pending opens and active streams without harming later requests',{timeout:10000},async()=>{
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),records=[];
  try{
   for(const phase of ['opening','streaming','range']){
    let opened,cleaned,cancellations=0,signal,body,pushed=false;
    const started=new Promise(resolve=>{opened=resolve;}),cleanup=new Promise(resolve=>{cleaned=resolve;});
    const calls=[];
    env.managers.get('b').openFile=async(thread,item,options,context)=>{
     signal=context.signal;calls.push({thread,item,options});opened();
     if(phase==='opening')await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
     body=new Readable({read(){if(!pushed){pushed=true;this.push(Buffer.from('fixture-part'));}}});
     return {meta:{status:phase==='range'?206:200,size:1048576,length:phase==='range'?524288:1048576,start:0,end:524287,name:'fixture.txt',mime:'text/plain',kind:'text',etag:'"fixture"'},body,cancel(){cancellations++;body.destroy();cleaned();}};
    };
    const controller=new AbortController();
    const pending=fetch(env.base+'/api/threads/qa-thread/items/qa-item/file?host=b',{signal:controller.signal,headers:phase==='range'?{range:'bytes=0-524287'}:{}});
    // Attach a rejection observer before aborting a request that has no headers yet.
    const result=pending.then(response=>({response}),error=>({error}));
    await started;
    let received='';
    if(phase==='opening'){
     controller.abort();assert.equal((await result).error.name,'AbortError');
    }else{
     const {response}=await result;assert.equal(response.status,phase==='range'?206:200);
     const reader=response.body.getReader();received=new TextDecoder().decode((await reader.read()).value);
     assert.equal(received,'fixture-part');controller.abort();
     await assert.rejects(reader.read(),{name:'AbortError'});
    }
    await cleanup;await new Promise(resolve=>setImmediate(resolve));
    assert.equal(signal.aborted,true);assert.equal(body.destroyed,true);
    assert.equal(cancellations,phase==='opening'?2:1);
    const next=await fetch(env.base+'/api/status?host=b');assert.equal(next.status,200);
    assert.deepEqual((await next.json()).unknownNativeField,{keep:['all',1]});
    records.push({phase,received,cancellations,aborted:signal.aborted,destroyed:body.destroyed,calls});
   }
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});


test('closing one SSE client preserves other clients and never disconnects the target',{timeout:10000},async()=>{
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),first=new AbortController(),second=new AbortController();
  const manager=env.managers.get('b');let disconnects=0;manager.disconnect=()=>{disconnects++;};
  try{
   const initialListeners=manager.listenerCount('event');
   const responseA=await fetch(env.base+'/api/events?host=b',{signal:first.signal});
   const readUntil=async(reader,marker)=>{const decoder=new TextDecoder();let text='';while(!text.includes(marker)){const part=await reader.read();assert.equal(part.done,false);text+=decoder.decode(part.value,{stream:true});}return text;};
   const readerA=responseA.body.getReader();const initialA=await readUntil(readerA,'event: system/update\ndata: {"version":"fixture","state":"idle"}\n\n');
   const responseB=await fetch(env.base+'/api/events?host=b',{signal:second.signal});
   const readerB=responseB.body.getReader();const initialB=await readUntil(readerB,'event: system/update\ndata: {"version":"fixture","state":"idle"}\n\n');
   assert.equal(initialA,initialB);
   first.abort();await assert.rejects(readerA.read(),{name:'AbortError'});
   const event={method:'native/unknown',params:{threadId:'qa-thread',verbatim:'中文原文\n第二行',future:{keep:[1,2]}}};
   env.managers.get('a').emit('event',{method:'other-target-must-not-leak',params:{}});
   manager.emit('event',event);
   const chunk=await readUntil(readerB,JSON.stringify(event)+'\n\n');
   assert.ok(chunk.includes(JSON.stringify(event)));assert.ok(!chunk.includes('other-target-must-not-leak'));
   assert.equal(disconnects,0);assert.equal(manager.listenerCount('event'),initialListeners);
   second.abort();await assert.rejects(readerB.read(),{name:'AbortError'});
   const status=await fetch(env.base+'/api/status?host=b').then(response=>response.json());
   assert.equal(status.connection.state,'connected');assert.equal(disconnects,0);
   outcomes.push({initial:initialB,chunk,listeners:manager.listenerCount('event'),disconnects,state:status.connection.state});
  }finally{first.abort();second.abort();await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('media routes preserve image bytes, query selection, download headers and failure order',async()=>{
 const outcomes=[];
 const scenarios=[
  {mime:'image/png'}, {mime:'image/jpeg'}, {mime:'image/webp'}, {mime:'image/gif'},
  {query:'&preview=1&part=0&reference=opaque%2Fref&download=1'},
  {query:'&preview=true&preview=1&part=first&part=second&reference=&download=true&download=1'},
  {mime:'image/svg+xml'}, {mime:'text/html'},
  {failure:true}, {method:'HEAD'}, {method:'POST',auth:true}, {method:'POST',auth:false},
  {thread:'a'.repeat(160),item:'b'.repeat(160)}, {thread:'a'.repeat(161)}, {item:'b'.repeat(161)},
  {thread:'bad%2Fid'}, {host:'unknown'},
 ];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),records=[];
  try{
   for(const scenario of scenarios){
    const calls=[],bytes=Buffer.from([0,255,10,13,128,65,0]);
    for(const [id,manager] of env.managers)manager.image=async(...args)=>{
     calls.push({id,args});
     if(scenario.failure)throw Object.assign(new Error('原生图片读取失败。'),{status:409,code:'IMAGE_PENDING',details:{unknown:['完整',1]}});
     return {data:bytes.toString('base64'),mime:scenario.mime||'image/png',extension:'fixture',unknown:{preserved:true}};
    };
    const response=await fetch(env.base+'/api/threads/'+(scenario.thread||'qa-thread')+'/items/'+(scenario.item||'qa-item')+'/image?host='+(scenario.host||'b')+(scenario.query||''),{
     method:scenario.method||'GET',headers:scenario.auth?{'x-csrf-token':env.token}:{},...(scenario.method==='POST'?{body:'{}'}:{}),
    });
    records.push({status:response.status,bytes:Buffer.from(await response.arrayBuffer()).toString('hex'),calls,headers:Object.fromEntries([
     'content-type','content-length','cache-control','content-disposition','content-security-policy','x-content-type-options',
    ].map(key=>[key,response.headers.get(key)]))});
   }
   assert.deepEqual(records.map(r=>r.status),[200,200,200,200,200,200,400,400,409,404,404,403,200,404,404,404,404]);
   for(const index of [0,1,2,3,4,5,12])assert.equal(records[index].bytes,'00ff0a0d804100');
   assert.deepEqual(records[4].calls,[{id:'b',args:['qa-thread','qa-item',{preview:true,part:'0',reference:'opaque/ref'}]}]);
   assert.equal(records[4].headers['content-disposition'],'attachment; filename="qa-item.fixture"');
   assert.deepEqual(records[5].calls[0].args[2],{preview:false,part:'first',reference:''});
   assert.equal(records[5].headers['content-disposition'],null);
   for(const index of [9,10,11,13,14,15,16])assert.equal(records[index].calls.length,0);
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('desktop and automation routes preserve binding, receipts, payload precedence and target isolation',async()=>{
 const ids=Array.from({length:6},(_,i)=>'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'));
 const [bound,generic,messageId,otherMessage,turnId,otherThread]=ids,outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),records=[];
  try{
   for(const [host,manager] of env.managers){
    manager.subscriptions=new Map();manager.mutations=0;
    manager.saveState=(_file,state)=>env.calls.push([host,'saveState',{threadId:state.threadId,receipts:Object.fromEntries(Object.entries(state.submissions).map(([id,v])=>[id,v.status]))}]);
    manager.passive=async(action,options)=>{
     env.calls.push([host,'passive',action,options]);
     if(action==='threads')return {data:[{id:bound}],future:{verbatim:'保留'}};
     if(action==='history')return {data:[{id:turnId,items:[{type:'agentMessage',text:'原文\n中文',future:7}]}],totalTurns:1,nextCursor:'opaque/next'};
     return {thread:{id:options.threadId,archived:false,activity:{state:'idle'},future:{keep:true}}};
    };
    manager.remote=async(source,options)=>{
     const match=source.match(/PAYLOAD=json.loads\(base64.b64decode\('([^']+)'\)\)/);assert.ok(match);
     const payload=JSON.parse(Buffer.from(match[1],'base64').toString());env.calls.push([host,'remote',payload,options]);
     if(payload.action==='send')return {result:{result:{turn:{id:turnId}}},future:'unchanged'};
     if(payload.action==='probe')return {threadReferencesSupported:true,settings:{settings:{model:'fixture'}}};
     return {data:[{id:'fixture-automation',unknown:{text:'完整'}}],future:['原文']};
    };
   }
   const request=async(path,body,extra={})=>{
    env.calls.length=0;const response=await fetch(env.base+path,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body),headers:{'x-csrf-token':env.token}}),...extra});
    const text=await response.text();const record={status:response.status,body:text?JSON.parse(text):null,calls:structuredClone(env.calls),mutations:[...env.managers.values()].map(m=>m.mutations)};records.push(record);return record;
   };
   await request('/api/desktop/candidates?host=b&search=first&search=last&cursor=a%2Fb');
   await request('/api/automations?host=b');
   await request('/api/automations/candidates?host=b&search=first&search=last&cursor=ignored');
   await request('/api/automations/session?host=b');
   await request('/api/automations/history?host=b&threadId='+bound);
   await request('/api/automations/binding?host=b',{threadId:bound},{headers:{}});
   await request('/api/automations/binding?host=b',{threadId:bound});
   await request('/api/automations/binding?host=b',{threadId:otherThread});
   await request('/api/automations/session?host=b');
   await request('/api/automations/history?host=b&threadId='+bound+'&cursor=a%2Fb&cursor=ignored');
   await request('/api/automations/history?host=b&threadId='+otherThread);
   await request('/api/threads/'+bound+'/message?host=b',{text:'不得发送'});
   await request('/api/threads/'+bound+'/message?host=a',{text:'独立目标'});
   await request('/api/desktop/threads/'+generic+'?host=b');
   await request('/api/desktop/threads/'+generic+'/history?host=b&cursor=first&cursor=last');
   await request('/api/desktop/threads/'+generic+'/message?host=b',{threadId:otherThread,messageId,text:'中文\n原文',unknown:{keep:true}});
   await request('/api/desktop/threads/'+generic+'/message?host=b',{threadId:otherThread,messageId,text:'中文\n原文'});
   await request('/api/desktop/threads/'+generic+'/message?host=b',{messageId,text:'变更'});
   await request('/api/desktop/threads/'+generic+'/interrupt?host=b',{threadId:otherThread,turnId});
   await request('/api/desktop/threads/'+generic+'/acknowledge?host=b',{threadId:otherThread,messageId});
   await request('/api/automations/message?host=b',{threadId:bound,messageId:otherMessage,text:'原生管理消息'});
   await request('/api/desktop/threads/'+bound+'/message?host=b',{messageId:otherMessage,text:'原生管理消息'});
   await request('/api/automations/interrupt?host=b',{threadId:bound,turnId});
   await request('/api/automations/acknowledge?host=b',{threadId:bound,messageId:otherMessage});
   await request('/api/desktop/threads/'+'-'.repeat(36)+'/message?host=b');
   await request('/api/desktop/threads/'+generic+'/message?host=b');
   await request('/api/desktop/threads/'+generic+'?host=b',undefined,{method:'HEAD'});
   await request('/api/automations/session?host=unknown');
   assert.deepEqual(records.map(r=>r.status),[200,200,200,400,409,403,200,409,200,200,409,409,200,200,200,200,200,409,200,200,200,200,200,200,400,404,404,404]);
   assert.deepEqual(records[0].calls[0],['b','passive','threads',{search:'first',cursor:'a/b'}]);
   assert.deepEqual(records[2].calls[0],['b','passive','threads',{search:'first'}]);
   assert.equal(records[7].body.error.code,'DESKTOP_BINDING_FIXED');
   assert.equal(records[11].body.error.code,'DESKTOP_MANAGED');
   for(const index of [5,7,10,11,16,17,21,24,25,26,27])assert.equal(records[index].calls.length,0);
   assert.equal(records[15].calls.find(c=>c[1]==='remote'&&c[2].action==='send')[2].threadId,generic);
   assert.ok(records.every(r=>r.mutations.every(n=>n===0)));
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('desktop pending and unknown outcomes block both entries until explicitly acknowledged',async()=>{
 const threadId='00000000-0000-0000-0000-000000000011',turnId='00000000-0000-0000-0000-000000000012';
 const messageIds=[13,14,15].map(i=>'00000000-0000-0000-0000-'+String(i).padStart(12,'0')),outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),manager=env.managers.get('b'),native=[],records=[];let release,started,loseReply=false;
  const sending=new Promise(resolve=>{started=resolve;});
  manager.subscriptions=new Map();manager.mutations=0;manager.saveState=()=>{};
  manager.passive=async action=>action==='history'?{data:[]}:{thread:{id:threadId,archived:false,activity:{state:'idle'}}};
  manager.remote=async source=>{
   const payload=JSON.parse(Buffer.from(source.match(/PAYLOAD=json.loads\(base64.b64decode\('([^']+)'\)\)/)[1],'base64').toString());native.push(payload);
   if(payload.action!=='send')return {};
   if(native.filter(p=>p.action==='send').length===1){started();await new Promise(resolve=>{release=resolve;});}
   if(loseReply)throw Error('模拟回执丢失');
   return {result:{result:{turn:{id:turnId}}}};
  };
  const request=async(path,data)=>{const r=await fetch(env.base+path+'?host=b',{method:'POST',headers:{'x-csrf-token':env.token},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};};
  const desktop='/api/desktop/threads/'+threadId;
  let pending;
  try{
   pending=request(desktop+'/message',{messageId:messageIds[0],text:'首条'});await sending;
   records.push(await request('/api/threads/'+threadId+'/message',{text:'不得绕过桌面发送'}));
   records.push(await request(desktop+'/message',{messageId:messageIds[1],text:'等待时不得发送'}));
   assert.equal(manager.mutations,1);assert.equal(native.filter(p=>p.action==='send').length,1);
   release();records.push(await pending);
   loseReply=true;records.push(await request(desktop+'/message',{messageId:messageIds[1],text:'回执未知'}));
   loseReply=false;records.push(await request(desktop+'/message',{messageId:messageIds[1],text:'回执未知'}));
   records.push(await request(desktop+'/message',{messageId:messageIds[2],text:'待核对'}));
   records.push(await request(desktop+'/acknowledge',{messageId:messageIds[1]}));
   records.push(await request(desktop+'/message',{messageId:messageIds[2],text:'待核对'}));
   assert.deepEqual(records.map(r=>r.status),[409,409,200,502,409,409,200,200]);
   assert.deepEqual([records[0],records[1],records[4],records[5]].map(r=>r.body.error.code),['SEND_PENDING','SEND_PENDING','OUTCOME_UNKNOWN','SEND_PENDING']);
   assert.equal(native.filter(p=>p.action==='send').length,3);assert.equal(manager.mutations,0);
   assert.equal(env.calls.filter(c=>c[1]==='message').length,0);
   outcomes.push({records,native});
  }finally{release?.();if(pending)await pending;await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('workspace routes preserve folder, project and composer request semantics',async()=>{
 const outcomes=[],key='00000000-0000-0000-0000-000000000021';
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),records=[];let existing=false,timeout=false;
  try{
   for(const [host,manager] of env.managers){
    manager.host.home='/fixture/home';manager.generation=1;
    manager.service={protocolValidation:{features:{projectFolders:{supported:true}}}};
    manager.requireWritable=()=>{};manager.withMutation=async work=>work();
    manager.publish=(...args)=>env.calls.push([host,'publish',...args]);
    manager.rpc={connected:true,request:async(method,params,options)=>{
     env.calls.push([host,method,params,options]);
     if(method==='fs/getMetadata')return {isDirectory:true};
     if(method==='fs/readDirectory')return {entries:[{fileName:'子目录',isDirectory:true},{fileName:'file',isDirectory:false},{fileName:'..',isDirectory:true},{fileName:'bad/name',isDirectory:true}]};
     if(method==='fs/createDirectory'){if(timeout)throw Object.assign(Error('fixture timeout'),{code:'RPC_TIMEOUT'});return {ok:true};}
     if(method==='project/list')return {data:existing?[{id:'fixture-project',name:'Fixture',roots:[{path:'/fixture/project'}],unknown:7}]:[],nextCursor:null};
     if(method==='project/create')return {project:{id:'fixture-project',name:params.name,roots:params.roots,unknown:7}};
     return {data:[{name:'中文目录',unknown:{keep:true}}],future:[method]};
    }};
   }
   const request=async(path,data,auth=true)=>{
    env.calls.length=0;const r=await fetch(env.base+path,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data),headers:auth?{'x-csrf-token':env.token}:{}})});
    const record={status:r.status,body:await r.json(),calls:structuredClone(env.calls)};records.push(record);return record;
   };
   await request('/api/project-folders?host=b');
   await request('/api/project-folders?host=b&path=%2Ffixture%2F..%2Fproject%2F&path=%2Fignored');
   await request('/api/project-folders?host=b&path=relative');
   await request('/api/project-folders?host=b',{parent:'/fixture',name:'中文目录',future:1});
   await request('/api/project-folders?host=b',{parent:'/fixture',name:'../bad'});
   timeout=true;await request('/api/project-folders?host=b',{parent:'/fixture',name:'uncertain'});timeout=false;
   await request('/api/project-folders?host=b',{parent:'/fixture',name:'blocked'},false);
   await request('/api/projects/open?host=b',{path:'/fixture/project',idempotencyKey:key,unknown:{keep:true}});
   existing=true;await request('/api/projects/open?host=b',{path:'/fixture/project',idempotencyKey:key});
   await request('/api/projects/open?host=b',{path:'/fixture/project',idempotencyKey:'bad'});
   await request('/api/composer?host=b&cwd=%2Ffixture%2Fproject&kind=skills&kind=modes');
   await request('/api/composer?host=b&cwd=%2Ffixture%2Fproject&kind=skills');
   await request('/api/composer?host=b&cwd=%2Ffixture%2Fproject');
   await request('/api/composer?host=b&cwd=%2Ffixture%2Fproject&kind=invalid');
   await request('/api/composer?host=b');
   env.managers.get('b').service.protocolValidation.features.projectFolders.supported=false;
   await request('/api/project-folders?host=b');
   assert.deepEqual(records.map(r=>r.status),[200,200,400,200,400,502,403,200,200,400,200,200,200,400,400,409]);
   assert.equal(records[0].body.path,'/fixture/home');assert.deepEqual(records[0].body.entries,[{name:'子目录',path:'/fixture/home/子目录'}]);
   assert.equal(records[1].body.path,'/project');
   assert.equal(records[5].body.error.code,'OUTCOME_UNKNOWN');
   assert.equal(records[7].body.existing,false);assert.equal(records[8].body.existing,true);
   assert.equal(records[10].calls[0][1],'skills/list');assert.equal(records[11].calls.length,0);
   assert.deepEqual(records[12].calls.map(c=>c[1]),['collaborationMode/list','plugin/installed']);
   assert.ok(records.flatMap(r=>r.calls).every(c=>c[0]==='b'));
   assert.equal(env.managers.get('b').projectFolderMutation,false);
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});

test('sidebar routes preserve repeated queries, account revision guards and action failures',async()=>{
 const outcomes=[];
 for(const factory of [createApp,createFrameworkApp]){
  const env=await create(factory),records=[];let changeAccount=false;
  try{
   for(const [host,manager] of env.managers){
    manager.generation=1;manager.accountRevision=0;manager.subscriptions=new Map();manager.autoTitles=new Map();
    manager.service={protocolValidation:{policy:4,unsupportedMethods:[]}};
    manager.requireWritable=()=>{};manager.withMutation=async work=>work();manager.saveTitles=()=>{};
    manager.publish=(...args)=>env.calls.push([host,'publish',...args]);
    manager.rpc={connected:true,request:async(method,params,options)=>{env.calls.push([host,'rpc',method,params,options]);return method==='account/read'?{workspaceRouting:{chatgptAccountId:'fixture-account'}}:{ok:true,unknown:'原文'};}};
    manager.passive=async(action,params)=>{
     env.calls.push([host,'passive',action,params]);if(changeAccount)manager.accountRevision++;
     if(action==='sidebarActivity')return {data:{'qa-thread':{state:'idle',unknown:'保留'}},future:9};
     return {data:[{id:'qa-thread',revision:10,name:'旧名称'}],sections:[],accountScope:'fixture-scope',accountLayoutAvailable:true,preferences:{},unknown:{keep:true}};
    };
   }
   const request=async(path,data,auth=true)=>{
    env.calls.length=0;const r=await fetch(env.base+path,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data),headers:auth?{'x-csrf-token':env.token}:{}})});
    const record={status:r.status,body:await r.json(),calls:structuredClone(env.calls)};records.push(record);return record;
   };
   await request('/api/sidebar?host=b&search=first&search=last&activity=deferred&future=raw');
   await request('/api/sidebar/activity?host=b&ids=%5B%22ignored%22%5D&ids=%5B%22qa-thread%22%5D');
   await request('/api/sidebar/activity?host=b&ids=invalid');
   await request('/api/sidebar/activity?host=b&ids=%5B%22bad%2Fid%22%5D');
   const rename={action:'rename',id:'qa-thread',name:' 中文名称 ',accountScope:'fixture-scope',expectedRevision:10,unknown:{keep:true}};
   await request('/api/sidebar/actions?host=b',rename);
   await request('/api/sidebar/actions?host=b',{...rename,expectedRevision:9});
   await request('/api/sidebar/actions?host=b',{...rename,accountScope:'stale'});
   await request('/api/sidebar/actions?host=b',{...rename,action:'read'});
   await request('/api/sidebar/actions?host=b',{action:'unknown'});
   await request('/api/sidebar/actions?host=b',rename,false);
   changeAccount=true;await request('/api/sidebar?host=b');changeAccount=false;
   assert.deepEqual(records.map(r=>r.status),[200,200,400,400,200,409,409,409,400,403,409]);
   assert.equal(records[10].body.error.code,'ACCOUNT_CHANGED');
   assert.equal(records[0].calls.find(c=>c[1]==='passive')[3].search,'last');
   assert.equal(records[0].calls.find(c=>c[1]==='passive')[3].includeActivity,false);
   assert.deepEqual(records[1].calls.find(c=>c[1]==='passive')[3].threadIds,['qa-thread']);
   assert.deepEqual(records[4].calls.find(c=>c[2]==='thread/name/set')[3],{threadId:'qa-thread',name:'中文名称'});
   assert.deepEqual([records[5],records[6],records[7]].map(r=>r.body.error.code),['SIDEBAR_CHANGED','ACCOUNT_CHANGED','FEATURE_UNAVAILABLE']);
   for(const index of [2,3,8,9])assert.equal(records[index].calls.length,0);
   assert.equal(env.managers.get('b').sidebarMutation,false);
   outcomes.push(records);
  }finally{await env.close();}
 }
 assert.deepEqual(outcomes[1],outcomes[0]);
});
