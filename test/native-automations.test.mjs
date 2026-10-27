import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeAutomations} from '../lib/native-automations.mjs';
import {scheduleLabel} from '../public/automations.js';
const id='00000000-0000-0000-0000-000000000001',mid='00000000-0000-0000-0000-000000000002',tid='00000000-0000-0000-0000-000000000003';
function fixture(){
 const m={controlled:new Set(),subscriptions:new Map(),mutations:0,saveState(){},passive:async(action)=>action==='history'?{data:[]}:{thread:{id,activity:{state:'idle'}}}};
 const a=new NativeAutomations(m);a.state.threadId=id;const calls=[];
 a.call=async(script,payload)=>{calls.push(payload);return payload.action==='send'?{result:{result:{turn:{id:tid}}}}:{settings:{settings:{model:'native'}}};};
 return {a,m,calls};
}
test('native send deduplicates accepted IDs and preserves desktop model inheritance',async()=>{
 const {a,m,calls}=fixture(),request={threadId:id,messageId:mid,text:'create task'};
 assert.equal((await a.send(request)).turnId,tid);assert.equal((await a.send(request)).turnId,tid);
 assert.equal(calls.filter(c=>c.action==='send').length,1);assert.equal(m.mutations,0);
 await assert.rejects(a.send({...request,text:'different'}),/不同消息/);
});
test('lost reply blocks retry until native history confirms clientId',async()=>{
 const {a,m}=fixture();a.call=async(_s,p)=>{if(p.action==='send')throw Error('lost');return {};};
 const req={threadId:id,messageId:mid,text:'create task'};await assert.rejects(a.send(req),/lost/);
 assert.equal(a.state.submissions[mid].status,'unknown');assert.equal(m.mutations,0);
 await assert.rejects(a.send(req),/尚未确认/);
 m.passive=async action=>action==='history'?{data:[{id:tid,items:[{type:'userMessage',clientId:mid}]}]}:{thread:{id,activity:{state:'idle'}}};
 await a.detail();assert.equal((await a.send(req)).turnId,tid);
});
test('concurrent sends and changed binding cannot dispatch twice',async()=>{
 const {a,calls}=fixture();let release;a.detail=()=>new Promise(r=>release=r);
 const one=a.send({threadId:id,messageId:mid,text:'a'});
 await assert.rejects(a.send({threadId:id,messageId:tid,text:'b'}),/确认中/);
 a.state.threadId=tid;release({desktop:{canSend:true}});await assert.rejects(one,/状态未确认/);
 assert.equal(calls.length,0);
});
test('busy or unobserved desktop never sends or falls back to engine',async()=>{
 for(const activity of [{state:'running'},undefined]){
  const {a,m,calls}=fixture();m.passive=async action=>action==='history'?{data:[]}:{thread:{id,activity}};
  await assert.rejects(a.send({threadId:id,messageId:mid,text:'task'}),/状态未确认/);
  assert.equal(calls.filter(p=>p.action==='send').length,0);
 }
});
test('binding refuses controlled and archived conversations',async()=>{
 const {a,m}=fixture();m.controlled.add(id);await assert.rejects(a.bind(id),/网页引擎控制/);
 m.controlled.clear();m.passive=async()=>({thread:{archived:true}});await assert.rejects(a.bind(id),/恢复此会话/);
});
test('only bound conversation can be interrupted with expected turn',async()=>{
 const {a,calls,m}=fixture();await assert.rejects(a.interrupt({threadId:tid,turnId:tid}));
 await a.interrupt({threadId:id,turnId:tid});assert.deepEqual(calls[0],{action:'interrupt',threadId:id,turnId:tid});assert.equal(m.mutations,0);
});
test('schedule labels avoid claiming simple daily schedule for complex rules',()=>{
 assert.equal(scheduleLabel('FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0'),'每天 08:00、20:00');
 assert.equal(scheduleLabel('FREQ=DAILY;INTERVAL=2;BYHOUR=8'),'自定义安排');
 assert.equal(scheduleLabel('FREQ=DAILY;BYHOUR=8;BYMINUTE=10,30'),'自定义安排');
});

