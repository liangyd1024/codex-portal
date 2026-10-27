import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/push-subscription.ts',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function fixture(error){
 const listeners=new Set();let sent=0,updates=0;const bodies=[];
 class Channel{constructor(){this.port1={close(){},onmessage:null};this.port2={postMessage:data=>this.port1.onmessage?.({data})};}}
 const registration={update:async()=>{updates++;},active:{state:'activated',postMessage:(_message,ports)=>ports[0].postMessage({version:5})},pushManager:{getSubscription:async()=>({endpoint:'https://web.push.apple.com/test'})}};
 const context={NOTIFICATION_WORKER_VERSION:5,URL,prepareNotificationWorker:async()=>registration,MessageChannel:Channel,crypto:{randomUUID:()=> 'fixture-test-123456'},navigator:{serviceWorker:{addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn)}},setTimeout,clearTimeout,api:async(_path,options)=>{sent++;bodies.push(options.body);for(const fn of listeners)fn({data:{type:'rcm-push-receipt',testId:options.body.testId,error}});}};
 vm.runInNewContext(code+'\nglobalThis.client=createPushSubscription({api,threadId:()=>globalThis.selectedThread});',context);
 return {client:context.client,listeners,bodies,select:id=>{context.selectedThread=id;},counts:()=>({sent,updates})};
}
test('test waits for matching device handling and coalesces repeated clicks',async()=>{const f=fixture();const a=f.client.test(),b=f.client.test();assert.equal(a,b);assert.match(await a,/手机已处理/);assert.deepEqual(f.counts(),{sent:1,updates:0});assert.equal(f.listeners.size,0);});
test('test exposes device display rejection rather than reporting successful submission',async()=>{const f=fixture('permission denied');assert.match(await f.client.test(),/系统显示失败：permission denied/);assert.equal(f.listeners.size,0);});

test('test notification captures the selected thread before asynchronous worker setup',async()=>{const f=fixture();f.select('thread-a');const pending=f.client.test();f.select('thread-b');await pending;assert.equal(f.bodies[0].threadId,'thread-a');});

test('normal subscription sync records the actual active receiver version without sending a test',async()=>{
 const requests=[],subscription={endpoint:'https://web.push.apple.com/fixture',toJSON:()=>({endpoint:'https://web.push.apple.com/fixture'})};
 const registration={active:{postMessage:(_data,ports)=>ports[0].postMessage({version:3})},pushManager:{getSubscription:async()=>subscription}};
 const context={NOTIFICATION_WORKER_VERSION:5,URL,prepareNotificationWorker:async()=>registration,MessageChannel,setTimeout,clearTimeout,Uint8Array,atob,navigator:{serviceWorker:{}},window:{PushManager:{}},document:{visibilityState:'visible'},api:async(path,options)=>{requests.push({path,body:options?.body});return {publicKey:'YQ'};}};
 vm.runInNewContext(code+'\nglobalThis.client=createPushSubscription({api});',context);
 await context.client.setEnabled(true);
 for(let i=0;i<20&&!requests.some(x=>x.path==='/api/push/trace');i++)await new Promise(resolve=>setTimeout(resolve,5));
 const trace=requests.find(x=>x.path==='/api/push/trace');assert.equal(trace.body.version,'worker-3');assert.equal(trace.body.stage,'page-receiver');assert.equal(context.client.active(),true);
 assert.equal(requests.some(x=>x.path==='/api/push/test'),false);
});

test('receiver refresh keeps existing push delivery ownership and avoids enabling duplicate local notifications',async()=>{
 let release,calls=0;const subscription={endpoint:'https://web.push.apple.com/fixture',toJSON:()=>({endpoint:'https://web.push.apple.com/fixture'})};
 const registration={active:{postMessage:(_data,ports)=>ports[0].postMessage({version:5})},pushManager:{getSubscription:async()=>subscription}};
 const context={NOTIFICATION_WORKER_VERSION:5,URL,prepareNotificationWorker:async()=>{if(calls++)await new Promise(resolve=>release=resolve);return registration;},MessageChannel,setTimeout,clearTimeout,Uint8Array,atob,navigator:{serviceWorker:{}},window:{PushManager:{}},document:{visibilityState:'visible'},api:async()=>({publicKey:'YQ'})};
 vm.runInNewContext(code+'\nglobalThis.client=createPushSubscription({api});',context);
 await context.client.setEnabled(true);const refresh=context.client.setEnabled(true);
 assert.equal(context.client.active(),true);release();await refresh;assert.equal(context.client.active(),true);
});

