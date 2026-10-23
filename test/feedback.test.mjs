import test from 'node:test';
import assert from 'node:assert/strict';
import {createToasts,confirmAction,createStopFeedback,copyText} from '../public/feedback.js';
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
test('success and progress never create cards or timers, including after an error',()=>{
 const {make,region}=dom();let timers=0;
 const toast=createToasts({region,make,icon:()=>make('svg'),setTimer:()=>++timers,clearTimer:()=>{}});
 for(const message of ['成功','正在归档会话…','已连接'])assert.equal(toast(message),undefined);
 assert.equal(region.children.length,0);assert.equal(timers,0);
 const old=toast('失败',true,0,'archive');toast('成功',false,0,'archive');
 assert.equal(old.isConnected,false);assert.equal(region.children.length,0);assert.equal(timers,1);
 const next=toast('再次失败',true,0,'archive');next.remove();
 assert.notEqual(toast('再次失败',true,0,'archive'),next);assert.equal(region.children.length,1);
});
test('explicitly requested account information remains available without enabling operation tips',()=>{
 const {make,region}=dom();const toast=createToasts({region,make,icon:()=>make('svg'),setTimer:()=>0,clearTimer:()=>{}});
 toast('额度详情',false,3000,'account-usage',{information:true});assert.equal(region.children.length,1);
 toast('操作成功');assert.equal(region.children.length,1);
});
test('confirmation defaults to cancel, Escape cancels, and explicit confirm resolves once',async t=>{
 const previous=globalThis.document,{make,region}=dom(),anchor=make('button');anchor.isConnected=true;
 globalThis.document={createElement:make,body:region,activeElement:anchor};t.after(()=>{globalThis.document=previous;});
 const first=confirmAction('停止服务',{danger:true});const d=region.children[0];assert.equal(d.children[2].children[0].focused,true);
 assert.equal(await confirmAction('重复'),false);d.oncancel({preventDefault(){}});assert.equal(await first,false);assert.equal(anchor.focused,true);assert.equal(region.children.length,0);
 const second=confirmAction('导入',{accept:'确认导入'});region.children[0].children[2].children[1].onclick();assert.equal(await second,true);assert.equal(region.children.length,0);
});
test('all floating tips expire after three seconds regardless of legacy duration',()=>{
 const {make,region}=dom(),scheduled=[];
 const toast=createToasts({region,make,icon:()=>make('svg'),setTimer:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},clearTimer:()=>{}});
 for(const duration of [undefined,0,7500,8000,11000]){
  const card=toast('提示 '+duration,true,duration);assert.equal(scheduled.at(-1).ms,3000);
  assert.equal(card.isConnected,true);scheduled.at(-1).fn();assert.equal(card.isConnected,false);
 }
 const card=toast('重复提示',true);assert.equal(toast('重复提示',true),card);assert.equal(scheduled.at(-1).ms,3000);
});


test('stop feedback waits for native confirmation and isolates sessions and turns',()=>{
 const f=createStopFeedback(),key='local:one';
 const request=f.begin(key,'turn-a');
 const idle={confirmed:true,status:'idle',turns:[]};
 assert.equal(f.observe(key,idle),true); // HTTP is still in flight.
 assert.equal(f.observe('local:two',idle),false);
 f.settle(key,request);
 assert.equal(f.observe(key,{...idle,confirmed:false}),true);
 assert.equal(f.observe(key,{confirmed:true,status:'active',turns:[{id:'turn-a',status:'inProgress'}]}),true);
 assert.equal(f.observe(key,{confirmed:true,status:'active',turns:[{id:'turn-a',status:'interrupted'},{id:'turn-b',status:'inProgress'}]}),false);
});
test('stop feedback retains unknown outcomes and background activity, but allows retry after rejection',()=>{
 const f=createStopFeedback();let r=f.begin('one','turn');
 f.settle('one',r,new Error('network unavailable'));assert.equal(f.has('one'),true);
 assert.equal(f.observe('one',{confirmed:true,status:'unknown'}),true);
 assert.equal(f.observe('one',{confirmed:true,status:'idle'}),false);
 r=f.begin('one','turn');f.settle('one',r,{status:409});assert.equal(f.has('one'),false);
 r=f.begin('one',null,true);f.settle('one',r);
 for(const background of ['running','unknown'])assert.equal(f.observe('one',{confirmed:true,status:'idle',background}),true);
 assert.equal(f.observe('one',{confirmed:true,status:'idle',background:'idle'}),false);
 const old=f.begin('one','old'),next=f.begin('one','new');f.settle('one',old,{status:409});assert.equal(f.has('one'),true);f.settle('one',next);
});
test('copy feedback expires locally, blocks duplicate clicks, and preserves failures',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');let finish,calls=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:()=>{calls++;return new Promise(resolve=>finish=resolve);}}}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;});
 const button={disabled:false},status={textContent:''};
 const work=copyText('text',{button,status});await copyText('text',{button,status});assert.equal(calls,1);assert.equal(status.textContent,'正在复制…');
 finish();await work;assert.equal(status.textContent,'已复制');assert.equal(button.disabled,false);
 t.mock.timers.tick(1999);assert.equal(status.textContent,'已复制');t.mock.timers.tick(1);assert.equal(status.textContent,'');
 navigator.clipboard.writeText=async()=>{};await copyText('text',{button,status});
 navigator.clipboard.writeText=async()=>{throw Error('denied');};await copyText('text',{button,status});
 t.mock.timers.tick(2000);assert.match(status.textContent,/无法自动复制/);assert.equal(button.disabled,false);
});