test('native HTTP routes keep CSRF, Origin and host isolation',async()=>{
 const {Manager}=await import('../lib/manager.mjs');const {createApp}=await import('../server.mjs');
 const calls=[];const make=host=>new Manager({host:{id:host,kind:'local'},remote:async()=>{calls.push(host);return {available:true};}});
 const one=make('one'),two=make('two');for(const m of [one,two])m.passive=async()=>({thread:{id,archived:false}});
 const {server}=await createApp({config:{defaultConnection:'one'},managers:new Map([['one',one],['two',two]])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const url=base+'/api/automations/binding?host=two',body=JSON.stringify({threadId:id});
  assert.equal((await fetch(url,{method:'POST',body})).status,403);
  const {token}=await fetch(base+'/api/csrf').then(r=>r.json());const options={method:'POST',headers:{'x-csrf-token':token},body};
  assert.equal((await fetch(url,{...options,headers:{...options.headers,origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(url,options)).status,200);assert.deepEqual(calls,['two']);
  assert.equal((await fetch(base+'/api/threads/'+id+'/takeover?host=two',options)).status,409);
  assert.equal((await fetch(base+'/api/automations/history?host=two&threadId='+tid)).status,409);
  assert.equal((await fetch(base+'/automations.js')).status,200);assert.equal((await fetch(base+'/automations.css')).status,200);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});


test('management binding is fixed after first selection',async()=>{
 const {a,calls}=fixture();a.state.threadId=null;
 await a.bind(id);assert.equal(a.state.threadId,id);const previous=calls.length;
 await assert.rejects(a.bind(tid),e=>e.code==='DESKTOP_BINDING_FIXED');
 assert.equal(a.state.threadId,id);assert.equal(calls.length,previous);
});

test('desktop active sends use native follower steering and preserve the original conversation',async()=>{
 const {a,m,calls}=fixture();
 m.passive=async action=>action==='history'?{data:[{id:tid,status:'inProgress',items:[]}]}:{thread:{id,cwd:'/test/project',activity:{state:'running'}}};
 a.call=async(_s,p)=>{calls.push(p);return p.action==='send'?{result:{result:{turnId:tid}}}:{};};
 const d=await a.detail();assert.equal(d.desktop.canSend,true);assert.equal(d.controlled,false);
 await a.send({threadId:id,messageId:mid,text:'补充要求'});
 assert.deepEqual(calls.find(p=>p.action==='send'),{action:'send',threadId:id,messageId:mid,text:'补充要求',steer:true,cwd:'/test/project'});
});
test('desktop answers validate original questions, steer the reply and deduplicate after acceptance',async()=>{
 const {a,m,calls}=fixture();const item={id:'question',type:'agentMessage',questions:[{title:'选择方式',options:['方案一','方案二']}]};
 m.passive=async action=>action==='history'?{data:[{id:tid,status:'inProgress',items:[item]}]}:{thread:{id,cwd:'/test/project',activity:{state:'running'}}};
 const {asyncQuestions}=await import('../shared/questions.js');const question=asyncQuestions([{id:tid,status:'inProgress',items:[item]}],id)[0];
 const data={threadId:id,turnId:tid,itemId:item.id,answers:{[question.params.questions[0].id]:{answers:['方案二']}}};
 await assert.rejects(a.answerQuestions({...data,itemId:'unrelated'}),e=>e.code==='STALE_REQUEST');
 await assert.rejects(a.answerQuestions({...data,answers:{}}),/所有问题/);
 await a.answerQuestions(data);await a.answerQuestions(data);
 const sent=calls.filter(p=>p.action==='send');assert.equal(sent.length,1);assert.equal(sent[0].questionReply,true);assert.equal(sent[0].steer,true);assert.match(sent[0].text,/send_user_message_question_reply/);assert.match(sent[0].text,/方案二/);
});
test('desktop recovery is explicit, rejects controlled/archived threads, and never dispatches a message',async()=>{
 const {a,m,calls}=fixture();await a.recover();assert.equal(calls[0].action,'recover');assert.equal(m.mutations,0);assert.equal(a.pending,false);
 m.controlled.add(id);await assert.rejects(a.recover(),/交还/);m.controlled.clear();
 m.passive=async()=>({thread:{id,archived:true}});await assert.rejects(a.recover(),/归档/);assert.equal(m.mutations,0);assert.equal(calls.some(p=>p.action==='send'),false);
});
test('undelivered native request clears receipt; lost write reply remains blocked',async()=>{
 const {a}=fixture();a.call=async(_s,p)=>{if(p.action==='send')throw Object.assign(Error('not routed'),{code:'DESKTOP_NOT_SENT'});return {};};
 await assert.rejects(a.send({threadId:id,messageId:mid,text:'draft'}),/not routed/);assert.equal(a.unconfirmed(),undefined);
});
