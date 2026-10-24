import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSendReceipts} from '../public/connection-state.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const sendSource=source.slice(source.indexOf('async function sendMessage('),source.indexOf('async function implementPlan('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const response=deferred(),history=deferred(),errors=[],calls=[];
 const input={value:'中文草稿'},button={disabled:false},drafts=new Map([['a',input.value]]);
 drafts.capture=(id,text)=>({id,text});drafts.acknowledge=sent=>{if(drafts.get(sent.id)!==sent.text)return false;drafts.delete(sent.id);return true;};
 const state={selectedId:'a',selectionVersion:1,busy:new Set(),drafts,detail:{turns:[]}};
 const context={state,newChatOpen:false,targetHost:'local',$:id=>id==='message-input'?input:button,
 annotations:{capture:()=>({items:[]}),acknowledge(){}},annotatedText:text=>text,
 attachments:{has:()=>false,pending:()=>false,capture:()=>({items:[]}),acknowledge(){}},
 usable:()=>true,controlled:()=>true,running:()=>false,touchInput:()=>false,followUpAction:()=>null,
 composer:{validateSend(){},options:()=>({threads:[]}),prepareSend:async()=>false},
 turns:()=>state.detail.turns,sendReceipts:createSendReceipts(),scrollFollow:null,
 renderMessages(){},renderThread(){},resizeInput(){},upsertTurn:turn=>state.detail.turns.push(turn),
 api(){},sendAfterGoal:()=>{calls.push('send');return response.promise;},
 refreshSelected:()=>{calls.push('history');return history.promise;},recordError:error=>errors.push(error),
 action:async(key,fn)=>{state.busy.add(key);try{await fn();}finally{state.busy.delete(key);}},
 };
 vm.createContext(context);vm.runInContext(sendSource,context);
 return {context,state,input,button,response,history,errors,calls,send:()=>context.sendMessage()};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('native acceptance releases send lock while history is still pending; duplicate submission stays blocked',async()=>{
 const f=fixture();let settled=false;const sending=f.send().then(()=>settled=true);await flush();
 assert.equal(f.state.busy.has('message'),true);await f.send();assert.deepEqual(f.calls,['send']);
 f.response.resolve({turn:{id:'t',status:'inProgress',items:[]}});await flush();
 assert.equal(settled,true);assert.equal(f.state.busy.has('message'),false);assert.equal(f.input.value,'');
 assert.deepEqual(f.calls,['send','history']);assert.equal(f.context.sendReceipts.view('local:a',[])[0].status,'accepted');
 f.history.reject(new Error('同步失败'));await flush();assert.equal(f.errors[0].message,'同步失败');assert.equal(f.calls.filter(x=>x==='send').length,1);await sending;
});
test('failed native submission retains draft and does not start history sync',async()=>{
 const f=fixture(),sending=f.send();await flush();f.response.reject(Object.assign(new Error('发送失败'),{status:409}));
 await assert.rejects(sending,/发送失败/);assert.equal(f.input.value,'中文草稿');assert.equal(f.state.busy.size,0);assert.deepEqual(f.calls,['send']);
});
test('changed selection is not rendered or refreshed by late send acknowledgement',async()=>{
 const f=fixture(),sending=f.send();await flush();f.state.selectedId='b';f.state.selectionVersion++;f.input.value='另一会话草稿';
 f.response.resolve({turn:{id:'t',status:'inProgress',items:[]}});await sending;
 assert.equal(f.input.value,'另一会话草稿');assert.deepEqual(f.state.detail.turns,[]);assert.deepEqual(f.calls,['send']);
});
test('text entered while the accepted request is pending survives acknowledgement',async()=>{
 const f=fixture(),sending=f.send();await flush();f.input.value='新的中文草稿';f.state.drafts.set('a',f.input.value);
 f.response.resolve({turn:{id:'t',status:'inProgress',items:[]}});await flush();
 assert.equal(f.input.value,'新的中文草稿');assert.equal(f.state.drafts.get('a'),'新的中文草稿');assert.equal(f.state.busy.size,0);
 f.history.resolve();await sending;
});
