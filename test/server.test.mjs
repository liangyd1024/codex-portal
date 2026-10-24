import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import { createApp as createRealApp } from '../server.mjs';
import { AppError } from '../lib/manager.mjs';

function createApp({manager=new FakeManager(),localManager}={}) {
 const managers=new Map([['remote-b',manager],...(localManager?[['local',localManager]]:[])]);
 return createRealApp({config:{defaultConnection:'remote-b',connections:[]},managers,
  updater:{status:async()=>({}),subscribe:()=>()=>{}}});
}

class FakeManager extends EventEmitter {
  calls = [];
  models = [{ model: 'fake' }];
  projects = [];
  status() { return { connection: { state: 'connected' }, controlledThreads: [], pendingRequests: [] }; }
  requireConnected() {}
  refreshCatalog(kind) { this.calls.push(['refreshCatalog', kind]); return this[kind]; }
  connect() { this.calls.push(['connect']); return this.status(); }
  disconnect() { this.calls.push(['disconnect']); return this.status(); }
  release() { this.calls.push(['release']); return this.status(); }
  threads(params) { this.calls.push(['threads', params]); return { data: [], nextCursor: null }; }
  detail(id) { this.calls.push(['detail', id]); return { thread: { id }, controlled: false }; }
  history(id, cursor) { this.calls.push(['history', id, cursor]); return { data: [], nextCursor: null }; }
  takeover(id) { this.calls.push(['takeover', id]); return { thread: { id }, controlled: true }; }
  message(id, data) { this.calls.push(['message', id, data]); return { received: data }; }
  steer(id, data) { this.calls.push(['steer', id, data]); return {}; }
  interrupt(id) { this.calls.push(['interrupt', id]); return {}; }
  newThread(data) { this.calls.push(['newThread', data]); return { thread: { id: 'new' } }; }
  respond(key, data) { this.calls.push(['respond', key, data]); return { resolved: true }; }
}

