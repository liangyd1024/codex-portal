import test from 'node:test';
import assert from 'node:assert/strict';
import {installSystemUpdate,createVersionSync} from '../public/system-update.js';

test('update automatically reads status, polls progress and recovers without a check button',async()=>{
 const original={document:global.document,window:global.window,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 const nodes=[];
 function element(tag){const node={tag,children:[],textContent:'',hidden:false,addEventListener(){},setAttribute(k,v){this[k]=v;},append(...children){this.children.push(...children);}};nodes.push(node);return node;}
 const area=element('div');let resolve,poll;const calls=[];
 global.document={getElementById:()=>area,createElement:element,addEventListener(){}};
 global.window={addEventListener(){}};global.setTimeout=fn=>{poll=fn;return 1;};global.clearTimeout=()=>{};
 try{
  installSystemUpdate({api:(url,options)=>{calls.push(options);return new Promise(r=>{resolve=r;});},flush(){},resetCsrf(){}}).open();
  assert.ok(!nodes.some(n=>n.textContent==='检查更新状态'));
  resolve({available:true,job:null});await new Promise(setImmediate);
  const deploy=nodes.find(n=>n.textContent==='更新并重新部署');const posting=deploy.onclick();assert.equal(deploy.disabled,true);assert.equal(nodes.find(n=>n.tag==='progress').hidden,false);
  resolve({available:true,job:{phase:'testing',message:'正在运行更新前测试…'}});await posting;
  assert.ok(nodes.some(n=>n.textContent.includes('● 验证')));assert.equal(calls.at(-1).method,'POST');
  const failed=poll();resolve({available:true,job:{phase:'failed',message:'测试未通过'}});await failed;
  assert.equal(nodes.find(n=>n.tag==='progress').hidden,true);assert.equal(deploy.disabled,false);assert.ok(nodes.some(n=>n.textContent==='上次更新未完成：测试未通过'));
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  const unchanged=poll();resolve({available:true,version:'aaaaaaaa',job:{phase:'succeeded',unchanged:true,fromVersion:'aaaaaaaa',targetVersion:'aaaaaaaa',message:'已是最新版本，无需重新部署。'}});await unchanged;
  assert.ok(!nodes.some(n=>n.textContent==='刷新页面使用新版本')); assert.equal(nodes.find(n=>n.tag==='progress').hidden,true);assert.ok(nodes.some(n=>n.textContent.includes('当前版本 aaaaaaaa')&&n.textContent.includes('已是最新版本')));
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

import {updateVersionInfo} from '../public/system-update.js';
test('documentation-only success reports runtime current without hiding future code updates or failures',()=>{
 const job={phase:'succeeded',documentationOnly:true,sourceVersion:'docs',targetVersion:'runtime',updatedAt:10};
 assert.deepEqual(updateVersionInfo({version:'runtime',job,latest:{version:'docs',checkedAt:11}}),{latest:'docs',documentationOnly:true,current:true});
 assert.equal(updateVersionInfo({version:'runtime',job,latest:{version:'new-code',checkedAt:12}}).current,false);
 assert.equal(updateVersionInfo({version:'other',job,latest:{version:'docs',checkedAt:11}}).current,false);
 assert.equal(updateVersionInfo({version:'runtime',job:{...job,phase:'failed'},latest:{version:'docs',checkedAt:11}}).current,false);
 assert.equal(updateVersionInfo({version:'runtime',job,latest:{version:'old',checkedAt:1}}).latest,'docs');
});
