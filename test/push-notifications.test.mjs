import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {createPushKeys} from '../lib/web-push.mjs';
const source=readFileSync(new URL('../src/server/services/push-notifications.ts',import.meta.url),'utf8').replaceAll("'../../../lib/web-push.mjs'",JSON.stringify(new URL('../lib/web-push.mjs',import.meta.url).href)).replaceAll("'../../../shared/questions.js'",JSON.stringify(new URL('../shared/questions.js',import.meta.url).href)).replaceAll("'../../../shared/connection-state.js'",JSON.stringify(new URL('../shared/connection-state.js',import.meta.url).href));
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
 try{f.push.observe('host','thread',[questionTurn([])]);f.push.observe('host','thread',[questionTurn([questionItem])]);await f.push.drain();assert.equal(sent.length,1);assert.equal(sent[0].title,'Codex · 需要你回答');f.push.observe('host','thread',[questionTurn([questionItem])]);await f.push.drain();assert.equal(sent.length,1);}finally{f.push.close();}
});
test('first read catches a pending question but accepted replies and finished turns never notify',async()=>{
 let sent=0;const f=fixture(async()=>{sent++;return 201;});
 try{const reply={type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>'+JSON.stringify({questionItemId:JSON.stringify(['request_user_input_async','question-item',0]),question:'请选择关闭方向',answer:'向右'})+'</send_user_message_question_reply>'}]};f.push.observe('host','answered',[questionTurn([questionItem,reply])]);f.push.observe('host','finished',[{...questionTurn([questionItem]),status:'completed'}]);await f.push.drain();assert.equal(sent,0);f.push.observe('host','pending',[questionTurn([questionItem])]);await f.push.drain();assert.equal(sent,1);}finally{f.push.close();}
});

test('test delivery carries the requested session and rejects malformed session identifiers',async()=>{const sent=[],f=fixture(async(_s,payload)=>{sent.push(payload);return 201;});try{const endpoint=Object.values(f.state().devices)[0].subscription.endpoint;const threadId='00000000-0000-4000-8000-000000000001';await f.push.test('host','owner',endpoint,'fixture-test-12345',threadId);assert.equal(sent[0].data.threadId,threadId);await assert.rejects(f.push.test('host','owner',endpoint,'fixture-test-12345','../bad'),/会话标识/);}finally{f.push.close();}});
