import test from 'node:test';
import assert from 'node:assert/strict';
import {installSystemUpdate} from '../public/system-update.js';

test('update automatically reads status, polls progress and recovers without a check button',async()=>{
 const original={document:global.document,window:global.window,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 const nodes=[];
 function element(tag){const node={tag,children:[],textContent:'',hidden:false,setAttribute(k,v){this[k]=v;},append(...children){this.children.push(...children);}};nodes.push(node);return node;}
 const area=element('div');let resolve,poll;const calls=[];
 global.document={getElementById:()=>area,createElement:element,addEventListener(){}};
 global.window={addEventListener(){}};global.setTimeout=fn=>{poll=fn;return 1;};global.clearTimeout=()=>{};
 try{
  installSystemUpdate({api:(url,options)=>{calls.push(options);return new Promise(r=>{resolve=r;});},flush(){},resetCsrf(){}});
  assert.ok(!nodes.some(n=>n.textContent==='检查更新状态'));
  resolve({available:true,job:null});await new Promise(setImmediate);
  const deploy=nodes.find(n=>n.textContent==='更新并重新部署');const posting=deploy.onclick();assert.equal(deploy.disabled,true);assert.equal(nodes.find(n=>n.tag==='progress').hidden,false);
  resolve({available:true,job:{phase:'testing',message:'正在运行更新前测试…'}});await posting;
  assert.ok(nodes.some(n=>n.textContent.includes('● 验证')));assert.equal(calls.at(-1).method,'POST');
  const failed=poll();resolve({available:true,job:{phase:'failed',message:'测试未通过'}});await failed;
  assert.equal(nodes.find(n=>n.tag==='progress').hidden,true);assert.equal(deploy.disabled,false);assert.ok(nodes.some(n=>n.textContent==='上次更新未完成：测试未通过'));
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
 }finally{Object.assign(global,original);}
});
