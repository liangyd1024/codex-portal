import test from 'node:test';
import assert from 'node:assert/strict';
import {installTurnNavigation} from '../public/turn-navigation.js';

function fixture(t,{fail=false,directory=false}={}){
 const elements=[];
 const element=()=>{const n={children:[],dataset:{},style:{},classList:{toggle(){}},append(...nodes){this.children.push(...nodes);},setAttribute(){},removeAttribute(){},addEventListener(){},querySelectorAll(){return [];},getBoundingClientRect(){return {top:0,bottom:100,height:100};},insertBefore(node){this.children.push(node);},remove(){},replaceChildren(){this.children=[];}};elements.push(n);return n;};
 for(const [name,value] of Object.entries({document:{createElement:element,body:element(),addEventListener(){},querySelector:element},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1})){const original=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});t.after(()=>{if(original)Object.defineProperty(globalThis,name,original);else delete globalThis[name];});}
 const state={visible:true,ready:false,turns:[],hasEarlier:true,cursor:'0'},calls=[],paused=[],renders=[];
 const nav=installTurnNavigation({...(directory?{loadDirectory:async()=>{calls.push('directory');if(fail)throw Error('offline');return {data:[]};}}:{}),scroller:element(),content:element(),entryHost:element(),follow:{pause:()=>paused.push(1)},context:()=>({...state,renderHistory:()=>renders.push(1)}),loadEarlier:async()=>{calls.push(state.cursor);if(fail)return false;state.cursor=String(Number(state.cursor)+1);state.hasEarlier=Number(state.cursor)<3;return true;}});
 nav.switchContext('a');
 return {state,nav,calls,paused,renders,count:()=>elements.find(n=>n.className==='turn-navigation-count'),rail:()=>elements.find(n=>n.className==='turn-navigation'),ticks:()=>elements.find(n=>n.className==='turn-navigation-ticks')};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
test('opening waits for ready detail then loads every page without clicking or pausing follow',async t=>{
 const f=fixture(t);f.nav.update();assert.equal(f.calls.length,0);
 f.state.ready=true;f.nav.update();f.nav.update();await settle();
 assert.deepEqual(f.calls,['0','1','2']);assert.equal(f.renders.length,1);assert.equal(f.paused.length,0);
 f.nav.update();await settle();assert.equal(f.calls.length,3);
});
test('automatic failure does not retry on rendering; explicit retry resumes',async t=>{
 const f=fixture(t,{fail:true});f.state.ready=true;f.nav.update();await settle();f.nav.update();await settle();assert.equal(f.calls.length,1);
 f.count().onclick();await settle();assert.equal(f.calls.length,2);
});
test('cancel stays cancelled across updates; a new conversation automatically loads',async t=>{
 const f=fixture(t);f.state.ready=true;f.nav.update();f.count().onclick();await settle();f.nav.update();await settle();assert.equal(f.calls.length,1);
 f.nav.switchContext('b');f.nav.update();await settle();assert.deepEqual(f.calls,['0','1','2']);
});

test('loading stays silent; failure and cancellation expose retry',async t=>{
 const f=fixture(t,{fail:true});f.nav.update();assert.equal(f.count().textContent,'');
 f.state.ready=true;f.nav.update();assert.equal(f.count().textContent,'');assert.equal(f.rail().hidden,true);assert.equal(f.ticks().hidden,true);
 await settle();assert.equal(f.count().textContent,'重试');
 f.count().onclick();assert.equal(f.count().textContent,'');
 f.count().onclick();assert.equal(f.count().textContent,'重试');
 await settle();assert.equal(f.calls.length,2);
});

test('directory opening never downloads transcript pages or renders full history',async t=>{
 const f=fixture(t,{directory:true});f.state.ready=true;f.nav.update();f.nav.update();await settle();
 assert.deepEqual(f.calls,['directory']);assert.deepEqual(f.renders,[]);assert.equal(f.state.hasEarlier,true);assert.equal(f.count().textContent,'0轮');
 f.nav.update();await settle();assert.deepEqual(f.calls,['directory']);
});
test('directory failure remains retryable without falling back to bulk history',async t=>{
 const f=fixture(t,{directory:true,fail:true});f.state.ready=true;f.nav.update();await settle();
 assert.equal(f.count().textContent,'重试');f.count().onclick();await settle();assert.deepEqual(f.calls,['directory','directory']);assert.deepEqual(f.renders,[]);
});
