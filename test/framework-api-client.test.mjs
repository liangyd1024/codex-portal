import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/api.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createApiClient}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(fetch,token=''){
 const events=[];const api=createApiClient({targetUrl:p=>p+(p.includes('?')?'&':'?')+'host=fixture',csrf:{get:()=>token,set:v=>{token=v;events.push('token');}},flushDrafts:()=>events.push('drafts'),reload:()=>events.push('reload'),fetch});
 return {api,events};
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('typed client preserves unknown fields, raw text and browser-clock activity timestamps',async()=>{
 let request;const before=Date.now();
 const {api}=fixture(async(path,init)=>{request={path,init};return json({thread:{activity:{observedAt:1,future:'keep'}},data:[{activity:{observedAt:2}},null],future:{text:'原文\n\n',nested:[1,2]}});});
 const result=await api('/api/threads?cursor=a',{headers:{'X-Output-Versions':'{"unknown":1}'}});
 assert.equal(request.path,'/api/threads?cursor=a&host=fixture');assert.equal(request.init.credentials,'same-origin');assert.equal(request.init.method,'GET');assert.equal(request.init.body,undefined);assert.equal(request.init.headers.Accept,'application/json');
 assert.deepEqual(result.future,{text:'原文\n\n',nested:[1,2]});assert.equal(result.thread.activity.future,'keep');for(const activity of [result.thread.activity,result.data[0].activity])assert.ok(activity.observedAt>=before&&activity.observedAt<=Date.now());
});
test('typed client reads CSRF before writes, reuses token, and preserves payload fallback',async()=>{
 const calls=[];const {api,events}=fixture(async(path,init)=>{calls.push({path,init});return path.startsWith('/api/csrf')?json({token:'sample-token'}):new Response('');});
 assert.deepEqual(await api('/api/threads',{method:'POST',body:{unknown:{keep:true},text:'中文'}}),{});
 await api('/api/threads/id/message',{method:'POST',body:null,headers:{'X-CSRF-Token':'cannot-override','Content-Type':'ignored'}});
 assert.deepEqual(calls.map(c=>c.path),['/api/csrf?host=fixture','/api/threads?host=fixture','/api/threads/id/message?host=fixture']);assert.deepEqual(events,['token']);
 assert.equal(calls[1].init.body,'{"unknown":{"keep":true},"text":"中文"}');assert.equal(calls[2].init.body,'{}');
 for(const c of calls.slice(1)){assert.equal(c.init.headers['Content-Type'],'application/json');assert.equal(c.init.headers['X-CSRF-Token'],'sample-token');}
});
test('typed client flushes drafts before pairing reload and retains native error fields',async()=>{
 const {api,events}=fixture(async()=>json({error:{message:'请先配对。',code:'PAIRING_REQUIRED',details:{unknown:['完整',7]}}},401));
 await assert.rejects(api('/api/status'),e=>{assert.equal(e.message,'请先配对。');assert.equal(e.status,401);assert.equal(e.readOnly,true);assert.equal(e.code,'PAIRING_REQUIRED');assert.deepEqual(e.details,{unknown:['完整',7]});return true;});
 assert.deepEqual(events,['drafts','reload']);
 const failure=fixture(async()=>json({message:'原生写入失败'},409),'token');await assert.rejects(failure.api('/api/write',{method:'POST'}),e=>e.message==='原生写入失败'&&e.readOnly===false&&e.status===409);
});
test('typed client preserves parse, network and read/write timeout messages without retries',async()=>{
 await assert.rejects(fixture(async()=>new Response('<html>')).api('/api/status'),{message:'服务未返回有效数据。请查看连接诊断。'});
 await assert.rejects(fixture(async()=>{throw new TypeError('offline');}).api('/api/status'),{message:'无法连接本机服务。请确认服务仍在运行。'});
 for(const method of ['GET','POST']){
  let calls=0;const {api}=fixture(async(_path,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));},'token');
  await assert.rejects(api('/api/operation',{method,timeout:5}),{message:method==='GET'?'读取超时，已有内容和草稿保留，请重试刷新。':'操作结果未确认，草稿已保留。请先核对会话记录，避免重复提交。'});assert.equal(calls,1);
 }
});
test('default client resolves current fetch for every request while explicit transport stays injected',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async()=>{calls.push('initial');return json({value:'initial'});});
 const dynamic=fixture(undefined,'token').api;
 const injected=fixture(async()=>{calls.push('injected');return json({value:'injected'});},'token').api;
 assert.equal((await dynamic('/api/status')).value,'initial');
 globalThis.fetch=async()=>{calls.push('replacement');return json({value:'replacement'});};
 assert.equal((await dynamic('/api/status')).value,'replacement');
 assert.equal((await injected('/api/status')).value,'injected');
 assert.deepEqual(calls,['initial','replacement','injected']);
});


