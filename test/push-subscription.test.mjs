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
 const registration={update:async()=>{updates++;},active:{state:'activated',postMessage:(_message,ports)=>ports[0].postMessage({version:4})},pushManager:{getSubscription:async()=>({endpoint:'https://web.push.apple.com/test'})}};
 const context={prepareNotificationWorker:async()=>registration,MessageChannel:Channel,crypto:{randomUUID:()=> 'fixture-test-123456'},navigator:{serviceWorker:{addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn)}},setTimeout,clearTimeout,api:async(_path,options)=>{sent++;bodies.push(options.body);for(const fn of listeners)fn({data:{type:'rcm-push-receipt',testId:options.body.testId,error}});}};
 vm.runInNewContext(code+'\nglobalThis.client=createPushSubscription({api,threadId:()=>globalThis.selectedThread});',context);
 return {client:context.client,listeners,bodies,select:id=>{context.selectedThread=id;},counts:()=>({sent,updates})};
}
test('test waits for matching device handling and coalesces repeated clicks',async()=>{const f=fixture();const a=f.client.test(),b=f.client.test();assert.equal(a,b);assert.match(await a,/手机已处理/);assert.deepEqual(f.counts(),{sent:1,updates:1});assert.equal(f.listeners.size,0);});
test('test exposes device display rejection rather than reporting successful submission',async()=>{const f=fixture('permission denied');assert.match(await f.client.test(),/系统显示失败：permission denied/);assert.equal(f.listeners.size,0);});

test('test notification captures the selected thread before asynchronous worker setup',async()=>{const f=fixture();f.select('thread-a');const pending=f.client.test();f.select('thread-b');await pending;assert.equal(f.bodies[0].threadId,'thread-a');});
