import test from 'node:test';
import assert from 'node:assert/strict';
import {installScrollFollow} from '../public/mobile-ui.js';

function fixture(t){
  class Node extends EventTarget {
    children=[];scrollHeight=1000;clientHeight=400;top=600;
    get scrollTop(){return this.top;}
    set scrollTop(value){this.top=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));}
    append(node){this.children.push(node);}after(node){this.sibling=node;}setAttribute(){}
  }
  let resize,seq=0;const frames=new Map(),scroller=new Node();
  const mocks={document:{createElement:()=>new Node()},window:new Node(),ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id)};
  for(const [key,value] of Object.entries(mocks)){const old=globalThis[key];globalThis[key]=value;t.after(()=>{if(old===undefined)delete globalThis[key];else globalThis[key]=old;});}
  const follow=installScrollFollow(scroller,new Node()),button=scroller.sibling.children[0];
  const flush=()=>{for(const [id,fn] of frames){frames.delete(id);fn();}};
  const event=(type,fields={})=>{scroller.dispatchEvent(Object.assign(new Event(type),fields));};
  return {scroller,follow,button,event,flush,resize:()=>{resize();flush();}};
}
test('new output, delayed content and keyboard resize keep following until the reader scrolls up',t=>{
  const f=fixture(t),s=f.scroller;
  s.scrollHeight=1500;f.resize();assert.equal(s.scrollTop,1100);
  s.clientHeight=200;f.resize();assert.equal(s.scrollTop,1300);
  f.event('wheel',{deltaY:-200});s.scrollTop=900;f.event('scroll');
  s.scrollHeight=1800;f.resize();assert.equal(s.scrollTop,900);assert.equal(f.button.hidden,false);
  f.button.dispatchEvent(new Event('click'));f.flush();assert.equal(s.scrollTop,1600);assert.equal(f.button.hidden,true);
});
test('touch and keyboard history reading stay put; reaching the bottom or changing chats restores following',t=>{
  const f=fixture(t),s=f.scroller;
  f.event('touchstart',{touches:[{clientY:100}]});f.event('touchmove',{touches:[{clientY:180}]});
  s.scrollTop=300;f.event('scroll');s.scrollHeight=1400;f.resize();assert.equal(s.scrollTop,300);
  s.scrollTop=1000;f.event('scroll');assert.equal(f.follow.following,true);
  f.event('keydown',{key:'PageUp'});s.scrollTop=500;f.event('scroll');f.resize();assert.equal(s.scrollTop,500);
  f.follow.reset();f.flush();assert.equal(s.scrollTop,1000);assert.equal(f.follow.following,true);
});
