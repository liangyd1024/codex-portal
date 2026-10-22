import test from 'node:test';
import assert from 'node:assert/strict';
import {createSendReceipts} from '../public/connection-state.js';
const content=[{type:'text',text:'追加中文要求'}];
const turn=(id,items)=>({id,items:items.map(id=>({id,type:'userMessage',content}))});
test('steer receipt appears before HTTP and accepts turnId without waiting for history',()=>{
 const r=createSendReceipts(), old=[turn('t',['old'])], pending=r.begin('host:a',content,old);
 assert.equal(r.view('host:a',old)[0].status,'sending');
 r.accept(pending,{turnId:'t'});
 assert.equal(r.view('host:a',old)[0].status,'accepted');
 assert.deepEqual(r.view('host:b',old),[]);
 assert.equal(r.view('host:a',[turn('other',['new'])]).length,1);
 assert.deepEqual(r.view('host:a',[turn('t',['old','new'])]),[]);
 assert.deepEqual(old,[turn('t',['old'])]);
});
test('SSE can confirm before HTTP and repeated identical sends each need a new native item',()=>{
 const r=createSendReceipts(), first=r.begin('a',content,[]), second=r.begin('a',content,[]);
 assert.deepEqual(r.view('a',[turn('t',['1'])]),[second]);
 r.accept(first,{turnId:'t'});r.accept(second,{turnId:'t'});
 assert.deepEqual(r.view('a',[turn('t',['1'])]),[second]);
 assert.deepEqual(r.view('a',[turn('t',['1','2'])]),[]);
});
test('failure and uncertain delivery stay explicit, image content survives, failed retry is replaced',()=>{
 const r=createSendReceipts(), image=[...content,{type:'image',url:'data:image/png;base64,AA=='}];
 const failed=r.begin('a',image,[]);r.fail(failed,{status:409});
 assert.equal(r.view('a',[])[0].status,'failed');
 const retry=r.begin('a',image,[]);r.fail(retry,new Error('offline'));
 assert.equal(r.view('a',[]).length,1);assert.equal(retry.status,'unknown');assert.deepEqual(retry.content,image);
 r.accept(retry,{turn:{id:'t'}});
 assert.deepEqual(r.view('a',[{id:'t',items:[{id:'i',type:'userMessage',content:image}]}]),[]);
});

// Exercise the same goal result -> receipt path used by the composer.
test('confirmed text-only goal removes its echo without a native user message',async()=>{
 const {sendAfterGoal}=await import('../public/goal-submit.js');
 const r=createSendReceipts(),receipt=r.begin('a',content,[]);
 assert.equal(r.view('a',[])[0].status,'sending');
 const result=await sendAfterGoal({goalStarted:true,id:'goal',payload:{text:'追加中文要求'},api:()=>assert.fail('must not send a second message')});
 r.accept(receipt,result);
 assert.deepEqual(r.view('a',[]),[]);
 assert.deepEqual(r.view('a',[{id:'goal-turn',items:[{id:'reply',type:'agentMessage',text:'开始执行'}]}]),[]);
});
test('goal attachments still wait for their own native user message',async()=>{
 const {sendAfterGoal}=await import('../public/goal-submit.js');
 const r=createSendReceipts(),images=[{url:'image'}],input=[...content,{type:'image',url:'image'}],receipt=r.begin('a',input,[]);
 const result=await sendAfterGoal({goalStarted:true,id:'goal',payload:{text:'追加中文要求',images},api:async path=>path.endsWith('/steer')?{turnId:'t'}:{thread:{status:{type:'active'}}}});
 r.accept(receipt,result);
 assert.equal(r.view('a',[])[0].status,'accepted');
 assert.deepEqual(r.view('a',[{id:'t',items:[{id:'image-message',type:'userMessage',content:input}]}]),[]);
});
