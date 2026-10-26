import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {threadSourceIcon} from '../public/activity.js';
const worker=await readFile(new URL('../public/notification-worker.js',import.meta.url),'utf8');
test('notification cold start carries both connection and encoded thread; warm start selects without reloading',async()=>{
 for(const warm of [false,true]){
  const handlers={},opened=[],messages=[];let focused=false,closed=false,done;
  const client={url:'https://rcm.test/?host=local',focus:async()=>{focused=true;},postMessage:data=>messages.push(data)};
  vm.runInNewContext(worker,{URL,self:{location:{origin:'https://rcm.test'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{matchAll:async()=>warm?[client]:[],openWindow:async url=>opened.push(url)}}});
  handlers.notificationclick({notification:{data:{host:'local',threadId:'thread /?中文'},close:()=>{closed=true;}},waitUntil:p=>done=p});await done;
  assert.equal(closed,true);
  if(warm){assert.equal(focused,true);assert.equal(messages[0].threadId,'thread /?中文');assert.equal(opened.length,0);}
  else {const url=new URL(opened[0]);assert.equal(url.searchParams.get('host'),'local');assert.equal(url.searchParams.get('thread'),'thread /?中文');}
 }
});
test('running icon follows execution entrance while idle retains original creation source',()=>{
 const old=globalThis.document;
 globalThis.document={createElement:()=>({setAttribute(){},append(value){this.icon=value;}})};
 try{
  for(const [originator,running,expected] of [['Codex Desktop','web','globe'],['remote_codex_manager','desktop','monitor'],['Codex Desktop',null,'monitor'],['remote_codex_manager',null,'globe']]){
   const node=threadSourceIcon({originator},running,x=>x);assert.equal(node.icon,expected);
   assert.match(node.title,originator==='Codex Desktop'?/桌面端创建/:/网页端创建/);
  }
 }finally{globalThis.document=old;}
});

test('worker replacement preserves iOS declarative navigation with the conversation',async()=>{const handlers={},shown=[];let done;vm.runInNewContext(worker,{self:{addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push(options)}}});const navigate='https://rcm.test/?host=local&thread=fixture';handlers.push({data:{json:()=>({web_push:8030,notification:{title:'test',navigate,data:{host:'local',threadId:'fixture'}}})},waitUntil:p=>done=p});await done;assert.equal(shown[0].navigate,navigate);assert.equal(shown[0].data.threadId,'fixture');});