test('Apple receiver migration renews its subscription once after activation and preserves retry on server failure',async()=>{
 const calls=[],values=new Map();let old=true,fail=true;
 const subscription=()=>({endpoint:'https://web.push.apple.com/'+(old?'old':'new'),toJSON(){return {endpoint:this.endpoint};},unsubscribe:async()=>{calls.push('unsubscribe');old=false;return true;}});
 const registration={active:{postMessage:(_data,ports)=>ports[0].postMessage({version:5})},pushManager:{getSubscription:async()=>subscription(),subscribe:async()=>{calls.push('subscribe');return subscription();}}};
 const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const context={NOTIFICATION_WORKER_VERSION:5,URL,prepareNotificationWorker:async()=>{calls.push('verified');return registration;},MessageChannel,setTimeout,clearTimeout,Uint8Array,atob,navigator:{serviceWorker:{}},window:{PushManager:{},localStorage:storage},document:{visibilityState:'visible'},api:async(path,options)=>{if(path==='/api/push/subscribe'){calls.push('save');if(fail)throw Error('offline');assert.match(options.body.subscription.endpoint,/new$/);}return {publicKey:'YQ'};}};
 vm.runInNewContext(code+'\nglobalThis.client=createPushSubscription({api});',context);
 await assert.rejects(context.client.setEnabled(true),/offline/);assert.equal(values.get('rcm.push-binding-version'),'5');assert.equal(context.client.active(),false);
 fail=false;await context.client.setEnabled(true);assert.equal(values.get('rcm.push-binding-version'),'5');
 const count=calls.filter(x=>x==='unsubscribe').length;assert.equal(count,1);await context.client.setEnabled(true);assert.equal(calls.filter(x=>x==='unsubscribe').length,count);assert.equal(calls[0],'verified');
 assert.deepEqual(calls.slice(0,4),['verified','unsubscribe','subscribe','save']);
});

test('receiver diagnostics reuse the subscription binding across worker releases and upload the local journal in one request',async()=>{
 const requests=[],messages=[];
 const subscription={endpoint:'https://web.push.apple.com/fixture',toJSON(){return {endpoint:this.endpoint};},unsubscribe(){throw Error('must not rotate');}};
 const registration={active:{postMessage:(data,ports)=>{messages.push(data.type);ports[0].postMessage({version:6,journal:[{stage:'worker-click',at:123,threadId:'other'}],capabilities:'push=true, click=true, storage=available'});}},pushManager:{getSubscription:async()=>subscription,subscribe(){throw Error('must not resubscribe');}}};
 const context={URL,prepareNotificationWorker:async()=>registration,MessageChannel,setTimeout,clearTimeout,Uint8Array,atob,navigator:{userAgent:'Fixture iPhone',serviceWorker:{}},window:{PushManager:{},localStorage:{getItem:()=> '5',setItem(){}}},document:{visibilityState:'visible'},api:async(path,options)=>{requests.push({path,body:options?.body});return {publicKey:'YQ'};}};
 vm.runInNewContext(code+'\nglobalThis.client=createPushSubscription({api});',context);
 await context.client.setEnabled(true);
 for(let i=0;i<20&&!requests.some(x=>x.path==='/api/push/trace');i++)await new Promise(resolve=>setTimeout(resolve,5));
 const traces=requests.filter(x=>x.path==='/api/push/trace');assert.equal(traces.length,1);assert.deepEqual(messages,['rcm-push-diagnostics']);
 assert.equal(traces[0].body.version,'worker-6');assert.equal(traces[0].body.journal[0].threadId,'other');assert.equal(traces[0].body.userAgent,'Fixture iPhone');
});