async function fixture(t) {
  const manager = new FakeManager();
  const { server } = createApp({ manager });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const port = server.address().port;
  const request = (path, { method = 'GET', headers = {}, body, chunks } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, agent: false, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(data).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (chunks) {
      const write = (index) => {
        if (index === chunks.length) { req.end(); return; }
        req.write(chunks[index]);
        setTimeout(() => write(index + 1), 15);
      };
      write(0);
    } else req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
  const csrf = (await request('/api/csrf')).json.token;
  return { manager, request, csrf, port };
}

test('explicit catalog refresh awaits fresh target data', async t => {
  const {manager,request} = await fixture(t);
  manager.refreshCatalog = async kind => [{id:`fresh-${kind}`}];
  for (const kind of ['projects','models']) {
    const response = await request(`/api/${kind}?refresh=1`);
    assert.equal(response.status,200);
    assert.deepEqual(response.json.data,[{id:`fresh-${kind}`}]);
  }
  manager.refreshCatalog = async () => {throw new Error('target unavailable');};
  assert.equal((await request('/api/projects')).status,502);
});

test('mutating routes require the current CSRF token before invoking the manager', async (t) => {
  const { manager, request, csrf, port } = await fixture(t);
  assert.equal((await request('/api/connect', { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/api/connect', { method: 'POST', headers: { 'X-CSRF-Token': '0'.repeat(64) }, body: {} })).status, 403);
  assert.deepEqual(manager.calls, []);
  const accepted = await request('/api/connect', { method: 'POST', headers: { 'X-CSRF-Token': csrf, Origin: `http://127.0.0.1:${port}` }, body: {} });
  assert.equal(accepted.status, 202);
  assert.deepEqual(manager.calls, [['connect']]);
});

test('connect acknowledges immediately while the operation runs and reports failure through status',async(t)=>{
  const {manager,request,csrf}=await fixture(t);let fail;
  let state={state:'disconnected'};manager.status=()=>({connection:state});
  manager.connect=()=>{state={state:'connecting'};return new Promise((_,reject)=>{fail=reject;}).catch(error=>{state={state:'error',error:error.message};throw error;});};
  const response=await request('/api/connect',{method:'POST',headers:{'X-CSRF-Token':csrf},body:{}});
  assert.equal(response.status,202);assert.equal(response.json.connection.state,'connecting');
  fail(new Error('protocol not compatible'));
  const status=await request('/api/status');assert.equal(status.json.connection.state,'error');assert.equal(status.json.connection.error,'protocol not compatible');
});

test('Host and Origin checks reject rebinding and cross-site token reads', async (t) => {
  const { manager, request, csrf, port } = await fixture(t);
  assert.equal((await request('/api/csrf', { headers: { Host: `attacker.example:${port}` } })).status, 403);
  assert.equal((await request('/api/csrf', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/connect', { method: 'POST', headers: { 'X-CSRF-Token': csrf, Origin: 'null' }, body: {} })).status, 403);
  assert.equal((await request('/api/status', { headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}` } })).status, 200);
  assert.deepEqual(manager.calls, []);
});

test('non-ASCII CSRF input is rejected as forbidden without a timingSafeEqual exception', async (t) => {
  const { manager, request } = await fixture(t);
  const response = await request('/api/connect', { method: 'POST', headers: { 'X-CSRF-Token': 'é'.repeat(64) }, body: {} });
  assert.equal(response.status, 403);
  assert.equal(response.json.error.code, 'CSRF');
  assert.deepEqual(manager.calls, []);
});

test('GET detail stays read-only and mutation errors retain status, code, and details', async (t) => {
  const { manager, request, csrf } = await fixture(t);
  const detail = await request('/api/threads/original');
  assert.equal(detail.status, 200);
  assert.deepEqual(manager.calls, [['detail', 'original']]);
  manager.takeover = async () => { throw new AppError('Original writer is active', 409, 'WRITER_CONFLICT', [{ threadId: 'original' }]); };
  const failed = await request('/api/threads/original/takeover', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: {} });
  assert.equal(failed.status, 409);
  assert.equal(failed.json.error.code, 'WRITER_CONFLICT');
  assert.deepEqual(failed.json.error.details, [{ threadId: 'original' }]);
});

test('malformed JSON is rejected before sending a message', async (t) => {
  const { manager, request, csrf } = await fixture(t);
  const failed = await request('/api/threads/original/message', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: '{invalid' });
  assert.equal(failed.status, 400);
  assert.deepEqual(manager.calls, []);
});

test('UTF-8 message characters survive HTTP chunk boundaries', async (t) => {
  const { manager, request, csrf } = await fixture(t);
  const payload = Buffer.from(JSON.stringify({ text: '你好，继续' }), 'utf8');
  const split = payload.indexOf(Buffer.from('你')) + 1;
  const response = await request('/api/threads/original/message', {
    method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, chunks: [payload.subarray(0, split), payload.subarray(split)],
  });
  assert.equal(response.status, 200);
  assert.equal(manager.calls[0][2].text, '你好，继续');
  assert.equal(response.json.received.text, '你好，继续');
});

test('approval keys are decoded once and never converted into numeric ids by HTTP routing', async (t) => {
  const { manager, request, csrf } = await fixture(t);
  const key = 'request:string:7';
  const response = await request(`/api/requests/${encodeURIComponent(key)}/respond`, {
    method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: { decision: 'decline' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(manager.calls, [['respond', key, { decision: 'decline' }]]);
});

test('local responses disable sniffing and cross-origin framing', async (t) => {
  const { request } = await fixture(t);
  const response = await request('/api/status');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('connection routing isolates local actions from remote actions',async t=>{
 const remote=new FakeManager(),local=new FakeManager();
 const {server}=createApp({manager:remote,localManager:local});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const {token}=await (await fetch(base+'/api/csrf')).json();
 await fetch(base+'/api/threads/local-test/message?host=local',{method:'POST',headers:{'X-CSRF-Token':token},body:JSON.stringify({text:'local only'})});
 assert.deepEqual(local.calls,[['message','local-test',{text:'local only'}]]);assert.deepEqual(remote.calls,[]);
 await fetch(base+'/api/threads/remote-test/message?host=remote-b',{method:'POST',headers:{'X-CSRF-Token':token},body:JSON.stringify({text:'remote only'})});
 assert.deepEqual(remote.calls,[['message','remote-test',{text:'remote only'}]]);
 assert.equal((await fetch(base+'/api/status?host=unknown')).status,404);
});

test('event streams receive only their selected connection events',async t=>{
 const remote=new FakeManager(),local=new FakeManager();const {server}=createApp({manager:remote,localManager:local});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/events?host=local`,{signal:AbortSignal.timeout(3000)});
 const reader=response.body.getReader();await reader.read();
 remote.emit('event',{method:'remote-only',params:{}});local.emit('event',{method:'local-only',params:{}});
 // SSE frames and TCP chunks have independent boundaries; initial updates can arrive later.
 let text='';const decoder=new TextDecoder();
 while(!text.includes('local-only')){const chunk=await reader.read();assert.equal(chunk.done,false);text+=decoder.decode(chunk.value,{stream:true});}
 assert.ok(!text.includes('remote-only'));await reader.cancel();
});

test('model catalog returns cached host data without waiting for a stalled refresh',async t=>{
 const {manager,request}=await fixture(t);
 manager.refreshCatalog=()=>new Promise(()=>{});
 const response=await request('/api/models');
 assert.equal(response.status,200);assert.deepEqual(response.json.data,manager.models);
});

test('new browser stream receives pending questions without replaying historical notices', async t => {
  const {manager,port}=await fixture(t);
  manager.replayNotices=()=>[{method:'manager/taskNotice',params:{key:'saved',event:{method:'turn/completed',params:{threadId:'t',turn:{id:'f',status:'failed'}}}}}];
  manager.status=()=>({connection:{state:'connected'},subscribedThreads:['t'],pendingRequests:[{id:7,threadId:'t',kind:'question'}]});
  const text=await new Promise((resolve,reject)=>{
    const req=http.get(`http://127.0.0.1:${port}/api/events`,res=>{let body='';res.on('data',chunk=>{body+=chunk;if(body.includes('manager/request')){resolve(body);res.destroy();}});});req.on('error',reject);
  });
  const events=text.trim().split('\n\n').map(line=>JSON.parse(line.slice(6)));
  assert.deepEqual(events.map(e=>e.method),['manager/status','manager/request']);
});
test('large JSON uses negotiated gzip and preserves exact Unicode bytes',async t=>{
 const {gunzipSync}=await import('node:zlib');
 const {manager,port}=await fixture(t);const expected={thread:{id:'large'},output:'首段😀\n'+'repeat\n'.repeat(30000)+'末尾\n'};
 manager.detail=()=>expected;
 const get=encoding=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'/api/threads/large',headers:{'Accept-Encoding':encoding}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({headers:res.headers,bytes:Buffer.concat(chunks)}));}).on('error',reject));
 const packed=await get('gzip, deflate');assert.equal(packed.headers['content-encoding'],'gzip');assert.deepEqual(JSON.parse(gunzipSync(packed.bytes)),expected);assert.ok(packed.bytes.length<20000);
 const raw=await get('gzip;q=0');assert.equal(raw.headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(raw.bytes),expected);
});


test('built browser module graph is served as JavaScript without missing imports', async t => {
  const {readFile,readdir}=await import('node:fs/promises');
  const path=await import('node:path');
  const {pathToFileURL}=await import('node:url');
  const manifest=JSON.parse(await readFile(new URL('../.framework-build/latest.json',import.meta.url),'utf8'));
  const {createFrameworkApp}=await import(pathToFileURL(path.join(manifest.output,'server/application.mjs')));
  const staticRoot=path.join(manifest.output,'public'),extraAssets={};
  async function assets(directory,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const relative=prefix+entry.name;
      if(entry.isDirectory())await assets(path.join(directory,entry.name),relative+'/');
      else extraAssets['/'+relative]=relative;
    }
  }
  await assets(staticRoot);
  const app=await createFrameworkApp({config:{defaultConnection:'remote-b',connections:[]},managers:new Map([['remote-b',new FakeManager()]]),staticRoot,extraAssets,
    updater:{status:async()=>({}),subscribe:()=>()=>{}}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));


  t.after(()=>app.close());
  const request=async url=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+url);return {status:r.status,headers:Object.fromEntries(r.headers),text:await r.text()};};
  const pending = ['/bootstrap.js'], visited = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url)) continue;
    visited.add(url);
    const response = await request(url);
    assert.equal(response.status,200,`module ${url} must be reachable`);
    assert.match(response.headers['content-type'],/javascript/,`module ${url} must have JavaScript MIME type`);
    const imports = response.text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'`]([^"'`]+)["'`]/g);
    for (const [,specifier] of imports) {
      if (specifier.startsWith('.')) pending.push(new URL(specifier,'http://localhost'+url).pathname);
    }
  }
  assert.ok(visited.has('/framework.js'));
  assert.ok([...visited].some(url=>url.startsWith('/chunks/app-')));
});

