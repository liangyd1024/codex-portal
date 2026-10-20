import test from 'node:test';
import assert from 'node:assert/strict';
import {installSystemUpdate} from '../public/system-update.js';

test('update controls expose checking, unchanged result, deployment and failure feedback',async()=>{
 const original={document:global.document,window:global.window,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 const nodes=[];
 function element(tag){const node={tag,children:[],textContent:'',hidden:false,setAttribute(k,v){this[k]=v;},append(...children){this.children.push(...children);}};nodes.push(node);return node;}
 const area=element('div');let resolve;const calls=[];
 global.document={getElementById:()=>area,createElement:element,addEventListener(){}};
 global.window={addEventListener(){}};global.setTimeout=()=>1;global.clearTimeout=()=>{};
 try{
  installSystemUpdate({api:(url,options)=>{calls.push(options);return new Promise(r=>{resolve=r;});},flush(){},resetCsrf(){}});
  const refresh=nodes.find(n=>n.textContent==='正在检查…');assert.ok(refresh.disabled);
  resolve({available:true,job:null});await new Promise(setImmediate);
  assert.equal(refresh.textContent,'检查更新状态');assert.ok(nodes.some(n=>n.textContent.includes('已检查')));
  const checking=refresh.onclick();assert.equal(refresh.textContent,'正在检查…');assert.ok(nodes.some(n=>n.textContent==='正在获取最新更新状态…'));
  resolve({available:true,job:null});await checking;
  const deploy=nodes.find(n=>n.textContent==='更新并重新部署');const posting=deploy.onclick();assert.equal(deploy.disabled,true);assert.equal(nodes.find(n=>n.tag==='progress').hidden,false);
  resolve({available:true,job:{phase:'testing',message:'正在运行更新前测试…'}});await posting;
  assert.ok(nodes.some(n=>n.textContent.includes('● 验证')));assert.equal(calls.at(-1).method,'POST');
  const failed=refresh.onclick();resolve({available:true,job:{phase:'failed',message:'测试未通过'}});await failed;
  assert.equal(nodes.find(n=>n.tag==='progress').hidden,true);assert.equal(deploy.disabled,false);assert.ok(nodes.some(n=>n.textContent.includes('更新失败')));
 }finally{Object.assign(global,original);}
});
