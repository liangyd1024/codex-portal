import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {composerSendView} from '../src/web/services/composer-send-view.ts';
import ts from 'typescript';
const modelSource=readFileSync(new URL('../src/web/services/model-selection.ts',import.meta.url),'utf8');
const modelOutput=ts.transpileModule(modelSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createModelSelection}=await import('data:text/javascript;base64,'+Buffer.from(modelOutput).toString('base64'));


const catalog=[{id:'catalog-alias',model:'test-model',displayName:'Test Model',supportedReasoningEfforts:['medium'],defaultReasoningEffort:'medium'}];
function fixture({active=false,models=catalog,model='test-model',effort='medium',ready=true,featureReady=()=>true}={}) {
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'补充要求',hidden:false,setAttribute(){},querySelector(){return this;}});return nodes.get(id);};
  const state={models,model,effort,loadingModels:false,status:{},busy:new Set()};
  const c=({state,$,input:$('message-input'),active,ready,own:true,posting:false,handing:false,stopping:false,background:{state:'idle'},switching:false,handoff:null,followUp:'queue',attachments:null,annotations:null,touchInput:()=>false,featureReady,effortNames:{},newChatOpen:false,currentThread:()=>null,renderControls(){},renderSelectOptions:(select,options,value)=>{select.options=options;select.value=value;},clear:n=>{n.children=[];},el:()=>({}),});
  for(const id of ['model-select','effort-select'])$(id).append=function(child){this.children.push(child);};
  Object.assign(c,createModelSelection({state,effortNames:{},newChatOpen:()=>c.newChatOpen,currentThread:c.currentThread,element:$,renderSelectOptions:c.renderSelectOptions,renderControls:c.renderControls}));
  const render=()=>{const {buttonView,unavailable}=composerSendView({active:c.active,ready,own:true,posting:false,handing:false,stopping:false,loginRecovery:false,desktopMode:false,interrupting:false,archived:false,touch:false,backgroundState:'idle',followUp:'queue',text:$('message-input').value,loadingModels:state.loadingModels,hasModel:Boolean(c.modelFor(state.model)),hasEffort:c.effortsFor(state.model).some(e=>e.value===state.effort),featureReady});c.buttonView=buttonView;Object.assign($('composer-availability'),{textContent:unavailable,hidden:!unavailable});};
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

test('loading a catalog suppresses premature model and effort prompts without enabling invalid sends',()=>{
  for(const options of [{models:[]},{effort:'missing'}]){
    const f=fixture(options);f.state.loadingModels=true;f.render();
    assert.equal(f.$('composer-availability').hidden,true);assert.equal(f.view().send.disabled,true);
    f.state.loadingModels=false;f.render();assert.equal(f.$('composer-availability').hidden,false);
    f.state.models=catalog;f.renderModels();f.render();assert.equal(f.$('composer-availability').hidden,true);
    assert.equal(f.view().send.disabled,false);assert.equal(f.$('message-input').value,'补充要求');
  }
});
test('catalog refresh preserves valid sends and connection errors remain visible',()=>{
  const valid=fixture();valid.state.loadingModels=true;valid.render();assert.equal(valid.view().send.disabled,false);assert.equal(valid.$('composer-availability').hidden,true);
  for(const options of [{ready:false},{featureReady:()=>false}]){
    const f=fixture({...options,models:[]});f.state.loadingModels=true;f.render();assert.equal(f.$('composer-availability').hidden,false);assert.equal(f.view().send.disabled,true);
  }
});