test('Mermaid assets are explicit, local, and isolated from workbench CSP',async t=>{
 const {request}=await fixture(t);
 const main=await request('/');
 const frame=await request('/mermaid-frame.html');
 assert.equal(frame.status,200);
 assert.match(frame.headers['content-security-policy'],/sandbox allow-scripts/);
 assert.match(frame.headers['content-security-policy'],/default-src 'none'/);
 assert.doesNotMatch(frame.headers['content-security-policy'],/allow-same-origin/);
 assert.doesNotMatch(main.headers['content-security-policy'],/unsafe-inline/);
 for(const asset of ['/mermaid-view.js','/mermaid-frame.js','/vendor/mermaid-12.2.0.js'])assert.equal((await request(asset)).status,200);
 assert.equal((await request('/vendor/README.md')).status,404);
});

test('directory and deferred tool reads are scoped to the selected target and item',async t=>{
 const {manager,request}=await fixture(t);const calls=[];
 manager.turnDirectory=id=>{calls.push(['directory',id]);return {data:[]};};
 manager.toolItem=(id,item)=>{calls.push(['item',id,item]);return {item:{id:item}};};
 manager.history=(...args)=>{calls.push(['history',...args]);return {data:[]};};
 assert.equal((await request('/api/threads/sample/turn-directory')).status,200);
 assert.equal((await request('/api/threads/sample/items/tool/detail')).status,200);
 assert.equal((await request('/api/threads/sample/history?cursor=db%3A3&lazyTools=1')).status,200);
 assert.deepEqual(calls[0],['directory','sample']);assert.deepEqual(calls[1],['item','sample','tool']);
 assert.equal(calls[2].at(-1),true);assert.equal(calls[2][2],'db:3');
});
