import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {createPushKeys,sendPush} from '../lib/web-push.mjs';
import {createECDH,createHmac,createDecipheriv} from 'node:crypto';
const source=readFileSync(new URL('../src/server/services/push-notifications.ts',import.meta.url),'utf8').replaceAll("'../../../shared/notification-text.js'",JSON.stringify(new URL('../shared/notification-text.js',import.meta.url).href)).replaceAll("'../../../lib/web-push.mjs'",JSON.stringify(new URL('../lib/web-push.mjs',import.meta.url).href)).replaceAll("'../../../shared/questions.js'",JSON.stringify(new URL('../shared/questions.js',import.meta.url).href)).replaceAll("'../../../shared/connection-state.js'",JSON.stringify(new URL('../shared/connection-state.js',import.meta.url).href));
const {PushNotifications}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const subscription=()=>({endpoint:'https://web.push.apple.com/device',keys:{p256dh:createPushKeys().publicKey,auth:Buffer.alloc(16,1).toString('base64url')}});
const complete=(id='turn')=>({method:'turn/completed',params:{threadId:'thread',turn:{id,status:'completed'}}});
function fixture(send=async()=>201,read){const file=path.join(mkdtempSync(path.join(tmpdir(),'portal-push-')),'push.json');const access={sessions:{owner:null}};const push=new PushNotifications(file,access,send,read);push.subscribe('host','owner','https://portal.example.com',subscription());return {file,access,push,state:()=>JSON.parse(readFileSync(file,'utf8'))};}
test('device notifications persist and deduplicate across restart',async()=>{let calls=0;const f=fixture(async()=>{calls++;return 201;});try{f.push.receive('other',complete());f.push.receive('host',complete());f.push.receive('host',complete());await f.push.drain();assert.equal(calls,1);f.push.close();const restored=new PushNotifications(f.file,f.access,async()=>{calls++;return 201;});try{restored.receive('host',complete());await restored.drain();assert.equal(calls,1);}finally{restored.close();}}finally{f.push.close();}});
test('revocation drops queued notifications; expiry and unsubscribe stop delivery',async()=>{let calls=0;const f=fixture(async()=>{calls++;return 201;});try{f.push.receive('host',complete());delete f.access.sessions.owner;await f.push.drain();assert.equal(calls,0);assert.equal(Object.keys(f.state().devices).length,0);}finally{f.push.close();}});
test('transient push failure queues bounded retry, gone endpoint removes subscription',async()=>{const f=fixture(async()=>503);try{f.push.receive('host',complete());await f.push.drain();const jobs=Object.values(f.state().jobs);assert.equal(jobs.length,1);assert.equal(jobs[0].attempt,1);assert.ok(jobs[0].next>Date.now());}finally{f.push.close();}const g=fixture(async()=>410);try{g.push.receive('host',complete());await g.push.drain();assert.equal(Object.keys(g.state().devices).length,0);}finally{g.push.close();}});
test('desktop history establishes baseline and notifies only a new native terminal turn',async()=>{let calls=0;const f=fixture(async()=>{calls++;return 201;});try{f.push.observe('host','thread',[{id:'old',status:'completed'},{id:'new',status:'inProgress'}]);await f.push.drain();assert.equal(calls,0);f.push.observe('host','thread',[{id:'old',status:'completed'},{id:'new',status:'completed'}]);await f.push.drain();assert.equal(calls,1);f.push.observe('host','thread',[{id:'new',status:'completed'}]);await f.push.drain();assert.equal(calls,1);}finally{f.push.close();}});

