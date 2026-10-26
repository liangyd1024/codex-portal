import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeAutomations} from '../lib/native-automations.mjs';
import {matchingThreads} from '../public/skill-suggestions.js';
import {mentionRanges} from '../public/inline-mentions.js';
const id='00000000-0000-0000-0000-000000000001',ref='00000000-0000-0000-0000-000000000002',mid='00000000-0000-0000-0000-000000000003';
function fixture(){
 const m={controlled:new Set(),subscriptions:new Map(),mutations:0,saveState(){},passive:async(action,p)=>action==='history'?{data:[]}:{thread:{id:p.threadId,name:'Native title',activity:{state:'idle'}}}};
 const session=new NativeAutomations(m,{threadId:id}),calls=[];
 session.call=async(_,p)=>{calls.push(p);return p.action==='send'?{result:{result:{turn:{id:'turn'}}}}:{available:true,threadReferencesSupported:true};};
 return {m,session,calls};
}
test('desktop references use same-target native metadata and preserve accepted-message idempotency',async()=>{
 const {session,calls}=fixture();const request={threadId:id,messageId:mid,text:'参考 @测试',threads:[ref,ref]};
 await session.send(request);await session.send(request);
 assert.deepEqual(calls.filter(p=>p.action==='send'),[{action:'send',threadId:id,messageId:mid,text:'参考 @测试',threadReferences:[{threadId:ref,title:'Native title'}]}]);
 await assert.rejects(session.send({...request,threads:[]}),/不同消息/);
});
test('released handoff is not native ownership or reference capability',async()=>{
 const {session,m,calls}=fixture();m.subscriptions.set(id,{handoff:{state:'waiting'}});
 assert.equal((await session.detail()).desktop.canSend,false);
 await assert.rejects(session.send({threadId:id,messageId:mid,text:'test',threads:[ref]}),/释放/);
 m.subscriptions.set(id,{handoff:{state:'released'}});
 session.call=async()=>({available:true,threadReferencesSupported:false});
 await assert.rejects(session.send({threadId:id,messageId:mid,text:'test',threads:[ref]}),e=>e.code==='THREAD_REFERENCES_UNAVAILABLE');
 assert.equal(session.state.submissions[mid],undefined);assert.equal(calls.some(p=>p.action==='send'),false);
 session.call=async()=>{throw Error('No desktop owner');};
 assert.equal((await session.detail()).desktop.available,false);
});
test('invalid, self, archived and missing references never dispatch a native turn',async()=>{
 for(const target of [null,{id:ref,archived:true}]){
  const {session,m,calls}=fixture(),passive=m.passive;
  m.passive=async(action,p)=>action==='detail'&&p.threadId===ref?{thread:target}:passive(action,p);
  await assert.rejects(session.send({threadId:id,messageId:mid,text:'test',threads:[ref]}));
  assert.equal(calls.some(p=>p.action==='send'),false);
 }
 for(const threads of [[id],['bad'],null]){
  const {session,calls}=fixture();
  await assert.rejects(session.send({threadId:id,messageId:mid,text:'test',threads}));
  assert.equal(calls.some(p=>p.action==='send'),false);
 }
});
test('a definitive capability rejection preserves retry while unknown delivery blocks duplicates',async()=>{
 const {session}=fixture();session.call=async(_,p)=>{if(p.action==='send')throw Object.assign(Error('unavailable'),{code:'THREAD_REFERENCES_UNAVAILABLE'});return {threadReferencesSupported:true};};
 await assert.rejects(session.send({threadId:id,messageId:mid,text:'test',threads:[ref]}));assert.equal(session.unconfirmed(),undefined);
 session.call=async(_,p)=>{if(p.action==='send')throw Object.assign(Error('lost reply'),{code:'OUTCOME_UNKNOWN'});return {threadReferencesSupported:true};};
 await assert.rejects(session.send({threadId:id,messageId:mid,text:'test',threads:[ref]}));assert.equal(session.unconfirmed()[0],mid);
});
test('candidate identities distinguish equal titles and exclude current, archived and ephemeral threads',()=>{
 const rows=matchingThreads([{id,name:'current'},{id:ref,name:'同名'},{id:ref,name:'duplicate'},{id:mid,name:'同名'},{id:'archived',archived:true},{id:'ephemeral',ephemeral:true}],id);
 assert.deepEqual(rows.map(r=>r.id),[ref,mid]);
 const refs=rows.map(r=>({kind:'threads',key:r.id,token:'@'+r.name+'·'+r.id.slice(-8)}));
 assert.deepEqual(mentionRanges(refs[1].token,refs).map(r=>r.key),[mid]);
 assert.deepEqual(mentionRanges('',refs),[]);
});

