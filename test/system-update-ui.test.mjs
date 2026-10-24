import test from 'node:test';
import assert from 'node:assert/strict';
import {createVersionSync} from '../public/system-update.js';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/web/services/system-update.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {installSystemUpdate,updateVersionInfo}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));

test('update automatically reads status, polls progress and recovers without a check button',async()=>{
 const original={document:global.document,window:global.window,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 let view;const area={addEventListener(){}};let resolve,poll;const calls=[];
 global.document={getElementById:()=>area,addEventListener(){}};
 global.window={addEventListener(){}};global.setTimeout=fn=>{poll=fn;return 1;};global.clearTimeout=()=>{};
 try{
  const controller=installSystemUpdate({publish:next=>{view=next;},api:(url,options)=>{calls.push(options);return new Promise(r=>{resolve=r;});},flush(){},resetCsrf(){}});controller.open();
  assert.equal(view.status,'正在读取更新状态…');
  resolve({available:true,job:null});await new Promise(setImmediate);
  const posting=controller.submit();assert.equal(view.disabled,true);assert.equal(view.progressHidden,false);
  resolve({available:true,job:{phase:'testing',message:'正在运行更新前测试…'}});await posting;
  assert.ok(view.steps.includes('● 验证'));assert.equal(calls.at(-1).method,'POST');
  const failed=poll();resolve({available:true,job:{phase:'failed',message:'测试未通过'}});await failed;
  assert.equal(view.progressHidden,true);assert.equal(view.disabled,false);assert.equal(view.status,'上次更新未完成：测试未通过');
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  const unchanged=poll();resolve({available:true,version:'aaaaaaaa',job:{phase:'succeeded',unchanged:true,fromVersion:'aaaaaaaa',targetVersion:'aaaaaaaa',message:'已是最新版本，无需重新部署。'}});await unchanged;
  assert.equal(view.button,'更新并重新部署');assert.equal(view.progressHidden,true);assert.ok(view.versions.includes('当前版本 aaaaaaaa')&&view.versions.includes('已是最新版本'));
 }finally{Object.assign(global,original);}
});

test('all entries reload once after saving drafts, deferring during Chinese composition',()=>{
 const calls=[];let scheduled;
 const sync=createVersionSync({flush:()=>calls.push('save'),reload:()=>calls.push('reload'),onError:()=>calls.push('error'),schedule:fn=>{scheduled=fn;}});
 sync.receive({version:'a'});sync.receive({version:'a'});assert.deepEqual(calls,[]);
 sync.compositionStart();sync.receive({version:'b'});assert.deepEqual(calls,[]);
 sync.compositionEnd();assert.deepEqual(calls,[]);scheduled();sync.receive({version:'b'});
 assert.deepEqual(calls,['save','reload']);
});
test('failed draft persistence prevents automatic reload and allows retry',()=>{
 let fail=true,reloads=0,errors=0;
 const sync=createVersionSync({flush:()=>{if(fail)throw Error('storage');},reload:()=>reloads++,onError:()=>errors++});
 sync.receive({version:'a'});sync.receive({version:'b'});assert.equal(reloads,0);assert.equal(errors,1);
 fail=false;sync.receive({version:'b'});assert.equal(reloads,1);
});


test('documentation-only success reports runtime current without hiding future code updates or failures',()=>{
 const job={phase:'succeeded',documentationOnly:true,sourceVersion:'docs',targetVersion:'runtime',updatedAt:10};
 assert.deepEqual(updateVersionInfo({version:'runtime',job,latest:{version:'docs',checkedAt:11}}),{latest:'docs',documentationOnly:true,current:true});
 assert.equal(updateVersionInfo({version:'runtime',job,latest:{version:'new-code',checkedAt:12}}).current,false);
 assert.equal(updateVersionInfo({version:'other',job,latest:{version:'docs',checkedAt:11}}).current,false);
 assert.equal(updateVersionInfo({version:'runtime',job:{...job,phase:'failed'},latest:{version:'docs',checkedAt:11}}).current,false);
 assert.equal(updateVersionInfo({version:'runtime',job,latest:{version:'old',checkedAt:1}}).latest,'docs');
});

test('update ignores a late read after an event and prevents duplicate uncertain submission',async()=>{
 const original={document:global.document,window:global.window,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 const listeners=new Map(),calls=[],pending=[];let view,poll;
 global.document={getElementById:()=>({addEventListener(){}}),addEventListener(){}};
 global.window={addEventListener:(type,fn)=>listeners.set(type,fn)};
 global.setTimeout=fn=>{poll=fn;return 1;};global.clearTimeout=()=>{};
 try{
  const controller=installSystemUpdate({publish:next=>{view=next;},api:(path,options)=>{calls.push({path,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));},flush(){},resetCsrf(){}});
  const opening=controller.open();
  listeners.get('rcm:system-update')({detail:{available:true,version:'event-version',job:null}});
  pending.shift().resolve({available:false,version:'stale-version',reason:'stale'});await opening;
  assert.ok(view.versions.includes('event-ve'));assert.equal(view.disabled,false);
  const sending=controller.submit();await controller.submit();
  assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
  listeners.get('rcm:system-update')({detail:{available:false,reason:'must not replace pending submission'}});
  assert.equal(view.status,'正在提交更新请求…');
  pending.shift().reject(new TypeError('response lost'));await sending;
  assert.equal(view.disabled,true);assert.equal(view.status,'提交结果暂未确认，正在检查更新状态…');
  await controller.submit();assert.equal(calls.length,2);
  const checking=poll();pending.shift().reject(new TypeError('offline'));await checking;
  assert.equal(view.status,'正在等待网页服务恢复，稍后自动核对更新结果…');assert.equal(view.disabled,true);
  const recovery=poll();pending.shift().resolve({available:true,job:{phase:'succeeded',message:'done'}});await recovery;
  assert.equal(view.status,'done');assert.equal(view.disabled,false);assert.equal(view.progressHidden,true);
 }finally{Object.assign(global,original);}
});