const questionTurn=(items)=>({id:'active',status:'inProgress',items});
const questionItem={id:'question-item',type:'agentMessage',questions:[{title:'请选择关闭方向',options:['向右','向左']}]};
test('native async question observed before or after backgrounding notifies once without a completion',async()=>{
 const sent=[],f=fixture(async(_subscription,payload)=>{sent.push(payload);return 201;});
 try{f.push.observe('host','thread',[questionTurn([])]);f.push.observe('host','thread',[questionTurn([questionItem])]);await f.push.drain();assert.equal(sent.length,1);assert.equal(sent[0].title,'会话 thread · 需要你回答');assert.equal(sent[0].body,'请选择关闭方向');f.push.observe('host','thread',[questionTurn([questionItem])]);await f.push.drain();assert.equal(sent.length,1);}finally{f.push.close();}
});
test('first read catches a pending question but accepted replies and finished turns never notify',async()=>{
 let sent=0;const f=fixture(async()=>{sent++;return 201;});
 try{const reply={type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>'+JSON.stringify({questionItemId:JSON.stringify(['request_user_input_async','question-item',0]),question:'请选择关闭方向',answer:'向右'})+'</send_user_message_question_reply>'}]};f.push.observe('host','answered',[questionTurn([questionItem,reply])]);f.push.observe('host','finished',[{...questionTurn([questionItem]),status:'completed'}]);await f.push.drain();assert.equal(sent,0);f.push.observe('host','pending',[questionTurn([questionItem])]);await f.push.drain();assert.equal(sent,1);}finally{f.push.close();}
});

test('test delivery carries the requested session and rejects malformed session identifiers',async()=>{const sent=[],f=fixture(async(_s,payload)=>{sent.push(payload);return 201;});try{const endpoint=Object.values(f.state().devices)[0].subscription.endpoint;const threadId='00000000-0000-4000-8000-000000000001';await f.push.test('host','owner',endpoint,'fixture-test-12345',threadId);assert.equal(sent[0].data.threadId,threadId);await assert.rejects(f.push.test('host','owner',endpoint,'fixture-test-12345','../bad'),/会话标识/);}finally{f.push.close();}});

test('navigation traces are bounded, owner-isolated and omit endpoints, keys and message content',()=>{
 const f=fixture();try{
  for(let i=0;i<170;i++)f.push.trace('host','owner',{stage:'page-target',threadId:'t'+i,endpoint:subscription().endpoint,body:'private text',keys:{auth:'secret'},version:'page-3'});
  f.push.trace('host','another',{stage:'page-ready',threadId:'other'});
  const rows=f.push.traces('owner');assert.equal(f.push.traces().length,160);assert.equal(rows.length,159);assert.equal(rows.at(-1).threadId,'t169');
  assert.equal(JSON.stringify(rows).includes('private text'),false);assert.equal(JSON.stringify(rows).includes('push.apple.com'),false);assert.ok(rows[0].device);assert.equal(Object.hasOwn(rows[0],'owner'),false);
  assert.throws(()=>f.push.trace('host','owner',{stage:'arbitrary'}),/阶段无效/);
 }finally{f.push.close();}
});

test('renewed subscriptions for one pairing replace endpoints and preserve successful claims',async()=>{
 const sent=[],f=fixture(async(sub,p)=>{sent.push({endpoint:sub.endpoint,p});return 201;});
 try{
  f.push.receive('host',complete('first'));await f.push.drain();
  for(let i=0;i<4;i++)f.push.subscribe('host','owner','https://portal.example.com',{...subscription(),endpoint:'https://web.push.apple.com/new-'+i});
  assert.equal(f.push.devices('host').length,1);
  f.push.receive('host',complete('first'));f.push.receive('host',complete('second'));await f.push.drain();
  assert.equal(sent.length,2);assert.match(sent[1].endpoint,/new-3$/);
 }finally{f.push.close();}
});
test('endpoint rotation transfers a pending job once; independent identities and local browsers retain delivery',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return 201;});
 try{
  f.push.receive('host',complete());f.push.subscribe('host','owner','https://portal.example.com',{...subscription(),endpoint:'https://web.push.apple.com/rotated'});await f.push.drain();assert.equal(calls,1);
  f.access.sessions.second=null;
  for(const [owner,origin,suffix] of [['second','https://portal.example.com','second'],['owner','https://other.example.com','origin'],['local','http://localhost','local1'],['local','http://localhost','local2']])f.push.subscribe('host',owner,origin,{...subscription(),endpoint:'https://web.push.apple.com/'+suffix});
  f.push.receive('host',complete('next'));await f.push.drain();assert.equal(calls,6);
 }finally{f.push.close();}
});
test('legacy duplicate subscriptions migrate to one receiver without replaying previous claims',async()=>{
 const {writeFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');
 const f=fixture();f.push.close();const state=f.state(),old=Object.values(state.devices)[0],key=JSON.stringify(['host','thread','turn','already']);state.devices={};state.seen={};
 for(let i=0;i<4;i++){const endpoint='https://web.push.apple.com/legacy-'+i,id=createHash('sha256').update('host\0'+endpoint).digest('hex');state.devices[id]={...old,updatedAt:undefined,subscription:{...old.subscription,endpoint}};state.seen[id+':'+key]=Date.now();}
 writeFileSync(f.file,JSON.stringify(state));const sent=[],p=new PushNotifications(f.file,f.access,async(s)=>{sent.push(s.endpoint);return 201;});
 try{assert.equal(p.devices('host').length,1);p.receive('host',complete('already'));p.receive('host',complete('new'));await p.drain();assert.equal(sent.length,1);assert.match(sent[0],/legacy-3$/);}finally{p.close();}
});
test('content uses native final answer and thread name, shares one lookup across receivers and excludes replay',async()=>{
 const f=fixture();f.push.close();let reads=0;const sent=[];
 const p=new PushNotifications(f.file,f.access,async(s,payload)=>{sent.push(payload);return 201;},undefined,async(host,id,turnId)=>{reads++;assert.equal(turnId,'result');return {name:'修复手机通知',turn:{id:turnId,status:'completed',items:[{type:'agentMessage',phase:'commentary',text:'正在工作'},{type:'agentMessage',phase:'final_answer',text:'已修复 **重复推送**，保留一份订阅。'}]}};});
 try{p.subscribe('host','local','http://localhost',{...subscription(),endpoint:'https://web.push.apple.com/local'});p.receive('host',{...complete('replayed'),replayed:true});p.receive('host',complete('result'));await p.drain();assert.equal(reads,1);assert.equal(sent.length,2);assert.equal(sent[0].title,'修复手机通知 · 本次执行已完成');assert.equal(sent[0].body,'已修复 重复推送，保留一份订阅。');assert.equal(sent[0].data.threadId,'thread');}finally{p.close();}
});
test('context failure and unrelated native history cannot block or mislabel a notification',async()=>{
 for(const detail of [new Error('offline'),{name:'测试会话',turn:{id:'different',items:[{type:'agentMessage',text:'不可使用的回复'}]}}]){
  const f=fixture();f.push.close();const sent=[],p=new PushNotifications(f.file,f.access,async(s,p)=>{sent.push(p);return 201;},undefined,async()=>{if(detail instanceof Error)throw detail;return detail;});
  try{p.receive('host',complete());await p.drain();assert.equal(sent.length,1);assert.doesNotMatch(sent[0].body,/不可使用/);}finally{p.close();}
 }
});
test('an explicitly requested device test previews real native content and keeps its destination',async()=>{
 const f=fixture();f.push.close();const sent=[],id='00000000-0000-4000-8000-000000000001';
 const p=new PushNotifications(f.file,f.access,async(s,payload)=>{sent.push(payload);return 201;},undefined,async(host,threadId,turnId)=>{assert.equal(threadId,id);assert.equal(turnId,null);return {name:'通知验证会话',turn:{status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'这是原生会话里的回复。'}]}};});
 try{await p.testDevice('host',p.devices('host')[0].id,'test-device-preview',id);assert.equal(sent.length,1);assert.equal(sent[0].title,'通知验证会话 · 测试通知');assert.equal(sent[0].body,'这是原生会话里的回复。');assert.equal(sent[0].data.threadId,id);await assert.rejects(p.testDevice('other',p.devices('host')[0].id),/设备不存在/);}finally{p.close();}
});

