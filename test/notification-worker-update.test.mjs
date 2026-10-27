import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {prepareNotificationWorker,NOTIFICATION_WORKER_VERSION} from '../public/notification-platform.js';
function receiver(version,state='activated'){
 const worker=new EventTarget();worker.state=state;
 worker.postMessage=(_data,ports)=>ports[0].postMessage({version});
 worker.change=value=>{worker.state=value;worker.dispatchEvent(new Event('statechange'));};return worker;
}
test('upgrade waits for new activation instead of returning the already-ready old receiver',async()=>{
 const old=receiver(2),latest=receiver(NOTIFICATION_WORKER_VERSION,'installing'),calls=[];
 const registration={active:old,installing:latest};
 const nav={serviceWorker:{ready:Promise.resolve({active:old}),register:async(...args)=>{calls.push(args);return registration;}}};
 let resolved=false;const result=prepareNotificationWorker(nav).then(value=>{resolved=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(resolved,false);
 registration.installing=null;registration.active=latest;latest.change('activated');
 assert.equal(await result,registration);assert.equal(calls[0][0],'/notification-worker.js?v='+NOTIFICATION_WORKER_VERSION);assert.deepEqual(calls[0][1],{scope:'/',updateViaCache:'none'});
});
test('mismatched active receiver forces an update and does not claim success until the new version answers',async()=>{
 const old=receiver(2),latest=receiver(NOTIFICATION_WORKER_VERSION);let updates=0;
 const registration={active:old,update:async()=>{updates++;registration.active=latest;}};
 assert.equal(await prepareNotificationWorker({serviceWorker:{register:async()=>registration}}),registration);assert.equal(updates,1);
});
test('failed upgrade rejects obsolete receiver instead of using it for notifications',async()=>{
 let updates=0;const registration={active:receiver(2),update:async()=>{updates++;}};
 await assert.rejects(prepareNotificationWorker({serviceWorker:{register:async()=>registration}}),/仍是旧版本/);assert.equal(updates,1);
});
test('simultaneous setup shares one registration and a failed setup can be retried',async()=>{
 let calls=0,fail=true;const nav={serviceWorker:{register:async()=>{calls++;if(fail)throw Error('offline');return {active:receiver(NOTIFICATION_WORKER_VERSION)};}}};
 const first=prepareNotificationWorker(nav);assert.equal(first,prepareNotificationWorker(nav));await assert.rejects(first,/offline/);
 fail=false;await prepareNotificationWorker(nav);assert.equal(calls,2);
});
test('redundant installation fails immediately and removes lifecycle listeners',async()=>{
 const worker=receiver(NOTIFICATION_WORKER_VERSION,'installing'),nav={serviceWorker:{register:async()=>({installing:worker})}};
 const result=prepareNotificationWorker(nav);await new Promise(resolve=>setImmediate(resolve));worker.change('redundant');await assert.rejects(result,/更新失败/);
});
test('hung registration and unresponsive receiver are bounded without leaking message ports',async()=>{
 const source=(await readFile(new URL('../public/notification-platform.js',import.meta.url),'utf8')).replaceAll('export ','');
 for(const registration of [null,{active:{state:'activated',postMessage(){}}}]){
  const context={WeakMap,AbortController,MessageChannel,clearTimeout,setTimeout:(fn)=>setTimeout(fn,20)};
  vm.runInNewContext(source+'\nglobalThis.runSetup=prepareNotificationWorker;',context);
  await assert.rejects(context.runSetup({serviceWorker:{register:()=>registration?Promise.resolve(registration):new Promise(()=>{})}}),/更新超时|无响应/);
 }
});
