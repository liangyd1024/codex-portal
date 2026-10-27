import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {MessageChannel} from 'node:worker_threads';
const source=readFileSync(new URL('../public/notification-worker.js',import.meta.url),'utf8');
const pause=()=>new Promise(r=>setTimeout(r,35));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const data={host:'local',threadId:'target',deliveryId:'00000000-0000-4000-8000-000000000001'};
function boot({show=async()=>{},open=async()=>null,clients=[],lookup,report=async()=>({ok:true}),cacheFailure=false,navigator}={}){
 const handlers={},requests=[],urls=[],saved=new Map();
 const caches={open:async name=>({put:async(k,v)=>{if(cacheFailure)throw Error('cache denied');saved.set(name+k,await v.text());},match:async k=>{if(cacheFailure)throw Error('cache denied');return saved.has(name+k)?new Response(saved.get(name+k)):undefined;},delete:async k=>{if(cacheFailure)throw Error('cache denied');return saved.delete(name+k);}})};
 const fetch=async(url,options)=>{requests.push({url,options});if(url==='/api/csrf')return {ok:true,json:async()=>({token:'fixture-token'})};if(url==='/api/connections')return {ok:true,json:async()=>({configRevision:'fixture-revision',defaultConnection:'local'})};if(url.startsWith('/api/push/delivery-failure'))return report(url,options);return {ok:true};};
 vm.runInNewContext(source,{URL,Response,crypto,AbortController,AbortSignal,TextEncoder,MessageChannel,caches,fetch,navigator,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,15)),clearTimeout,self:{location:{origin:'https://portal.test'},addEventListener:(n,fn)=>handlers[n]=fn,registration:{showNotification:show},clients:{matchAll:lookup||(async()=>clients),openWindow:async url=>{urls.push(url);return open(url);}}}});
 function event(name,value){const work=[];handlers[name]({...value,waitUntil:p=>work.push(Promise.resolve(p).then(()=>null,e=>e))});return {settle:async()=>{const errors=[];for(let i=0;i<work.length;i++){const e=await work[i];if(e)errors.push(e);}return errors;}};}
 return {requests,urls,saved,event,failures:()=>requests.filter(r=>r.url.startsWith('/api/push/delivery-failure')),push:(value=data,native=false)=>event('push',native?{notification:{title:'notice',navigate:'https://portal.test/',data:value}}:{data:{json:()=>({title:'notice',data:value})}}),click:(value=data,close=()=>{})=>event('notificationclick',{notification:{data:value,close}}),ready:async()=>{let value;await event('message',{data:{type:'rcm-notification-ready'},source:{postMessage:v=>value=v}}).settle();return value;}};
}
test('successful push and navigation never request fallback; delivery ID is not added to traces',async()=>{
 const w=boot();await w.push().settle();assert.equal(w.failures().length,0);await w.click().settle();assert.equal(w.failures().length,0);assert.ok(w.urls[0].includes('thread=target'));assert.ok(w.requests.filter(r=>r.url.startsWith('/api/push/trace')).every(r=>!r.options.body.includes(data.deliveryId)));
});
test('only explicit legacy show rejection reports the reference with credentials and fixed stage once',async()=>{
 for(const native of [false,true])for(const identified of [false,true]){
  const w=boot({show:async()=>{throw Error('display rejected');}});await w.push(identified?data:{host:'local',threadId:'target'},native).settle();
  assert.equal(w.failures().length,!native&&identified?1:0);
  if(w.failures().length){const r=w.failures()[0];assert.deepEqual(JSON.parse(r.options.body),{deliveryId:data.deliveryId,stage:'show'});assert.equal(r.options.headers['X-CSRF-Token'],'fixture-token');assert.equal(r.options.headers['X-RCM-Config-Revision'],'fixture-revision');assert.equal(r.url,'/api/push/delivery-failure?host=local');}
 }
});
test('failed or timed out failure report is never retried and does not prevent the original show error settling',async()=>{
 for(const report of [async()=>({ok:false}),async()=>{throw Error('offline');},()=>new Promise(()=>{})]){
  const w=boot({show:async()=>{throw Error('denied');},report});const errors=await w.push().settle();assert.ok(errors.length);await pause();assert.equal(w.failures().length,1);
 }
});
test('hanging show, hanging navigation, unclicked push and explicit timeout never trigger fallback',async()=>{
 const show=deferred(),w=boot({show:()=>show.promise});const pending=w.push();await pause();assert.equal(w.failures().length,0);show.resolve();await pending.settle();assert.equal(w.failures().length,0);
 const open=deferred(),v=boot({open:()=>open.promise});const click=v.click();await pause();assert.equal(v.failures().length,0);open.resolve(null);await click.settle();assert.equal(v.failures().length,0);
 for(const name of ['TimeoutError','AbortError']){const q=boot({open:async()=>{throw Object.assign(Error('timeout'),{name});}});await q.click().settle();assert.equal(q.failures().length,0);}
});
test('final openWindow rejection reports once, but intermediate lookup/navigation errors followed by success do not',async()=>{
 const client={url:'https://portal.test/',focused:true,postMessage(){},focus:async()=>{},navigate:async()=>{throw Error('navigate denied');}};
 const w=boot({clients:[client],open:async()=>{throw Error('open denied');}});await w.click().settle();assert.equal(w.failures().length,1);assert.equal(JSON.parse(w.failures()[0].options.body).stage,'click');assert.equal(await w.ready(),undefined);
 for(const lookup of [undefined,async()=>{throw Error('lookup denied');}]){const v=boot({clients:[client],lookup,open:async()=>null});await v.click().settle();assert.equal(v.failures().length,0);assert.equal(v.urls.length,1);}
});
test('successful openWindow with postMessage failure or close failure never reports navigation failure',async()=>{
 const w=boot({open:async()=>({postMessage(){throw Error('relay denied');}})});await w.click(data,()=>{throw Error('close denied');}).settle();assert.equal(w.urls.length,1);assert.ok(w.urls[0].includes('thread=target'));assert.equal(w.failures().length,0);
});
test('old late rejected navigation cannot report fallback or clear a newer click intent',async()=>{
 const first=deferred();let count=0;const w=boot({open:()=>++count===1?first.promise:Promise.resolve(null)});
 const old=w.click();await pause();await w.click({...data,threadId:'newer',deliveryId:'00000000-0000-4000-8000-000000000002'}).settle();first.reject(Error('old denied'));await old.settle();assert.equal(w.failures().length,0);assert.equal((await w.ready()).threadId,'newer');
});
test('failed intent cleanup tolerates unavailable storage; a basic fallback click clears only worker intent and opens home',async()=>{
 const denied=boot({cacheFailure:true,open:async()=>{throw Error('denied');}});await denied.click().settle();assert.equal(denied.failures().length,1);assert.equal(await denied.ready(),undefined);
 const w=boot();await w.click().settle();assert.equal((await w.ready()).threadId,'target');await w.click({host:'local'}).settle();assert.equal(await w.ready(),undefined);assert.equal(w.urls.at(-1),'https://portal.test/?host=local');assert.equal(w.failures().length,0);
});

test('explicit NetworkError and known offline state never request fallback for show or click failures',async()=>{
 for(const kind of ['show','click'])for(const offline of [false,true]){
  const error=Object.assign(Error('unavailable'),{name:offline?'Error':'NetworkError'});
  const w=boot({navigator:offline?{onLine:false}:undefined,show:async()=>{if(kind==='show')throw error;},open:async()=>{throw error;}});
  await (kind==='show'?w.push():w.click()).settle();assert.equal(w.failures().length,0);
 }
});
