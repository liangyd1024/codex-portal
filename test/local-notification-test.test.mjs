import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalNotificationTest} from '../src/web/services/local-notification-test.ts';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 let context={host:'host-a',selectedId:'thread-a',threads:[{id:'thread-a',name:'当前会话'},{id:'thread-c',name:'通知验收'}]},counter=0;
 const calls=[],traces=[];let saved=[];
 const registration={async showNotification(title,options){calls.push(['show',title,options]);saved=[{tag:options.tag,data:options.data}];},async getNotifications(options){calls.push(['read',options]);return saved;}};
 const dependencies={context:()=>context,prepare:async()=>{calls.push(['prepare']);return registration;},trace:(stage,target)=>traces.push({stage,...target}),uuid:()=>String(++counter)};
 const client=createLocalNotificationTest(dependencies);
 return {client,calls,traces,registration,dependencies,setContext:value=>{context=value;}};
}
test('local diagnostic shows selected current-host target and verifies same registration without remote push',async()=>{
 const f=fixture();assert.match(await f.client.test('host-a','thread-c'),/保存的目标已核对/);
 assert.deepEqual(f.calls.map(x=>x[0]),['prepare','show','read']);
 const [,title,options]=f.calls[1];assert.match(title,/本机对照 · 通知验收/);
 assert.deepEqual(options.data,{host:'host-a',threadId:'thread-c',testId:'LOCAL-1'});
 assert.equal(options.navigate,undefined);assert.equal(options.data.deliveryId,undefined);assert.equal(options.data.diagnostic,undefined);
 assert.deepEqual(f.calls[2][1],{tag:options.tag});assert.deepEqual(f.traces.map(x=>x.stage),['local-test-requested','local-test-shown','local-test-verified']);
 assert.ok(f.traces.every(x=>x.threadId==='thread-c'&&x.testId==='LOCAL-1'));
 await f.client.test('host-a','thread-c');assert.notEqual(f.calls[1][2].tag,f.calls[4][2].tag);
});
test('local target must belong to selected current connection',async()=>{
 const f=fixture();for(const args of [['host-b','thread-c'],['host-a','unknown']])assert.match(await f.client.test(...args),/不在当前连接/);assert.equal(f.calls.length,0);
});
test('local diagnostic coalesces pending clicks and skips stale host before showing',async()=>{
 const f=fixture(),wait=deferred();f.dependencies.prepare=async()=>wait.promise;
 const client=createLocalNotificationTest(f.dependencies),first=client.test('host-a','thread-c');assert.equal(first,client.test('host-a','thread-c'));
 f.setContext({host:'host-b',selectedId:'thread-c',threads:[{id:'thread-c',name:'另一连接'}]});wait.resolve(f.registration);
 assert.equal(await first,undefined);assert.equal(f.calls.length,0);
});
test('removed target is rejected after worker preparation',async()=>{
 const f=fixture(),wait=deferred();f.dependencies.prepare=()=>wait.promise;const client=createLocalNotificationTest(f.dependencies);
 const pending=client.test('host-a','thread-c');f.setContext({host:'host-a',selectedId:null,threads:[]});wait.resolve(f.registration);
 assert.match(await pending,/已不在当前连接/);assert.equal(f.calls.length,0);
});
for(const field of ['host','threadId','testId'])test('readback verifies actual saved '+field,async()=>{
 const f=fixture();f.registration.getNotifications=async()=>[{tag:f.calls[1][2].tag,data:{...f.calls[1][2].data,[field]:'wrong'}}];
 assert.match(await f.client.test('host-a','thread-c'),/未读到目标一致/);assert.equal(f.traces.at(-1).stage,'local-test-mismatch');
});
test('empty readback is not reported as successful delivery',async()=>{const f=fixture();f.registration.getNotifications=async()=>[];assert.match(await f.client.test('host-a','thread-c'),/尚不能确认/);});
for(const method of ['showNotification','getNotifications'])test(method+' rejection does not remotely send or retry',async()=>{
 const f=fixture();let count=0;f.registration[method]=async()=>{count++;throw Error('fixture failure');};
 assert.match(await f.client.test('host-a','thread-c'),/未发送远程推送/);assert.equal(count,1);assert.equal(f.traces.at(-1).stage,'local-test-failed');
});
test('host changes during readback do not publish stale result',async()=>{
 const f=fixture(),wait=deferred();f.registration.getNotifications=()=>wait.promise;const pending=f.client.test('host-a','thread-c');await new Promise(r=>setImmediate(r));
 f.setContext({host:'host-b',selectedId:null,threads:[]});wait.resolve([]);assert.equal(await pending,undefined);assert.equal(f.traces.at(-1).host,'host-a');
});
test('trace rejection does not block notification display or readback',async()=>{
 const f=fixture();f.dependencies.trace=async()=>{throw Error('trace unavailable');};const client=createLocalNotificationTest(f.dependencies);
 assert.match(await client.test('host-a','thread-c'),/保存的目标已核对/);
});
function remoteFixture(){
 const f=fixture(),testId='REMOTE-COMPARE-FIXTURE-01',tag='codex-test-'+testId;
 const values={title:'fixture title',body:'private body',tag,data:{host:'host-a',threadId:'thread-c',testId,deliveryId:'secret-delivery',token:'secret-token'},silent:false,dir:'auto',lang:'zh',icon:'',badge:'',requireInteraction:false,navigate:'',timestamp:123,renotify:false,vibrate:[],actions:[]};
 const notice=Object.create(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,undefined])));
 for(const key of Object.keys(values))Object.defineProperty(Object.getPrototypeOf(notice),key,{get:()=>values[key],configurable:true});
 let notices=[notice];f.registration.getNotifications=async(options)=>{f.calls.push(['read',options]);return options?.tag?notices.filter(x=>x.tag===options.tag):notices;};
 f.registration.showNotification=async(title,options)=>{f.calls.push(['show',title,options]);notices.push({...options,title});};
 return {...f,values,tag,testId,notice,setNotices:rows=>{notices=rows;}};
}
test('remote read is once-only, reads native getters and copies verified saved options on the same registration',async()=>{
 const f=remoteFixture();const result=await f.client.readRemote('host-a');assert.equal(result.choices[0].status,'verified');assert.equal(f.calls.filter(x=>x[0]==='read').length,1);assert.equal(f.calls.some(x=>x[0]==='show'),false);
 assert.match(await f.client.copyRemote('host-a',f.tag),/保存目标已核对/);
 assert.equal(f.calls.filter(x=>x[0]==='prepare').length,1);
 const shown=f.calls.find(x=>x[0]==='show');assert.equal(shown[1],'本机保存对照 · fixture title');assert.equal(shown[2].body,'private body');assert.equal(shown[2].silent,false);assert.equal(shown[2].timestamp,123);assert.notEqual(shown[2].tag,f.tag);
 assert.deepEqual(Object.keys(shown[2].data).sort(),['host','testId','threadId']);assert.match(shown[2].data.testId,/REMOTE-COMPARE-FIXTURE-01-COPY-/);
 assert.equal(JSON.stringify(f.traces).includes('private body'),false);assert.equal(JSON.stringify(f.traces).includes('secret'),false);
 assert.deepEqual(f.calls.filter(x=>x[0]==='read').map(x=>x[1]),[undefined,{tag:f.tag},{tag:shown[2].tag}]);
});
for(const field of ['host','threadId','testId'])test('remote tag candidate with wrong '+field+' remains visible and cannot be copied',async()=>{
 const f=remoteFixture();f.values.data[field]='wrong';const result=await f.client.readRemote('host-a');assert.equal(result.choices.length,1);assert.equal(result.choices[0].status,field==='host'?'other-host':'mismatch');assert.equal(result.choices[0].threadId,'');
 await f.client.copyRemote('host-a',f.tag);assert.equal(f.calls.some(x=>x[0]==='show'),false);assert.equal(JSON.stringify(f.traces).includes('wrong'),false);
});
test('remote missing data is mismatch, unrelated/local tags are ignored and candidates are bounded',async()=>{
 const f=remoteFixture();f.values.data=null;assert.equal((await f.client.readRemote('host-a')).choices[0].status,'mismatch');
 f.setNotices([{tag:'codex-local-123'},...Array.from({length:25},(_,i)=>({...f.notice,tag:'codex-test-REMOTE-FIXTURE-'+String(i).padStart(4,'0')}))]);assert.equal((await f.client.readRemote('host-a')).choices.length,20);
});
test('remote disappearance or changed saved data between read and copy never displays',async()=>{
 for(const disappear of [true,false]){const f=remoteFixture();await f.client.readRemote('host-a');if(disappear)f.setNotices([]);else f.values.data.threadId='thread-a';assert.match(await f.client.copyRemote('host-a',f.tag),/已不存在或保存目标改变/);assert.equal(f.calls.some(x=>x[0]==='show'),false);}
});
test('saved navigate getter is reported and excluded from legacy copy rather than silently stripped',async()=>{
 const f=remoteFixture();f.values.navigate='https://example.test/?thread=private';const r=await f.client.readRemote('host-a');assert.equal(r.choices[0].navigate,true);assert.match(await f.client.copyRemote('host-a',f.tag),/系统导航地址/);assert.equal(f.calls.some(x=>x[0]==='show'),false);assert.equal(JSON.stringify(f.traces).includes('https:'),false);
});
test('remote read failures and empty results are distinct, with no show or retry',async()=>{
 const f=remoteFixture();f.setNotices([]);assert.match((await f.client.readRemote('host-a')).message,/不能证明/);f.registration.getNotifications=async()=>{throw Error('fixture');};assert.match((await f.client.readRemote('host-a')).message,/读取未完成/);assert.equal(f.calls.some(x=>x[0]==='show'),false);
});
test('host change during remote read drops snapshot and result',async()=>{
 const f=remoteFixture(),wait=deferred();f.registration.getNotifications=()=>wait.promise;const p=f.client.readRemote('host-a');assert.equal(p,f.client.readRemote('host-a'));await new Promise(r=>setImmediate(r));f.setContext({host:'host-b',selectedId:null,threads:[]});wait.resolve([f.notice]);assert.equal(await p,undefined);await f.client.copyRemote('host-b',f.tag);assert.equal(f.calls.some(x=>x[0]==='show'),false);
});
test('copy rejection and readback mismatch never remotely send or retry',async()=>{
 const f=remoteFixture();await f.client.readRemote('host-a');f.registration.showNotification=async()=>{throw Error('fixture');};assert.match(await f.client.copyRemote('host-a',f.tag),/没有远程补发/);
 const g=remoteFixture();await g.client.readRemote('host-a');g.registration.showNotification=async()=>{};assert.match(await g.client.copyRemote('host-a',g.tag),/保存目标未核实/);
});
