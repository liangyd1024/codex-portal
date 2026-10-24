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
