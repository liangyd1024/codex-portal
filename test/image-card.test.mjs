import test from 'node:test';
import assert from 'node:assert/strict';
import {imageCard} from '../public/message-media.js';
function setup(t,src='/api/image?host=local#image') {
 const previous=globalThis.document;
 class Node {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.isConnected=true;}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(){}
 }
 globalThis.document={createElement:tag=>new Node(tag)};
 t.after(()=>{globalThis.document=previous;});
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const card=imageCard(src),[button,status,retry]=card.children,image=button.children[0];
 return {card,button,status,retry,image};
}
test('transient failure retries without user input and stops after success',t=>{
 const {image,status,retry,button}=setup(t);const initial=image.src;
 image.onerror();assert.equal(retry.hidden,true);assert.equal(button.disabled,true);
 t.mock.timers.tick(499);assert.equal(image.src,initial);
 t.mock.timers.tick(1);assert.match(image.src,/host=local&retry=.*#image$/);
 image.onload();assert.equal(status.hidden,true);assert.equal(button.disabled,false);
 const loaded=image.src;t.mock.timers.tick(10000);assert.equal(image.src,loaded);
});
test('persistent failures have exactly three automatic retries and allow a fresh manual attempt',t=>{
 const {image,status,retry,button}=setup(t);
 for(const delay of [500,1500,3000]){const before=image.src;image.onerror();t.mock.timers.tick(delay);assert.notEqual(image.src,before);}
 image.onerror();assert.equal(retry.hidden,false);assert.equal(image.hidden,true);assert.equal(button.disabled,true);
 assert.equal(status.textContent,'图片暂时无法加载，请重试。');
 const failed=image.src;t.mock.timers.tick(10000);assert.equal(image.src,failed);
 retry.onclick();assert.equal(retry.hidden,true);assert.equal(image.hidden,false);
 image.onerror();t.mock.timers.tick(500);image.onload();assert.equal(button.disabled,false);
});
test('removed image cards do not issue delayed requests',t=>{
 const {card,image}=setup(t);const initial=image.src;image.onerror();card.isConnected=false;
 t.mock.timers.tick(5000);assert.equal(image.src,initial);
});
test('invalid embedded data does not retry automatically',t=>{
 const {image,retry}=setup(t,'data:image/png;base64,broken');image.onerror();assert.equal(retry.hidden,false);
 t.mock.timers.tick(5000);assert.equal(image.src,'data:image/png;base64,broken');
});
