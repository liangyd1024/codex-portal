import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/notification-preference.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createNotificationPreference}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(overrides={}) {
 const values=new Map(),views=[],errors=[],calls=[];let host='qa-local',permission='default';
 const deps={host:()=>host,support:()=>({supported:true,worker:true}),permission:()=>permission,
 requestPermission:async()=>{calls.push('permission');return permission;},prepareWorker:async()=>{calls.push('worker');},
 read:key=>values.get(key)??null,save:(key,value)=>values.set(key,value),publish:view=>views.push(view),recordError:e=>errors.push(e.message),...overrides};
 return {controller:createNotificationPreference(deps),deps,values,views,errors,calls,host:v=>{host=v;},permission:v=>{permission=v;}};
}
test('permission request starts synchronously, duplicate toggles are ignored, and denial persists disabled',async()=>{
 let release;const f=fixture({requestPermission:()=>{f.calls.push('permission');return new Promise(resolve=>{release=resolve;});}});
 const pending=f.controller.setEnabled(true);assert.deepEqual(f.calls,['permission']);assert.equal(f.views[0].status,'正在申请通知权限…');
 await f.controller.setEnabled(false);assert.equal(f.views.length,1);f.permission('denied');release('denied');await pending;
 assert.equal(f.controller.enabled(),false);assert.equal(f.values.get('rcm.taskNotifications.qa-local'),'false');assert.deepEqual(f.calls,['permission']);assert.equal(f.views.at(-1).status,'通知已被阻止。请在浏览器网站设置中允许通知。');
});
test('worker failure keeps the old preference and allows retry, then disable skips worker setup',async()=>{
 let fail=true;const f=fixture({prepareWorker:async()=>{f.calls.push('worker');if(fail)throw Error('初始化失败');}});f.permission('granted');
 await f.controller.setEnabled(true);assert.equal(f.controller.enabled(),false);assert.equal(f.values.size,0);assert.equal(f.views.at(-1).status,'通知未开启：初始化失败。请重试。');
 fail=false;await f.controller.setEnabled(true);assert.equal(f.controller.enabled(),true);assert.equal(f.values.get('rcm.taskNotifications.qa-local'),'true');
 await f.controller.setEnabled(false);assert.equal(f.controller.enabled(),false);assert.equal(f.values.get('rcm.taskNotifications.qa-local'),'false');assert.deepEqual(f.calls,['worker','worker']);
});
test('late permission setup cannot write or publish into another connection and releases the pending guard',async()=>{
 let release;const f=fixture({prepareWorker:()=>new Promise(resolve=>{release=resolve;})});f.permission('granted');
 const pending=f.controller.setEnabled(true);f.host('qa-remote');release();await pending;
 assert.equal(f.values.size,0);assert.equal(f.views.length,1);assert.equal(f.controller.enabled(),false);
 await f.controller.setEnabled(false);assert.equal(f.values.get('rcm.taskNotifications.qa-remote'),'false');assert.equal(f.views.at(-1).disabled,false);
});
test('storage failures preserve baseline in-memory state; unsupported environments never read permission',async()=>{
 const f=fixture({save:()=>{throw Error('写入失败');}});f.permission('granted');await f.controller.setEnabled(true);
 assert.equal(f.controller.enabled(),true);assert.equal(f.views.at(-2).checked,true);assert.equal(f.views.at(-1).status,'通知未开启：写入失败。请重试。');
 f.deps.read=()=>{throw Error('读取失败');};f.controller.sync();assert.equal(f.controller.enabled(),true);
 const unsupported=fixture({support:()=>({supported:false,message:'不支持通知'}),permission:()=>{throw Error('不能读取权限');}});
 unsupported.controller.sync();assert.equal(unsupported.views.at(-1).status,'不支持通知');await unsupported.controller.setEnabled(true);assert.deepEqual(unsupported.errors,['不支持通知']);assert.equal(unsupported.controller.enabled(),false);
});