test('desktop routes enforce CSRF, Origin and selected-host scope',async()=>{
 const {Manager}=await import('../lib/manager.mjs'),{createApp}=await import('../server.mjs');
 const calls=[];const make=host=>{const m=new Manager({host:{id:host,kind:'local'},remote:async()=>{calls.push(host);return {available:true,threadReferencesSupported:true};}});m.passive=async(action)=>action==='history'?{data:[]}:{thread:{id,activity:{state:'idle'}}};return m;};
 const {server}=await createApp({config:{defaultConnection:'one'},managers:new Map([['one',make('one')],['two',make('two')]])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const url=base+'/api/desktop/threads/'+id+'/message?host=two',body=JSON.stringify({messageId:mid,text:'test'});
  assert.equal((await fetch(url,{method:'POST',body})).status,403);
  const {token}=await fetch(base+'/api/csrf').then(r=>r.json());
  assert.equal((await fetch(url,{method:'POST',body,headers:{'x-csrf-token':token,origin:'https://untrusted.example'}})).status,403);
  assert.deepEqual(calls,[]);
  const detail=await fetch(base+'/api/desktop/threads/'+id+'?host=two').then(r=>r.json());
  assert.equal(detail.desktop.threadReferencesSupported,true);assert.deepEqual(calls,['two']);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('desktop rich input resolves enabled native catalog and rejects changed idempotency content',async()=>{
 const {session,m,calls}=fixture();const passive=m.passive;
 m.passive=async(a,p)=>{const result=await passive(a,p);if(result.thread)result.thread.cwd='/workspace';return result};
 m.requireConnected=()=>{};m.requireCapability=()=>{};
 m.rpc={request:async method=>method==='skills/list'?{data:[{skills:[{name:'sample',path:'/skills/sample/SKILL.md',enabled:true}]}]}:method==='plugin/installed'?{marketplaces:[{plugins:[{id:'sample',name:'Sample',installed:true,enabled:true}]}]}:{data:[]}};
 const image={url:'data:image/png;base64,iVBORw0KGgo='},request={threadId:id,messageId:mid,text:'执行',images:[image],skills:['/skills/sample/SKILL.md'],plugins:['sample']};
 await session.send(request);await session.send(request);
 const sends=calls.filter(c=>c.action==='send');assert.equal(sends.length,1);
 assert.deepEqual(sends[0].input,[{type:'text',text:'执行'},{type:'image',url:image.url},{type:'skill',name:'sample',path:'/skills/sample/SKILL.md'},{type:'mention',name:'Sample',path:'plugin://sample'}]);
 await assert.rejects(session.send({...request,images:[]}),/不同消息/);
});
test('desktop accepts image-only input and rejects malformed image before native dispatch',async()=>{
 const {session,calls}=fixture();await assert.rejects(session.send({threadId:id,messageId:mid,text:'',images:[{url:'https://example.com/image.png'}]}));assert.equal(calls.length,0);
 await session.send({threadId:id,messageId:mid,text:'',images:[{url:'data:image/png;base64,iVBORw0KGgo='}]});assert.equal(calls.find(c=>c.action==='send').input[0].type,'image');
});
test('desktop unavailable skill preserves retry without dispatch',async()=>{
 const {session,m,calls}=fixture();const passive=m.passive;m.passive=async(a,p)=>{const r=await passive(a,p);if(r.thread)r.thread.cwd='/workspace';return r};
 m.requireConnected=()=>{};m.requireCapability=()=>{};m.rpc={request:async()=>({data:[]})};
 await assert.rejects(session.send({threadId:id,messageId:mid,text:'test',skills:['/missing']}),/技能已不可用/);assert.equal(calls.some(c=>c.action==='send'),false);assert.equal(session.unconfirmed(),undefined);
});
