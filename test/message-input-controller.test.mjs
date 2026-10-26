import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {shouldSendOnEnter} from '../public/input-state.js';
const source=readFileSync(new URL('../src/web/services/message-input.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createMessageInput}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(){
 const input=new EventTarget();Object.assign(input,{value:'draft',clientWidth:300,scrollHeight:45,style:{}});const form={},saved=[],sent=[];let id='a',suspended=false,touch=false,now=100,canSend=true,renders=0,reads=0,font='16px system-ui';
 const queued=[];
 const controller=createMessageInput({input:()=>input,id:()=>id,suspended:()=>suspended,persist:(...v)=>saved.push(v),render:()=>renders++,send:(...v)=>sent.push(v),steerQueued:()=>queued.push(true),canSend:()=>canSend,touch:()=>touch,shouldSend:(e,s)=>shouldSendOnEnter(e,{...s,now}),now:()=>now,style:()=>{reads++;return{font,lineHeight:'26px'};}});controller.bind(form);
 const key=(props={})=>{let prevented=false;input.onkeydown({key:'Enter',preventDefault:()=>{prevented=true;},...props});return prevented;};
 return{input,form,saved,sent,queued,controller,key,renders:()=>renders,reads:()=>reads,set:v=>{if('id'in v)id=v.id;if('suspended'in v)suspended=v.suspended;if('touch'in v)touch=v.touch;if('now'in v)now=v.now;if('canSend'in v)canSend=v.canSend;if('font'in v)font=v.font;}};
}
test('empty composer modified Enter guides queued input even when draft send is disabled',()=>{
 const f=fixture();f.input.value=' \n';f.set({canSend:false});
 for(const props of [{ctrlKey:true},{metaKey:true}])f.key(props);
 assert.equal(f.queued.length,2);assert.equal(f.sent.length,0);
 for(const props of [{},{ctrlKey:true,repeat:true},{ctrlKey:true,altKey:true},{ctrlKey:true,shiftKey:true},{ctrlKey:true,isComposing:true},{ctrlKey:true,keyCode:229}])f.key(props);
 f.input.dispatchEvent(new Event('compositionstart'));f.key({ctrlKey:true});f.input.dispatchEvent(new Event('compositionend'));f.key({ctrlKey:true});
 f.set({now:151});f.input.disabled=true;f.key({ctrlKey:true});assert.equal(f.queued.length,2);
 f.input.disabled=false;f.input.value='新草稿';f.set({canSend:true});f.key({ctrlKey:true});assert.equal(f.queued.length,2);assert.deepEqual(f.sent,[[undefined,true]]);
});
test('composition candidates and mobile Enter never send; desktop modifiers preserve alternate sends',()=>{
 const f=fixture();f.input.dispatchEvent(new Event('compositionstart'));assert.equal(f.key(),false);f.input.dispatchEvent(new Event('compositionend'));f.set({now:150});assert.equal(f.key(),false);f.set({now:151});assert.equal(f.key({ctrlKey:true,metaKey:false}),true);assert.deepEqual(f.sent,[[undefined,true]]);
 for(const props of [{shiftKey:true},{isComposing:true},{keyCode:229}])assert.equal(f.key(props),false);
 f.set({touch:true});assert.equal(f.key(),false);f.set({touch:false});for(const props of [{repeat:true},{altKey:true}])assert.equal(f.key(props),true);f.set({canSend:false});assert.equal(f.key(),true);assert.equal(f.sent.length,1);
});
test('draft writes follow current identity and suspension; form receives the original submit event',()=>{
 const f=fixture();f.input.oninput();f.set({id:'b'});f.input.value='new';f.input.oninput();f.set({suspended:true});f.input.oninput();f.set({suspended:false,id:null});f.input.oninput();assert.deepEqual(f.saved,[['a','draft'],['b','new']]);assert.equal(f.renders(),4);const event={preventDefault(){}};f.form.onsubmit(event);assert.equal(f.sent[0][0],event);
});
test('resize retains node and value, skips hidden inputs, and clamps height with overflow',()=>{
 const f=fixture(),node=f.input;f.input.clientWidth=0;f.controller.resize();assert.equal(f.reads(),0);f.input.clientWidth=300;f.input.scrollHeight=20;f.controller.resize();assert.deepEqual(f.input.style,{height:'34px',overflowY:'hidden'});f.input.scrollHeight=240;f.controller.resize();assert.equal(f.input.style.height,'34px');f.input.value+='\nmore';f.controller.resize();assert.deepEqual(f.input.style,{height:'160px',overflowY:'auto'});f.input.scrollHeight=70;f.set({font:'17px system-ui'});f.controller.resize();assert.deepEqual(f.input.style,{height:'70px',overflowY:'hidden'});assert.equal(f.input,node);assert.equal(f.input.value,'draft\nmore');
});

test('empty input remeasures when placeholder wraps or becomes short again',()=>{
 const f=fixture();f.input.value='';f.input.placeholder='发送消息…';f.input.scrollHeight=48;f.controller.resize();
 f.input.placeholder='发送消息，输入 / 选择技能，@ 引用会话或插件…';f.input.scrollHeight=72;f.controller.resize();
 assert.equal(f.input.style.height,'72px');assert.equal(f.input.value,'');
 f.input.placeholder='发送消息…';f.input.scrollHeight=48;f.controller.resize();assert.equal(f.input.style.height,'48px');
});
