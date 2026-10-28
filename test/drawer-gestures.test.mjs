import test from 'node:test';
import assert from 'node:assert/strict';
import {installDrawerGestures} from '../src/web/services/drawer-gestures.ts';
function fixture(t){
 class Element {scrollWidth=100;clientWidth=100;parentElement=null;blocked=false;tag='p';closest(selector){return this.blocked || selector.split(/,\s*/).includes(this.tag);}}
 const surface=new EventTarget(),target=new Element();let mode='main',selection='',dialog=false;const actions=[];
 for(const [key,value] of Object.entries({Element,document:{querySelector:()=>dialog},window:{getSelection:()=>({toString:()=>selection})},innerWidth:390,getComputedStyle:()=>({overflowX:'auto'})})){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
 installDrawerGestures({surface,mode:()=>mode,openSidebar:()=>actions.push('open'),closeDrawers:()=>actions.push('close')});
 const touch=(x,y=200,id=1)=>({clientX:x,clientY:y,identifier:id});
 const fire=(type,points,extra={})=>{const e=new Event(type,{cancelable:true});Object.defineProperties(e,Object.fromEntries(Object.entries({target,touches:type==='touchend'?[]:points,changedTouches:points,...extra}).map(([k,value])=>[k,{value}])));surface.dispatchEvent(e);return e;};
 const swipe=(x,end,y=200)=>{fire('touchstart',[touch(x)]);fire('touchmove',[touch(end,y)]);fire('touchend',[touch(end,y)]);};
 return {actions,target,fire,touch,swipe,mode:v=>mode=v,selection:v=>selection=v,dialog:v=>dialog=v};
}
test('touch gestures open and close the matching drawer',t=>{
 const f=fixture(t);f.swipe(8,140);f.mode('sidebar');f.swipe(210,90);f.mode('inspector');f.swipe(8,140);assert.deepEqual(f.actions,['open','close','close']);
});
test('vertical, short, reversed and desktop gestures do not change drawers',t=>{
 const f=fixture(t);f.swipe(8,140,350);f.swipe(8,40);f.swipe(24,0);f.swipe(80,210);f.mode(null);f.swipe(8,140);assert.deepEqual(f.actions,[]);
});
test('editing, selection, dialogs and horizontal scrollers keep their gestures',t=>{
 const f=fixture(t);f.target.blocked=true;f.swipe(8,140);f.target.blocked=false;f.selection('text');f.swipe(8,140);f.selection('');f.dialog(true);f.swipe(8,140);f.dialog(false);f.target.scrollWidth=300;f.swipe(8,140);assert.deepEqual(f.actions,[]);
});
test('cancel, multitouch, changed layout and vertical-first movement cannot trigger',t=>{
 const f=fixture(t),p=f.touch;
 for(const cancel of [()=>f.fire('touchcancel',[]),()=>f.fire('touchmove',[p(120),p(140,200,2)]),()=>f.mode('sidebar'),()=>f.fire('touchmove',[p(10,240)])]){
  f.mode('main');f.fire('touchstart',[p(8)]);cancel();f.fire('touchmove',[p(210)]);f.fire('touchend',[p(210)]);
 }
 assert.deepEqual(f.actions,[]);
});
test('only horizontal movement prevents scrolling; long holds and return drags do not open',t=>{
 const f=fixture(t),p=f.touch;f.fire('touchstart',[p(8)],{timeStamp:0});assert.equal(f.fire('touchmove',[p(10,205)]).defaultPrevented,false);assert.equal(f.fire('touchmove',[p(180)]).defaultPrevented,true);f.fire('touchend',[p(210)],{timeStamp:1000});
 f.fire('touchstart',[p(8)]);f.fire('touchmove',[p(210)]);f.fire('touchend',[p(15)]);assert.deepEqual(f.actions,[]);
});

test('conversation gutters, inline code and non-scrolling code or tables can open the sidebar',t=>{
 const f=fixture(t);
 f.swipe(8,130);
 for(const tag of ['code','pre','.table-scroll']){f.target.tag=tag;f.swipe(8,140);}
 assert.deepEqual(f.actions,['open','open','open','open']);
});
test('overflowing code and tables preserve horizontal gestures including nested text',t=>{
 const f=fixture(t);
 for(const tag of ['pre','.table-scroll']){
  f.target.tag='code';f.target.parentElement={scrollWidth:600,clientWidth:300,parentElement:null,tag};
  f.swipe(8,140);
 }
 assert.deepEqual(f.actions,[]);
});

test('only the leftmost 24px opens the sidebar, including the exact screen edge',t=>{
 const f=fixture(t);
 for(const x of [0,8,24,25,80,200])f.swipe(x,x+100);
 assert.deepEqual(f.actions,['open','open','open']);
});

test('drawer rows close with a shorter swipe without activating the row; taps still work',t=>{
 const f=fixture(t);f.mode('sidebar');f.target.tag='button';f.swipe(200,155);
 assert.deepEqual(f.actions,['close']);assert.equal(f.fire('click',[],{detail:1}).defaultPrevented,true);
 f.fire('touchstart',[f.touch(200)]);f.fire('touchend',[f.touch(200)]);
 assert.equal(f.fire('click',[],{detail:1}).defaultPrevented,false);
});
test('drawer form inputs and vertical row scrolling remain available',t=>{
 const f=fixture(t);f.mode('sidebar');
 f.target.tag='input';f.swipe(200,100);f.target.tag='button';f.swipe(200,155,350);
 assert.deepEqual(f.actions,[]);assert.equal(f.fire('click',[],{detail:1}).defaultPrevented,false);
});

test('side chat closes only from the left edge with a rightward swipe',t=>{
 const f=fixture(t);f.mode('sideChat');
 for(const x of [0,8,24,25,80])f.swipe(x,x+80);
 assert.deepEqual(f.actions,['close','close','close']);
 f.actions.length=0;
 f.swipe(8,30);f.swipe(20,0);f.swipe(8,120,350);
 assert.deepEqual(f.actions,[]);
});
test('side chat preserves editing, selection, scrolling, cancellation and taps',t=>{
 const f=fixture(t);f.mode('sideChat');
 f.target.tag='textarea';f.swipe(8,140);f.target.tag='p';
 f.selection('选文');f.swipe(8,140);f.selection('');
 f.target.scrollWidth=300;f.swipe(8,140);f.target.scrollWidth=100;
 f.fire('touchstart',[f.touch(8)]);f.fire('touchmove',[f.touch(120)]);f.fire('touchcancel',[]);f.fire('touchend',[f.touch(120)]);
 f.fire('touchstart',[f.touch(8)]);f.fire('touchend',[f.touch(8)]);
 assert.deepEqual(f.actions,[]);assert.equal(f.fire('click',[],{detail:1}).defaultPrevented,false);
});
