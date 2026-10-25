import test from 'node:test';
import assert from 'node:assert/strict';
import {messageInput} from '../lib/message-input.mjs';
import {AttachmentDrafts} from '../public/attachments.js';
import {Manager} from '../lib/manager.mjs';
const url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
test('image-only and mixed inputs use engine image URLs, with strict content and size limits',()=>{
 assert.deepEqual(messageInput('',[{url}]),[{type:'image',url}]);
 assert.equal(messageInput('说明',[{url}])[0].text,'说明');
 for(const bad of ['https://example.com/a.png','file:///etc/passwd','data:image/png;base64,aGVsbG8=','data:image/svg+xml;base64,PHN2Zz4='])assert.throws(()=>messageInput('',[{url:bad}]));
 assert.throws(()=>messageInput('',Array(5).fill({url})));
 assert.throws(()=>messageInput(''));
});
test('attachment drafts survive reload and acknowledgements only remove the captured images',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const a=new AttachmentDrafts(storage,'local');a.add('one',{id:'a',url,name:'a'});const sent=a.capture('one');a.add('one',{id:'b',url,name:'b'});a.add('two',{id:'c',url,name:'c'});a.acknowledge(sent);
 const b=new AttachmentDrafts(storage,'local');assert.deepEqual(b.get('one').map(i=>i.id),['b']);assert.equal(b.get('two')[0].id,'c');
 b.remove('one','b');assert.equal(b.get('one').length,0);
});
test('images reach both idle turn/start and running turn/steer without filesystem paths',async()=>{
 const m=new Manager({host:{alias:'test'}}),calls=[];m.connection={state:'connected'};m.controlled.set('a',{status:{type:'idle'}});m.rpc={connected:true,request:async(method,params)=>{calls.push({method,params});return {turn:{id:'turn',status:'inProgress'}};}};
 await m.message('a',{images:[{url}]});assert.deepEqual(calls[0].params.input,[{type:'image',url}]);
 await m.steer('a',{text:'补充',images:[{url}]});assert.equal(calls[1].method,'turn/steer');assert.equal(calls[1].params.input[1].url,url);
});

test('image-sized HTTP bodies are accepted only on message routes after CSRF validation',async()=>{
 const {createApp}=await import('../server.mjs');const {EventEmitter}=await import('node:events');
 class Fake extends EventEmitter {host={id:'local'};disconnect(){} message(id,data){return {size:data.images[0].url.length};}}
 const app=await createApp({config:{defaultConnection:'local',connections:[]},managers:new Map([['local',new Fake()]])});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{const {token}=await fetch(base+'/api/csrf').then(r=>r.json());const body=JSON.stringify({images:[{url:'x'.repeat(1100000)}]});const post=(path,csrf)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf},body});
 assert.equal((await post('/api/threads/test/message','')).status,403);assert.equal((await post('/api/threads',token)).status,413);
 const accepted=await post('/api/threads/test/message',token);assert.equal(accepted.status,200);assert.equal((await accepted.json()).size,1100000);
 }finally{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});

test('attachment persistence keeps pending items in memory and preserves unknown metadata',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const drafts=new AttachmentDrafts(storage,'images');
 const pending={id:'pending',name:'待处理图片',future:{source:'clipboard'}};
 drafts.add('one',pending);
 assert.equal(drafts.get('one')[0],pending);
 assert.deepEqual(JSON.parse(values.get('images')),[['one',[]]]);
 pending.url=url;drafts.save();
 const restored=new AttachmentDrafts(storage,'images');
 assert.deepEqual(restored.get('one'),[pending]);
 const captured=restored.capture('one');
 restored.get('one')[0].name='后续名称';
 assert.equal(captured.items[0].name,'待处理图片');
 assert.deepEqual(captured.items[0].future,{source:'clipboard'});
});

test('attachment storage failure reports loss risk without dropping the current draft',()=>{
 const messages=[],storage={getItem:()=>null,setItem(){throw Error('quota');}};
 const drafts=new AttachmentDrafts(storage,'images',(...args)=>messages.push(args));
 drafts.add('one',{id:'a',name:'图片',url});
 assert.equal(drafts.capture('one').items[0].id,'a');
 assert.deepEqual(messages,[['图片暂时仅保留在当前页面，刷新可能丢失，请先发送或减少图片。',true]]);
 drafts.remove('one','a');assert.deepEqual(drafts.get('one'),[]);
});