test('concurrent writes share one pending CSRF read without merging writes',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];
 const {api,events}=fixture(async(path,init)=>{calls.push({path,init});if(path.startsWith('/api/csrf')){await gate;return json({token:'shared-token'});}return json({ok:true});});
 const first=api('/api/first',{method:'POST',body:{value:1}}),second=api('/api/second',{method:'POST',body:{value:2}});
 assert.equal(calls.length,1);assert.ok(calls[0].path.startsWith('/api/csrf'));
 release();await Promise.all([first,second]);
 assert.deepEqual(calls.map(c=>c.path),['/api/csrf?host=fixture','/api/first?host=fixture','/api/second?host=fixture']);
 assert.deepEqual(calls.slice(1).map(c=>JSON.parse(c.init.body)),[{value:1},{value:2}]);
 assert.ok(calls.slice(1).every(c=>c.init.headers['X-CSRF-Token']==='shared-token'));assert.deepEqual(events,['token','token']);
});
test('failed shared CSRF read prevents all writes and a later attempt reads again',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let reads=0,writes=0;
 const {api}=fixture(async(path)=>{if(path.startsWith('/api/csrf')){reads++;if(reads===1){await gate;return json({error:{message:'令牌读取失败'}},503);}return json({token:'retry-token'});}writes++;return json({ok:true});});
 const pending=Promise.allSettled([api('/api/first',{method:'POST'}),api('/api/second',{method:'POST'})]);
 release();const results=await pending;assert.equal(reads,1);assert.equal(writes,0);
 assert.ok(results.every(r=>r.status==='rejected'&&r.reason.message==='令牌读取失败'));
 await api('/api/retry',{method:'POST'});assert.equal(reads,2);assert.equal(writes,1);
});
test('CSRF flights do not cross client boundaries or survive token invalidation',async()=>{
 let token='',reads=0;const request=async(path)=>path.startsWith('/api/csrf')?json({token:'token-'+(++reads)}):json({ok:true});
 const options={targetUrl:p=>p,csrf:{get:()=>token,set:t=>{token=t;}},flushDrafts(){},reload(){},fetch:request};
 const a=createApiClient(options),b=fixture(request).api;
 await Promise.all([a('/api/a',{method:'POST'}),b('/api/b',{method:'POST'})]);assert.equal(reads,2);
 token='';await a('/api/c',{method:'POST'});assert.equal(reads,3);
});

test('startup token read and a concurrent write share the same pending GET',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];
 const {api}=fixture(async(path,init)=>{calls.push({path,init});if(path.startsWith('/api/csrf')){await gate;return json({token:'startup-token',unknown:'preserved'});}return json({ok:true});});
 const read=api('/api/csrf'),write=api('/api/operation',{method:'POST'});assert.equal(calls.length,1);
 release();assert.deepEqual(await read,{token:'startup-token',unknown:'preserved'});await write;
 assert.equal(calls.length,2);assert.equal(calls[1].init.headers['X-CSRF-Token'],'startup-token');
 await api('/api/csrf');assert.equal(calls.length,3,'completed token GET must not be cached');
});

test('token reads with explicit transport options do not join the default read',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];
 const {api}=fixture(async(path,init)=>{calls.push({path,init});await gate;return json({token:'token'});});
 const pending=[api('/api/csrf'),api('/api/csrf',{headers:{'X-Probe':'isolated'}}),api('/api/csrf',{timeout:1000})];
 assert.equal(calls.length,3);assert.equal(calls[1].init.headers['X-Probe'],'isolated');
 release();await Promise.all(pending);
});

test('shared CSRF read preserves the current configuration revision on every write',async()=>{
 let token='',revision='first',release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];
 const api=createApiClient({targetUrl:p=>p,configRevision:()=>revision,csrf:{get:()=>token,set:t=>{token=t;}},flushDrafts(){},reload(){},fetch:async(path,init)=>{calls.push({path,init});if(path==='/api/csrf'){await gate;return json({token:'shared'});}return json({ok:true});}});
 const pending=[api('/api/a',{method:'POST'}),api('/api/b',{method:'POST'})];
 assert.equal(calls.length,1);revision='second';release();await Promise.all(pending);
 assert.equal(calls[0].init.headers['X-RCM-Config-Revision'],undefined);
 assert.ok(calls.slice(1).every(c=>c.init.headers['X-RCM-Config-Revision']==='second'&&c.init.headers['X-CSRF-Token']==='shared'));
});

test('background suspension aborts reads but never cancels or replays a mutation',async()=>{
 const document=new EventTarget();document.hidden=false;const calls=[];
 const api=createApiClient({lifecycle:document,targetUrl:p=>p,csrf:{get:()=> 'token',set(){}},flushDrafts(){},reload(){},fetch:async(path,init)=>{calls.push(init);if(init.method==='POST')return json({ok:true});return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))));}});
 const reading=api('/api/status');const rejected=assert.rejects(reading,error=>error.code==='READ_SUSPENDED');
 document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));await rejected;
 assert.deepEqual(await api('/api/message',{method:'POST',body:{text:'保留原消息'}}),{ok:true});assert.equal(calls.length,2);assert.equal(calls[1].signal.aborted,false);
});
