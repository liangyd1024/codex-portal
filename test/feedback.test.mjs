import test from 'node:test';
import assert from 'node:assert/strict';
import {createToasts,confirmAction} from '../public/feedback.js';
function dom(){
 const make=(tag,cls='',text='')=>({tag,className:cls,textContent:text,children:[],attrs:{},isConnected:false,
 append(...xs){for(const x of xs){x.parent=this;x.isConnected=true;this.children.push(x);}},
 setAttribute(k,v){this.attrs[k]=v;},querySelector(tag){return this.children.find(n=>n.tag===tag);},
 remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);},
 focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}});
 return {make,region:make('div')};
}
test('duplicate alerts reuse one card, renew expiry, and can be closed',()=>{
 const {make,region}=dom(),timers=new Map();let id=0;
 const toast=createToasts({region,make,icon:()=>make('svg'),setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id)});
 const first=toast('接管失败',true,8000);assert.equal(toast('接管失败',true,8000),first);assert.equal(region.children.length,1);assert.equal(timers.size,1);
 first.querySelector('button').onclick();assert.equal(region.children.length,0);assert.equal(timers.size,0);
 toast('失败',true);[...timers.values()][0]();assert.equal(region.children.length,0);
});
test('an operation replaces its old result and external removal cannot retain a stale toast',()=>{
 const {make,region}=dom();const toast=createToasts({region,make,icon:()=>make('svg'),setTimer:()=>0,clearTimer:()=>{}});
 const old=toast('失败',true,0,'takeover');const next=toast('成功',false,0,'takeover');assert.equal(old.isConnected,false);assert.equal(region.children.length,1);assert.equal(next.attrs.role,'status');
 next.remove();const retry=toast('再次接管',false,0,'takeover');assert.notEqual(retry,next);assert.equal(region.children.length,1);
});
test('confirmation defaults to cancel, Escape cancels, and explicit confirm resolves once',async t=>{
 const previous=globalThis.document,{make,region}=dom(),anchor=make('button');anchor.isConnected=true;
 globalThis.document={createElement:make,body:region,activeElement:anchor};t.after(()=>{globalThis.document=previous;});
 const first=confirmAction('停止服务',{danger:true});const d=region.children[0];assert.equal(d.children[2].children[0].focused,true);
 assert.equal(await confirmAction('重复'),false);d.oncancel({preventDefault(){}});assert.equal(await first,false);assert.equal(anchor.focused,true);assert.equal(region.children.length,0);
 const second=confirmAction('导入',{accept:'确认导入'});region.children[0].children[2].children[1].onclick();assert.equal(await second,true);assert.equal(region.children.length,0);
});