test('receiver journal snapshots are bounded and sanitized without expanding access to message content',()=>{
 const f=fixture();try{
  f.push.trace('host','owner',{stage:'page-receiver',endpoint:subscription().endpoint,userAgent:'x'.repeat(500),capabilities:'push=true',journal:[...Array.from({length:40},(_,i)=>({at:i,stage:'worker-click',threadId:'t'+i,body:'private text',keys:{auth:'secret'},windows:500})),null,{stage:'arbitrary',at:1}]});
  const entry=f.push.traces('owner')[0];assert.equal(entry.journal.length,30);assert.equal(entry.journal[0].threadId,'t10');assert.equal(entry.journal.at(-1).windows,100);assert.equal(entry.userAgent.length,256);assert.equal(JSON.stringify(entry).includes('private text'),false);assert.equal(JSON.stringify(entry).includes('secret'),false);assert.deepEqual(f.push.traces('another'),[]);
 }finally{f.push.close();}
});

test('only explicit numbered diagnostics mark server title and worker replacement, preserving normal notifications',async()=>{
 const sent=[],f=fixture(async(_s,payload)=>{sent.push(payload);return 201;});
 try{
  const endpoint=subscription().endpoint,threadId='00000000-0000-4000-8000-000000000001';
  await f.push.test('host','owner',endpoint,'fixture-diagnostic-001',threadId,true);
  assert.match(sent[0].title,/^\[原始\] .*测试 fixture-diagnostic-001/);assert.equal(sent[0].data.diagnostic,true);assert.equal(sent[0].data.threadId,threadId);
  await f.push.test('host','owner',endpoint,'fixture-normal-001',threadId);
  assert.doesNotMatch(sent[1].title,/\[原始\]/);assert.equal(sent[1].data.diagnostic,undefined);
  f.push.receive('host',complete());await f.push.drain();assert.doesNotMatch(sent[2].title,/\[原始\]/);assert.equal(sent[2].data.diagnostic,undefined);
  await assert.rejects(f.push.test('host','owner',endpoint,undefined,threadId,true),/编号/);
 }finally{f.push.close();}
});
test('worker metadata is sanitized and endpoint hashes associate only the matching owner and host',async()=>{
 const {createHash}=await import('node:crypto');const f=fixture();
 try{
  const endpointHash=createHash('sha256').update(subscription().endpoint).digest('hex');
  const value={stage:'worker-shown',instanceId:'background',endpointHash,observedAt:123,script:'https://user:password@portal.test/notification-worker.js?v=7&secret=hidden',scope:'https://portal.test/?secret=hidden',error:'Failed https://push.test/private',windows:200};
  f.push.trace('host','owner',value);f.push.trace('host','another',value);f.push.trace('another-host','owner',value);
  const [own,otherHost]=f.push.traces('owner'),otherOwner=f.push.traces('another')[0];
  assert.ok(own.device);assert.equal(otherOwner.device,undefined);assert.equal(otherHost.device,undefined);
  assert.equal(own.endpointHash,endpointHash);assert.equal(own.observedAt,123);assert.equal(own.script,'https://portal.test/notification-worker.js?v=7');assert.equal(own.scope,'https://portal.test/');assert.equal(own.error,'Failed [URL]');assert.equal(own.windows,100);
  assert.doesNotMatch(JSON.stringify(own),/password|secret|private/);
 }finally{f.push.close();}
});

