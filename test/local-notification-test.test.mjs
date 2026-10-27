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
