import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const catalog=[{id:'catalog-alias',model:'test-model',displayName:'Test Model',supportedReasoningEfforts:['medium'],defaultReasoningEffort:'medium'}];
function fixture({active=false,models=catalog,model='test-model',effort='medium',ready=true,featureReady=()=>true}={}) {
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'补充要求',hidden:false,setAttribute(){},querySelector(){return this;}});return nodes.get(id);};
  const state={models,model,effort,status:{},busy:new Set()};
  const c=vm.createContext({state,$,input:$('message-input'),active,ready,own:true,posting:false,handing:false,stopping:false,background:{state:'idle'},switching:false,handoff:null,followUp:'queue',attachments:null,annotations:null,touchInput:()=>false,featureReady,effortNames:{},newChatOpen:false,currentThread:()=>null,renderControls(){},renderSelectOptions:(select,options,value)=>{select.options=options;select.value=value;},clear:n=>{n.children=[];},el:()=>({}),});
  for(const id of ['model-select','effort-select'])$(id).append=function(child){this.children.push(child);};
  vm.runInContext(source.slice(source.indexOf('function modelId('),source.indexOf('\nfunction toolDetails(')),c);
  const render=()=>vm.runInContext('{'+source.slice(source.indexOf('  const hasModel ='),source.indexOf("  $('new-thread').setAttribute('aria-description'"))+'globalThis.buttonView=buttonView;}',c);
  return {state,$,render,view:()=>c.buttonView,setActive:value=>{c.active=value;},renderModels:()=>c.renderModels()};
}
test('running follow-ups need no next-turn model catalog or effort; idle turns still do',()=>{
  const f=fixture({active:true,models:[]});f.render();
  assert.equal(f.$('composer-availability').hidden,true);assert.equal(f.view().send.disabled,false);assert.equal(f.view().guide.disabled,false);
  const idle=fixture({models:[]});idle.render();assert.equal(idle.$('composer-availability').textContent,'请选择一个可用模型。');assert.equal(idle.view().send.disabled,true);
  const effort=fixture({active:true,effort:'missing'});effort.render();assert.equal(effort.$('composer-availability').hidden,true);
  const idleEffort=fixture({effort:'missing'});idleEffort.render();assert.equal(idleEffort.$('composer-availability').textContent,'请选择思考档位。');assert.equal(idleEffort.view().send.disabled,true);
});
test('catalog aliases validate and normalize to the same selected model and effort',()=>{
  const f=fixture({model:'catalog-alias'});f.render();assert.equal(f.$('composer-availability').hidden,true);assert.equal(f.view().send.disabled,false);
  f.renderModels();assert.equal(f.state.model,'test-model');assert.equal(f.$('model-select').value,'test-model');assert.equal(f.state.effort,'medium');
});
test('active turns still show connection and unsupported-operation feedback and preserve drafts',()=>{
  const f=fixture({active:true,models:[],ready:false});f.render();assert.match(f.$('composer-availability').textContent,/连接恢复/);assert.equal(f.view().send.disabled,true);assert.equal(f.$('message-input').value,'补充要求');
  const unsupported=fixture({active:true,models:[],featureReady:()=>false});unsupported.render();assert.match(unsupported.$('composer-availability').textContent,/暂不支持此操作/);assert.equal(unsupported.view().send.disabled,true);
});

test('run completion and catalog recovery update the notice without losing the draft',()=>{
  const f=fixture({active:true,models:[]});f.render();assert.equal(f.$('composer-availability').hidden,true);
  f.setActive(false);f.render();assert.equal(f.$('composer-availability').hidden,false);assert.equal(f.view().send.disabled,true);
  f.state.models=catalog;f.renderModels();f.render();assert.equal(f.$('composer-availability').hidden,true);assert.equal(f.view().send.disabled,false);assert.equal(f.$('message-input').value,'补充要求');
});