test('device diagnostic modes are per call, validated and traced; all default sends retain four transport arguments',async()=>{
 const calls=[],f=fixture(async(...args)=>{calls.push(args);return 201;});
 try{
  const device=f.push.devices('host')[0].id,thread='00000000-0000-4000-8000-000000000001',before=f.state().devices;
  for(const mode of ['declarative','legacy']){
   const testId='fixture-mode-'+mode;
   await f.push.testDevice('host',device,testId,thread,true,mode);
   const call=calls.at(-1);assert.equal(call[5],mode);assert.equal(call[4],undefined);assert.equal(call[1].data.testId,testId);assert.equal(call[1].data.threadId,thread);
   assert.match(call[1].title,mode==='legacy'?/^\[原始·L点击处理\] /:/^\[原始·D系统跳转\] /);
   assert.equal(f.push.traces('owner').at(-1).mode,mode);assert.equal(f.push.traces('owner').at(-1).testId,testId);
  }
  for(const [diagnostic,testId,mode] of [[true,'fixture-valid-test','bad'],[true,'fixture-valid-test',null],[true,'fixture-valid-test',{}],[true,'fixture-valid-test',['legacy']],[false,'fixture-valid-test','legacy'],['true','fixture-valid-test','legacy'],[true,undefined,'legacy'],[true,'short','declarative'],[true,123,'legacy']]){
   await assert.rejects(f.push.testDevice('host',device,testId,thread,diagnostic,mode),e=>e.status===400);
  }
  assert.equal(calls.length,2);assert.deepEqual(f.state().devices,before);
  await f.push.testDevice('host',device,'fixture-default-001',thread);assert.equal(calls.at(-1).length,4);assert.doesNotMatch(calls.at(-1)[1].title,/原始/);
  await f.push.test('host','owner',subscription().endpoint,'fixture-default-002',thread);assert.equal(calls.at(-1).length,4);
  f.push.receive('host',complete('ordinary'));await f.push.drain();assert.equal(calls.at(-1).length,4);assert.equal(calls.at(-1)[1].data.diagnostic,undefined);
 }finally{f.push.close();}
});

