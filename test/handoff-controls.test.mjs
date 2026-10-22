import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandoffControls} from '../public/thread-handoff.js';
// Each test restores the global even when an assertion fails.
function controlsFixture(t){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const nodes=new Map();
 const make=()=>({children:[],attrs:{},hidden:false,classList:{toggle(){}},set id(v){this._id=v;nodes.set(v,this);},get id(){return this._id;},append(...xs){this.children.push(...xs);},after(n){this.afterNode=n;},setAttribute(k,v){this.attrs[k]=v;},focus(){},checkVisibility(){return !this.hidden;}});
 const document={head:make(),createElement:make,getElementById:id=>nodes.get(id)};
 for(const id of ['takeover','connection-banner','message-input']){const n=make();n.id=id;}
 Object.defineProperty(globalThis,'document',{value:document,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 let calls=0;const controls=createHandoffControls({endUse:()=>calls++}),state={id:'a',context:'host:a:1',owned:true,connected:true,supported:true,running:true};
 controls.render(state);return {controls,state,nodes,calls:()=>calls};
}
test('running handoff explains at the top without sending, stacking or changing drafts',t=>{
 const f=controlsFixture(t),banner=f.nodes.get('handoff-status'),button=f.nodes.get('handoff-thread');
 assert.equal(f.nodes.get('connection-banner').afterNode,banner);
 button.onclick();button.onclick();assert.equal(f.calls(),0);assert.equal(banner.hidden,false);assert.match(banner.children[0].textContent,/任务结束后/);assert.equal(banner.children.length,3);
 banner.children[2].onclick();assert.equal(banner.hidden,true);
 button.onclick();f.controls.render({...f.state,running:false});assert.equal(banner.hidden,true);button.onclick();assert.equal(f.calls(),1);
});
test('errors expose retry and disappear across selection context changes',t=>{
 const f=controlsFixture(t),banner=f.nodes.get('handoff-status');f.controls.render({...f.state,running:false});
 f.controls.showError('交还结果未确认');assert.equal(banner.hidden,false);assert.equal(banner.children[1].hidden,false);assert.equal(banner.children[1].disabled,false);
 f.controls.render({...f.state,context:'host:b:2',id:'b'});assert.equal(banner.hidden,true);
});
test('takeover conflict never creates a permanent handoff warning',t=>{
 const f=controlsFixture(t),banner=f.nodes.get('handoff-status');
 f.controls.render({...f.state,owned:false,running:false,conflict:true});assert.equal(banner.hidden,true);assert.equal(banner.children[0].textContent,'');
 f.controls.render({...f.state,owned:false,running:false,conflict:true,handoff:{state:'waiting'}});assert.equal(banner.hidden,false);assert.match(banner.children[0].textContent,/等待引擎释放/);
});
