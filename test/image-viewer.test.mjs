import test from 'node:test';
import assert from 'node:assert/strict';
import {imageViewLimits,constrainImageView,zoomImageView,openImageViewer} from '../public/image-viewer.js';
const size={width:1000,height:700,imageWidth:2400,imageHeight:10560};
test('long images open at readable width from the top and remain reachable when panning',()=>{
 const view=constrainImageView({scale:imageViewLimits(size).width,x:0,y:0},size);
 assert.equal(view.scale*size.imageWidth,1000);assert.equal(view.x,0);assert.equal(view.y,0);
 const end=constrainImageView({...view,x:-10000,y:-10000},size);
 assert.equal(end.x,0);assert.equal(end.y,700-4400);
 assert.equal(constrainImageView({...view,y:1000},size).y,0);
});
test('zoom preserves the image point under the pointer and permits original size and detail zoom',()=>{
 const view={scale:.5,x:-100,y:-500},anchor={x:350,y:250};
 const next=zoomImageView(view,1,anchor,size);
 assert.equal((anchor.x-next.x)/next.scale,(anchor.x-view.x)/view.scale);
 assert.equal((anchor.y-next.y)/next.scale,(anchor.y-view.y)/view.scale);
 assert.equal(zoomImageView(next,100,anchor,size).scale,4);
 assert.equal(zoomImageView(next,0,anchor,size).scale,imageViewLimits(size).min);
});
test('small images center without upscaling and mobile resize constrains pan without losing zoom',()=>{
 const small={width:800,height:600,imageWidth:200,imageHeight:100};
 assert.deepEqual(constrainImageView({scale:1,x:-50,y:-60},small),{scale:1,x:300,y:250});
 const mobile={...size,width:364,height:680};
 const view=constrainImageView({scale:1,x:-2300,y:-10000},mobile);
 assert.deepEqual(view,{scale:1,x:364-2400,y:680-10560});
 const fit=constrainImageView({scale:imageViewLimits(mobile).width,x:0,y:0},mobile);
 assert.ok(Math.abs(fit.scale*2400-364)<1e-8);assert.equal(fit.y,0);
});
test('viewer keeps recovery and close available while loading, retries failures and releases resources',t=>{
 const previous=Object.fromEntries(['document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
 t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 let disconnected=false,cancelled=false,focused=false;
 class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.style={};this.events={};this.attrs={};this.clientWidth=1000;this.clientHeight=700;this.naturalWidth=2400;this.naturalHeight=10560;}
  append(...children){this.children.push(...children);}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(event,fn){this.events[event]=fn;}
  showModal(){this.open=true;}
  focus(){}
  remove(){this.removed=true;}
  close(){this.open=false;this.events.close();}
 }
 globalThis.document={createElement:tag=>new Element(tag),body:new Element('body')};
 globalThis.ResizeObserver=class{observe(){}disconnect(){disconnected=true;}};
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{cancelled=true;};
 const dialog=openImageViewer({src:'/test-image.png',alt:'测试图片'},{isConnected:true,focus(){focused=true;}});
 const [toolbar,stage]=dialog.children,[image,status,retry]=stage.children;
 const controls=toolbar.children.filter(n=>n.tagName==='button'),close=controls.at(-1);
 assert.ok(controls.slice(0,-1).every(n=>n.disabled));assert.ok(!close.disabled);
 image.onerror();assert.equal(retry.hidden,false);assert.match(status.textContent,/重试/);
 retry.onclick();assert.equal(retry.hidden,true);assert.equal(image.src,'/test-image.png');
 image.onload();assert.equal(status.hidden,true);assert.equal(image.hidden,false);assert.ok(controls.every(n=>!n.disabled));
 close.onclick();assert.ok(dialog.removed&&disconnected&&cancelled&&focused);
 image.onerror();assert.equal(status.hidden,true);
});