test('delivery override is device isolated, persistent, strictly validated and resettable',async()=>{
 const calls=[],f=fixture(async(...args)=>{calls.push(args);return 201;});
 try{
  const id=f.push.devices('host')[0].id;
  f.push.subscribe('host','local','http://localhost',{...subscription(),endpoint:'https://web.push.apple.com/independent'});
  for(const mode of [undefined,null,'',{},['legacy'],'LEGACY'])assert.throws(()=>f.push.setDeliveryMode('host',id,mode),e=>e.status===400);
  assert.throws(()=>f.push.setDeliveryMode('host','bad','legacy'),e=>e.status===400);
  assert.throws(()=>f.push.setDeliveryMode('host','0'.repeat(64),'legacy'),e=>e.status===404);
  assert.throws(()=>f.push.setDeliveryMode('other',id,'legacy'),e=>e.status===404);
  f.access.sessions.owner=Date.now()-1;assert.throws(()=>f.push.setDeliveryMode('host',id,'legacy'),e=>e.status===404);f.access.sessions.owner=null;
  assert.equal(f.push.devices('host').find(d=>d.id===id).deliveryMode,undefined);
  f.push.setDeliveryMode('host',id,'legacy');
  f.push.receive('host',complete('isolated'));await f.push.drain();
  assert.equal(calls.find(c=>c[0].endpoint===subscription().endpoint)[5],'legacy');
  assert.equal(calls.find(c=>c[0].endpoint.endsWith('/independent')).length,4);
  assert.deepEqual(f.push.traces().filter(r=>r.stage==='send-task').map(r=>r.mode),['legacy','declarative']);
  const restored=new PushNotifications(f.file,f.access,async()=>201);try{assert.equal(restored.devices('host').find(d=>d.id===id).deliveryMode,'legacy');}finally{restored.close();}
  f.push.setDeliveryMode('host',id,'declarative');await f.push.testDevice('host',id);assert.equal(calls.at(-1)[5],'declarative');
  f.push.setDeliveryMode('host',id,'default');assert.equal(Object.hasOwn(f.state().devices[id],'deliveryMode'),false);
  await f.push.testDevice('host',id);assert.equal(calls.at(-1).length,4);assert.equal(f.push.traces().at(-1).mode,'declarative');
 }finally{f.push.close();}
});

test('same-installation resubscribe and remote renewal retain override without crossing owner, host, subject or local endpoints',()=>{
 const f=fixture();try{
  const origin='https://portal.example.com',id=f.push.devices('host')[0].id;
  f.push.setDeliveryMode('host',id,'legacy');
  f.push.subscribe('host','owner',origin,subscription());assert.equal(f.push.devices('host')[0].deliveryMode,'legacy');
  const renewed={...subscription(),endpoint:'https://web.push.apple.com/renewed'};
  f.push.subscribe('host','owner',origin,renewed);assert.equal(f.push.devices('host').length,1);assert.equal(f.push.devices('host')[0].deliveryMode,'legacy');
  f.access.sessions.second=null;
  for(const [host,owner,subject,suffix] of [['host','second',origin,'owner'],['other','owner',origin,'host'],['host','owner','https://different.test','subject']]){
   f.push.subscribe(host,owner,subject,{...subscription(),endpoint:'https://web.push.apple.com/'+suffix});
   assert.equal(Object.values(f.state().devices).find(d=>d.subscription.endpoint.endsWith('/'+suffix)).deliveryMode,undefined);
  }
  const local={...subscription(),endpoint:'https://web.push.apple.com/local-one'};
  f.push.subscribe('host','local',origin,local);const localId=Object.entries(f.state().devices).find(([,d])=>d.subscription.endpoint===local.endpoint)[0];
  f.push.setDeliveryMode('host',localId,'legacy');f.push.subscribe('host','local',origin,local);assert.equal(f.state().devices[localId].deliveryMode,'legacy');
  f.push.subscribe('host','local',origin,{...local,endpoint:'https://web.push.apple.com/local-two'});assert.equal(Object.values(f.state().devices).find(d=>d.subscription.endpoint.endsWith('/local-two')).deliveryMode,undefined);
  // Even an identical endpoint cannot carry a preference across ownership changes.
  f.push.subscribe('host','second',origin,local);assert.equal(f.state().devices[localId].deliveryMode,undefined);
  f.push.setDeliveryMode('host',f.push.devices('host').find(d=>d.id!==localId&&d.deliveryMode==='legacy').id,'default');
  f.push.subscribe('host','owner',origin,{...renewed,endpoint:'https://web.push.apple.com/renewed-again'});
  assert.equal(Object.values(f.state().devices).find(d=>d.subscription.endpoint.endsWith('/renewed-again')).deliveryMode,undefined);
 }finally{f.push.close();}
});

