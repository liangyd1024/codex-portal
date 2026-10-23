import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {clipboardHTML,safeImage,installComposerClipboard} from '../public/composer-clipboard.js';
import {annotatedText} from '../public/response-annotations.js';
import {applySideEvent} from '../shared/side-chat-events.js';
import {createSideChat,readSideChat} from '../lib/side-chats.mjs';
test('clipboard preserves all images and escapes markup, rejects external image sources',()=>{
 const html=clipboardHTML('<text>\n&',[{name:'"cat"',url:'data:image/png;base64,YQ=='}]);
 assert.match(html,/&lt;text&gt;/);assert.match(html,/&quot;cat&quot;/);assert.ok(safeImage('data:image/png;base64,YQ=='));assert.equal(safeImage('https://example.test/a.png'),false);assert.equal(safeImage('data:image/svg+xml;base64,YQ=='),false);
});
test('whole composer selection survives uppercase copy/cut shortcuts and deletes images with text',()=>{
 for(const key of ['c','C','x','X','Backspace','Delete']){
  const input=Object.assign(new EventTarget(),{value:'中文草稿',selectionStart:0,selectionEnd:0,select(){this.selectionStart=0;this.selectionEnd=this.value.length;}});
  const classes=new Set(),list={classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}};
  let pictures=[{name:'图片',url:'data:image/png;base64,YQ=='}];
  installComposerClipboard({input,list,context:()=>({id:'test',ready:true}),items:()=>pictures,replace:v=>{pictures=v;},notify:()=>assert.fail('unexpected clipboard error')});
  const dispatch=(type,props)=>{const event=Object.assign(new Event(type,{cancelable:true}),props);input.dispatchEvent(event);return event;};
  dispatch('keydown',{key:'A',metaKey:true});
  dispatch('keydown',{key,metaKey:!['Backspace','Delete'].includes(key)});
  if(['Backspace','Delete'].includes(key)){assert.equal(input.value,'');assert.equal(pictures.length,0);continue;}
  const data=new Map();const kind=key.toLowerCase()==='c'?'copy':'cut';
  const event=dispatch(kind,{clipboardData:{setData:(k,v)=>data.set(k,v)}});
  assert.equal(event.defaultPrevented,true);assert.equal(data.get('text/plain'),'中文草稿');assert.match(data.get('text/html'),/data:image\/png/);
  assert.equal(pictures.length,kind==='cut'?0:1);assert.equal(input.value,kind==='cut'?'':'中文草稿');
 }
});
test('annotation wrapper preserves text and comments exactly and plain requests are unchanged',()=>{
 assert.equal(annotatedText('hello'),'hello');const out=annotatedText('问题',[{text:'原文\n第二行',annotation:'评论',source:{messageId:'source'}}]);
 const raw=out.split('<response-annotations>\n')[1].split('\n</response-annotations>')[0];assert.deepEqual(JSON.parse(raw),[{text:'原文\n第二行',annotation:'评论',source:{messageId:'source'}}]);assert.ok(out.endsWith('## My request:\n问题\n'));
});
test('side cache retains original completed text and items through empty completion events',()=>{
 const turns=[];applySideEvent(turns,'item/agentMessage/delta',{turnId:'t',itemId:'i',delta:'初稿'});applySideEvent(turns,'item/completed',{turnId:'t',item:{id:'i',type:'agentMessage',text:'原生完整回复'}});applySideEvent(turns,'turn/completed',{turn:{id:'t',items:[],status:'completed'}});assert.equal(turns[0].items[0].text,'原生完整回复');assert.equal(turns[0].status,'completed');
});
function fixture(){const m=new EventEmitter(),calls=[];Object.assign(m,{requireLogin(){},requireWritable(){},requireConnected(){},requireCapability(x){assert.equal(x,'sideChat');},models:[],controlled:new Map(),withMutation:fn=>fn(),status:()=>({}),publish:(method,params)=>m.emit('event',{method,params}),rpc:{async request(method,p){calls.push({method,p});if(method==='thread/read')return {thread:{id:p.threadId,status:{type:'idle'}}};return {thread:{id:'side',ephemeral:true,cwd:'/project',status:{type:'idle'}},model:'model'};}}});return {m,calls};}
test('side chat uses one native ephemeral fork; creation retries never fork twice',async()=>{
 const {m,calls}=fixture(),requestId='11111111-1111-4111-8111-111111111111';const [a,b]=await Promise.all([createSideChat(m,'parent',{requestId}),createSideChat(m,'parent',{requestId})]);assert.equal(a.thread.id,b.thread.id);assert.equal(calls.filter(x=>x.method==='thread/fork').length,1);const fork=calls.find(x=>x.method==='thread/fork').p;assert.equal(fork.ephemeral,true);assert.equal(fork.threadId,'parent');assert.equal(fork.approvalPolicy,'never');assert.match(fork.developerInstructions,/reference context/);assert.equal(calls.some(x=>x.method==='turn/start'),false);
 m.emit('event',{method:'item/completed',params:{threadId:'side',turnId:'t',item:{id:'i',type:'agentMessage',text:'native'}}});assert.equal((await readSideChat(m,'side')).turns[0].items[0].text,'native');m.rpc={};await assert.rejects(readSideChat(m,'side'),/失效/);
});
test('failed uncertain fork request cannot be automatically repeated',async()=>{
 const {m}=fixture();let forks=0;m.rpc.request=async method=>{if(method==='thread/read')return {thread:{}};forks++;throw Error('timeout');};const p={requestId:'22222222-2222-4222-8222-222222222222'};await assert.rejects(createSideChat(m,'p',p));await assert.rejects(createSideChat(m,'p',p));assert.equal(forks,1);
});
test('side cache presents original plan, reasoning and command streaming output',()=>{
 const turns=[];
 applySideEvent(turns,'item/plan/delta',{turnId:'t',itemId:'plan',delta:'计划原文'});
 applySideEvent(turns,'item/commandExecution/outputDelta',{turnId:'t',itemId:'cmd',delta:'first\n'});
 applySideEvent(turns,'item/commandExecution/outputDelta',{turnId:'t',itemId:'cmd',delta:'second\n'});
 applySideEvent(turns,'item/reasoning/summaryTextDelta',{turnId:'t',itemId:'reason',summaryIndex:1,delta:'摘要'});
 applySideEvent(turns,'item/reasoning/textDelta',{turnId:'t',itemId:'reason',contentIndex:0,delta:'原生思考'});
 applySideEvent(turns,'error',{turnId:'t',error:{message:'原生错误'}});
 assert.equal(turns[0].items.find(i=>i.id==='plan').type,'plan');
 assert.equal(turns[0].items.find(i=>i.id==='cmd').aggregatedOutput,'first\nsecond\n');
 assert.equal(turns[0].items.find(i=>i.id==='reason').summary[1],'摘要');
 assert.equal(turns[0].items.find(i=>i.id==='reason').content[0],'原生思考');
 assert.equal(turns[0].error.message,'原生错误');
 applySideEvent(turns,'item/completed',{turnId:'t',item:{id:'cmd',type:'commandExecution',aggregatedOutput:'完整输出'}});
 assert.equal(turns[0].items.find(i=>i.id==='cmd').aggregatedOutput,'完整输出');
});
test('side chat keeps the first input across partial completion and late start responses',()=>{
 const turns=[],user={id:'user',type:'userMessage',content:[{type:'text',text:annotatedText('首次问题',[],[{text:'选文'}])}]};
 applySideEvent(turns,'item/completed',{turnId:'t',item:user});
 applySideEvent(turns,'item/completed',{turnId:'t',item:{id:'answer',type:'agentMessage',text:'完整原生回复'}});
 applySideEvent(turns,'turn/completed',{turn:{id:'t',status:'completed',items:[{id:'answer',type:'agentMessage',text:'最终回复'}]}});
 applySideEvent(turns,'turn/started',{turn:{id:'t',status:'inProgress',items:[user,{id:'answer',type:'agentMessage',text:'旧回复'}]}});
 assert.deepEqual(turns[0].items,[user,{id:'answer',type:'agentMessage',text:'最终回复'}]);
 assert.equal(turns[0].status,'completed');
});
test('side cache does not mutate native turn payload arrays as later items arrive',()=>{
 const turns=[],payload={id:'t',items:[{id:'user',type:'userMessage',content:[]}]};
 applySideEvent(turns,'turn/started',{turn:payload});
 applySideEvent(turns,'item/agentMessage/delta',{turnId:'t',itemId:'answer',delta:'回复'});
 assert.equal(payload.items.length,1);
 assert.equal(turns[0].items.length,2);
});
test('side view reread retains first input after partial native completion',async()=>{
 const {m}=fixture();await createSideChat(m,'parent',{requestId:'33333333-3333-4333-8333-333333333333'});
 const user={id:'user',type:'userMessage',content:[{type:'text',text:'首次输入'}]};
 m.emit('event',{method:'item/completed',params:{threadId:'side',turnId:'t',item:user}});
 m.emit('event',{method:'turn/completed',params:{threadId:'side',turn:{id:'t',status:'completed',items:[{id:'answer',type:'agentMessage',text:'回复'}]}}});
 assert.deepEqual((await readSideChat(m,'side')).turns[0].items[0],user);
});
