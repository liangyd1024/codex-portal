import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {clipboardHTML,safeImage} from '../public/composer-clipboard.js';
import {annotatedText} from '../public/response-annotations.js';
import {applySideEvent} from '../shared/side-chat-events.js';
import {createSideChat,readSideChat} from '../lib/side-chats.mjs';
test('clipboard preserves all images and escapes markup, rejects external image sources',()=>{
 const html=clipboardHTML('<text>\n&',[{name:'"cat"',url:'data:image/png;base64,YQ=='}]);
 assert.match(html,/&lt;text&gt;/);assert.match(html,/&quot;cat&quot;/);assert.ok(safeImage('data:image/png;base64,YQ=='));assert.equal(safeImage('https://example.test/a.png'),false);assert.equal(safeImage('data:image/svg+xml;base64,YQ=='),false);
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
