import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {submitNotification} from '../public/notification-delivery.js';
import {submitWorkerNotification} from '../public/notification-platform.js';
const source=await readFile(new URL('../src/web/services/notification-delivery.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createNotificationDelivery}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(overrides={}){
 const calls=[],diagnostics=[],views=[],notices=[];let generation=0;
 const deps={host:()=> 'qa-local',worker:()=>true,
 prepareWorker:async()=>{const id=++generation;calls.push(['prepare',id]);return{showNotification:async(title,options)=>calls.push(['worker',id,title,options])};},
 submitWorker:submitWorkerNotification,submitNative:submitNotification,
 createNative:(title,options)=>{const n={close(){calls.push(['close']);this.onclose?.();}};notices.push(n);calls.push(['native',title,options]);queueMicrotask(()=>n.onshow?.());return n;},
 diagnostic:m=>diagnostics.push(m),publish:v=>views.push(v),focus:()=>calls.push(['focus']),open:t=>calls.push(['open',t]),...overrides};
 return {controller:createNotificationDelivery(deps),deps,calls,diagnostics,views,notices};
}
test('worker registration is reused, explicit preparation replaces it, and event routing data is preserved',async()=>{
 const f=fixture();await f.controller.prepare();assert.equal(await f.controller.send('标题','原文','tag','thread','qa-remote'),true);await f.controller.send('测试','内容','test');
 assert.equal(f.calls.filter(c=>c[0]==='prepare').length,1);assert.deepEqual(f.calls[1],['worker',1,'标题',{body:'原文',tag:'tag',data:{host:'qa-remote',threadId:'thread'}}]);
 await f.controller.prepare();await f.controller.send('再次','正文','next');assert.equal(f.calls.at(-1)[1],2);assert.deepEqual(f.views,[]);
});
test('worker initialization failure is reported and retry works; rejected submission retains registration',async()=>{
 let attempts=0,failSend=true;
 const f=fixture({prepareWorker:async()=>{attempts++;if(attempts===1)throw Error('准备失败');return{showNotification:async()=>{if(failSend)throw Error('提交失败');}};}});
 assert.equal(await f.controller.send('标题','正文','tag'),false);assert.equal(f.diagnostics.at(-1),'标题：准备失败');
 assert.equal(await f.controller.send('标题','正文','tag'),false);assert.equal(f.diagnostics.at(-1),'标题：提交失败');
 failSend=false;assert.equal(await f.controller.send('标题','正文','tag'),true);assert.equal(attempts,2);assert.deepEqual(f.views,[]);
});
test('native show, click and close retain navigation context and order; test notices do not navigate',async()=>{
 const f=fixture({worker:()=>false});assert.equal(await f.controller.send('标题','正文','tag','thread','qa-remote'),true);
 f.notices[0].onclick();assert.deepEqual(f.calls.slice(-3),[['focus'],['close'],['open',{host:'qa-remote',threadId:'thread'}]]);assert.equal(f.diagnostics.at(-1),'标题：通知已关闭');
 await f.controller.send('测试','正文','test');const count=f.calls.filter(c=>c[0]==='open').length;f.notices[1].onclick();assert.equal(f.calls.filter(c=>c[0]==='open').length,count);
});
test('native constructor and display errors use existing failure text and allow a fresh submission',async()=>{
 let fail=true;const f=fixture({worker:()=>false,createNative:()=>{if(fail)throw Error('构造失败');const n={close(){}};queueMicrotask(()=>n.onerror?.());return n;}});
 assert.equal(await f.controller.send('标题','正文','tag'),false);assert.equal(f.views.at(-1).status,'构造失败。请检查浏览器和系统的通知设置。');
 fail=false;assert.equal(await f.controller.send('标题','正文','tag'),false);assert.equal(f.views.at(-1).status,'浏览器报告发送失败。请检查浏览器和系统的通知设置。');
});
