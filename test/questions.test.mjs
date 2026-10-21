import test from 'node:test';
import assert from 'node:assert/strict';
import {asyncQuestions,questionReplies,replyText,QuestionDrafts} from '../public/questions.js';
import {Manager} from '../lib/manager.mjs';
const turn=()=>({id:'turn',status:'inProgress',items:[{id:'item',type:'agentMessage',questions:[{title:'验收代号？',options:['甲','乙']},{title:'补充说明？'}]}]});
const request=()=>asyncQuestions([turn()],'thread')[0];
const answers=()=>Object.fromEntries(request().params.questions.map(q=>[q.id,{answers:['网页验证']} ]));
const manager=()=>{const m=new Manager({host:{alias:'test'}}),calls=[];m.connection={state:'connected'};m.controlled.set('thread',{status:{type:'active'}});m.history=async()=>({data:[turn()]});m.rpc={connected:true,request:async(method,params)=>{calls.push({method,params});return {turnId:'turn'};}};return {m,calls};};
test('async questions retain source IDs and only accepted replies resolve them',()=>{
 const t=turn(),r=request();assert.equal(r.params.questions.length,2);assert.deepEqual(JSON.parse(r.params.questions[0].id),['request_user_input_async','item',0]);
 const text=replyText(r.params.questions,answers());assert.equal(questionReplies({type:'userMessage',content:[{type:'text',text}]}).length,2);
 t.items.push({type:'steeringUserMessage',status:'pending',input:[{type:'text',text}]});assert.equal(asyncQuestions([t],'thread').length,1);
 t.items.at(-1).status='accepted';assert.equal(asyncQuestions([t],'thread').length,0);
 assert.equal(asyncQuestions([{...turn(),status:'completed'}],'thread').length,0);
 assert.deepEqual(questionReplies({type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>invalid</send_user_message_question_reply>'}]}),[]);
});
test('question drafts survive refresh, remain scoped and skip never changes an answer',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},r=request();
 const d=new QuestionDrafts(storage,'local');d.set(r,{fields:{one:{text:'未发送'}},skipped:true});
 assert.equal(new QuestionDrafts(storage,'local').get(r).fields.one.text,'未发送');assert.equal(new QuestionDrafts(storage,'remote').get(r).skipped,undefined);
 assert.equal(d.get({...r,threadId:'other'}).skipped,undefined);d.set(r,{skipped:false});assert.equal(d.get(r).fields.one.text,'未发送');
});
test('async answer uses verified question wording and original expected turn, deduplicates success',async()=>{
 const {m,calls}=manager();await m.answerQuestions('thread',{turnId:'turn',itemId:'item',answers:answers()});await m.answerQuestions('thread',{turnId:'turn',itemId:'item',answers:answers()});
 assert.equal(calls.length,1);assert.equal(calls[0].method,'turn/steer');assert.equal(calls[0].params.expectedTurnId,'turn');assert.match(calls[0].params.input[0].text,/验收代号/);
});
test('stale, foreign and incomplete questions cannot be submitted',async()=>{
 const {m,calls}=manager();for(const data of [{turnId:'other',itemId:'item',answers:answers()},{turnId:'turn',itemId:'item',answers:{}},{turnId:'turn',itemId:'foreign',answers:answers()}])await assert.rejects(m.answerQuestions('thread',data));
 m.history=async()=>({data:[{...turn(),status:'completed'}]});await assert.rejects(m.answerQuestions('thread',{turnId:'turn',itemId:'item',answers:answers()}),e=>e.code==='STALE_REQUEST');assert.equal(calls.length,0);
});
test('concurrent answers send once and connection changes during verification abort',async()=>{
 const {m,calls}=manager();let release;m.history=()=>new Promise(r=>{release=()=>r({data:[turn()]});});const data={turnId:'turn',itemId:'item',answers:answers()};const pending=m.answerQuestions('thread',data);await assert.rejects(m.answerQuestions('thread',data),e=>e.code==='SEND_PENDING');m.generation++;release();await assert.rejects(pending,e=>e.code==='CONNECTION_CHANGED');assert.equal(calls.length,0);
});
test('known failure permits retry; unknown outcome does not replay',async()=>{
 const {m}=manager(),data={turnId:'turn',itemId:'item',answers:answers()};let count=0;m.rpc.request=async()=>{count++;throw Object.assign(Error('timeout'),{code:'RPC_TIMEOUT'});};await assert.rejects(m.answerQuestions('thread',data),e=>e.code==='OUTCOME_UNKNOWN');await assert.rejects(m.answerQuestions('thread',data),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(count,1);
 const other=manager();other.m.rpc.request=async()=>{throw Error('temporary failure');};await assert.rejects(other.m.answerQuestions('thread',data));other.m.rpc.request=async()=>({});await other.m.answerQuestions('thread',data);
});
test('HTTP async-answer route retains CSRF protection and awaits engine response',async()=>{
 const {createApp}=await import('../server.mjs'),{EventEmitter}=await import('node:events');class Fake extends EventEmitter{disconnect(){}async answerQuestions(id,data){return {id,item:data.itemId};}}
 const app=createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]])});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{const {token}=await fetch(base+'/api/csrf').then(r=>r.json());const post=csrf=>fetch(base+'/api/threads/thread/question-answer',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf},body:JSON.stringify({itemId:'item'})});assert.equal((await post('')).status,403);assert.deepEqual(await (await post(token)).json(),{id:'thread',item:'item'});}finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});
test('native async question events publish attention for other chats and accepted answers clear it',()=>{
 const {m}=manager(),events=[];m.on('event',e=>events.push(e));
 const p={threadId:'thread',turnId:'turn',item:turn().items[0]};
 m.onNotification({method:'item/started',params:p});m.onNotification({method:'item/completed',params:p});
 assert.equal(m.status().pendingRequests.length,1);
 assert.equal(events.filter(e=>e.method==='manager/request').length,1);
 const text=replyText(request().params.questions,answers());
 m.onNotification({method:'item/completed',params:{...p,item:{type:'steeringUserMessage',status:'pending',input:[{type:'text',text}]}}});
 assert.equal(m.status().pendingRequests.length,1);
 m.onNotification({method:'item/completed',params:{...p,item:{type:'steeringUserMessage',status:'accepted',input:[{type:'text',text}]}}});
 assert.equal(m.status().pendingRequests.length,0);
 assert.equal(events.filter(e=>e.method==='manager/requestResolved').length,1);
 m.onNotification({method:'item/completed',params:p});assert.equal(m.status().pendingRequests.length,0,'late item completion cannot revive answered question');
 m.onNotification({method:'item/completed',params:{...p,item:{...p.item,id:'next-question'}}});
 m.onNotification({method:'turn/completed',params:{threadId:'other',turn:{id:'turn',status:'completed'}}});
 assert.equal(m.status().pendingRequests.length,1);
 m.onNotification({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});
 assert.equal(m.status().pendingRequests.length,0);
});
test('reconnect reads full active history to recover unanswered questions, not old answered questions',async()=>{
 const {m}=manager();m.subscriptions.set('thread',{});m.service={};const active=turn();
 m.rpc.request=async(method,p)=>method==='thread/goal/get'?{goal:null}:p.itemsView==='full'?{data:[active]}:{data:[{id:'turn',status:'inProgress'}]};
 await m.recoverNotices(m.rpc,'thread',0);assert.equal(m.status().pendingRequests.length,1);
});