function decodeDelivery(ua,sub,request){
 const hmac=(key,data)=>createHmac('sha256',key).update(data).digest(),wire=request.body,salt=wire.subarray(0,16),pub=wire.subarray(21,21+wire[20]);
 const prk=hmac(Buffer.from(sub.keys.auth,'base64url'),ua.computeSecret(pub));
 const ikm=hmac(prk,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),pub,Buffer.from([1])]));
 const secret=hmac(salt,ikm),key=hmac(secret,Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0,16),nonce=hmac(secret,Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0,12);
 const decipher=createDecipheriv('aes-128-gcm',key,nonce);decipher.setAuthTag(wire.subarray(-16));
 const plain=Buffer.concat([decipher.update(wire.subarray(21+wire[20],-16)),decipher.final()]);assert.equal(plain.at(-1),2);return JSON.parse(plain.subarray(0,-1));
}

test('ordinary test and task delivery encrypt the device format; explicit diagnostics override without persisting',async()=>{
 const ua=createECDH('prime256v1');ua.generateKeys();const sub={...subscription(),keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,4).toString('base64url')}};
 const sent=[],f=fixture((s,p,k,origin,_fetch,mode)=>sendPush(s,p,k,origin,async(url,request)=>{assert.equal(url,sub.endpoint);sent.push({request,payload:decodeDelivery(ua,sub,request)});return {status:201};},mode));
 try{
  f.push.subscribe('host','owner','https://portal.example.com',sub);const id=f.push.devices('host')[0].id;
  const assertWire=mode=>{const {request,payload}=sent.at(-1);assert.equal(request.headers['Content-Type'],mode==='legacy'?'application/octet-stream':'application/notification+json');if(mode==='legacy'){assert.deepEqual(Object.keys(payload).sort(),['body','data','tag','title']);}else{assert.equal(payload.web_push,8030);assert.equal(payload.mutable,true);assert.equal(payload.notification.mutable,true);assert.ok(payload.notification.navigate.startsWith('https://portal.example.com/'));}return payload;};
  for(const preference of ['default','legacy','declarative']){
   f.push.setDeliveryMode('host',id,preference);const effective=preference==='default'?'declarative':preference;
   await f.push.test('host','owner',sub.endpoint,'fixture-ordinary-'+preference);assertWire(effective);assert.equal(f.push.traces().at(-1).mode,effective);
   await f.push.testDevice('host',id,'fixture-device-'+preference);assertWire(effective);
   f.push.receive('host',complete('format-'+preference));await f.push.drain();assert.equal(assertWire(effective).data.threadId,'thread');assert.equal(f.push.traces().at(-1).mode,effective);
   const before=f.state().devices;
   for(const diagnostic of ['declarative','legacy']){await f.push.testDevice('host',id,'fixture-override-'+diagnostic,undefined,true,diagnostic);assertWire(diagnostic);assert.equal(f.push.traces().at(-1).mode,diagnostic);assert.deepEqual(f.state().devices,before);}
  }
 }finally{f.push.close();}
});
