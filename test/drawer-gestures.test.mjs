import test from 'node:test';
import assert from 'node:assert/strict';
import {installDrawerGestures} from '../src/web/services/drawer-gestures.ts';
function fixture(t){
 class Element {scrollWidth=100;clientWidth=100;parentElement=null;blocked=false;closest(){return this.blocked;}}
 const surface=new EventTarget(),target=new Element();let mode='main',selection='',dialog=false;const actions=[];
 for(const [key,value] of Object.entries({Element,document:{querySelector:()=>dialog},window:{getSelection:()=>({toString:()=>selection})},innerWidth:390,getComputedStyle:()=>({overflowX:'auto'})})){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
 installDrawerGestures({surface,mode:()=>mode,openSidebar:()=>actions.push('open'),closeDrawers:()=>actions.push('close')});
 const touch=(x,y=200,id=1)=>({clientX:x,clientY:y,identifier:id});
 const fire=(type,points,extra={})=>{const e=new Event(type,{cancelable:true});Object.defineProperties(e,Object.fromEntries(Object.entries({target,touches:type==='touchend'?[]:points,changedTouches:points,...extra}).map(([k,value])=>[k,{value}])));surface.dispatchEvent(e);return e;};
 const swipe=(x,end,y=200)=>{fire('touchstart',[touch(x)]);fire('touchmove',[touch(end,y)]);fire('touchend',[touch(end,y)]);};
 return {actions,target,fire,touch,swipe,mode:v=>mode=v,selection:v=>selection=v,dialog:v=>dialog=v};
}
test('touch gestures open and close the matching drawer',t=>{
 const f=fixture(t);f.swipe(90,210);f.mode('sidebar');f.swipe(210,90);f.mode('inspector');f.swipe(90,210);assert.deepEqual(f.actions,['open','close','close']);
});
test('vertical, short, reversed, edge and desktop gestures do not change drawers',t=>{
 const f=fixture(t);f.swipe(90,210,350);f.swipe(90,130);f.swipe(210,90);f.swipe(5,130);f.mode(null);f.swipe(90,210);assert.deepEqual(f.actions,[]);
});
test('editing, selection, dialogs and horizontal scrollers keep their gestures',t=>{
 const f=fixture(t);f.target.blocked=true;f.swipe(90,210);f.target.blocked=false;f.selection('text');f.swipe(90,210);f.selection('');f.dialog(true);f.swipe(90,210);f.dialog(false);f.target.scrollWidth=300;f.swipe(90,210);assert.deepEqual(f.actions,[]);
});
test('cancel, multitouch, changed layout and vertical-first movement cannot trigger',t=>{
 const f=fixture(t),p=f.touch;
 for(const cancel of [()=>f.fire('touchcancel',[]),()=>f.fire('touchmove',[p(120),p(140,200,2)]),()=>f.mode('sidebar'),()=>f.fire('touchmove',[p(95,240)])]){
  f.mode('main');f.fire('touchstart',[p(90)]);cancel();f.fire('touchmove',[p(210)]);f.fire('touchend',[p(210)]);
 }
 assert.deepEqual(f.actions,[]);
});
test('only horizontal movement prevents scrolling; long holds and return drags do not open',t=>{
 const f=fixture(t),p=f.touch;f.fire('touchstart',[p(90)],{timeStamp:0});assert.equal(f.fire('touchmove',[p(95,205)]).defaultPrevented,false);assert.equal(f.fire('touchmove',[p(180)]).defaultPrevented,true);f.fire('touchend',[p(210)],{timeStamp:1000});
 f.fire('touchstart',[p(90)]);f.fire('touchmove',[p(210)]);f.fire('touchend',[p(100)]);assert.deepEqual(f.actions,[]);
});
