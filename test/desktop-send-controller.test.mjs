import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/desktop-send.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createDesktopSend}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
function fixture(){
 let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b});
 const state={selectedId:'a/b',selectionVersion:1,busy:new Set(),detail:{desktop:{canSend:true}}},input={value:' 中文草稿 '},sends={},calls=[],saved=[],toasts=[],drafts=new Map([['a/b',input.value]]),annotation={items:['注释']},options={skills:[],plugins:[],threads:[{id:'reference',unknown:{keep:true}}]};
 let attachments=false,converting=false,pictures=[],ack=0,resizes=0,refreshes=0;
 let active=false;
 const send=createDesktopSend({state,running:()=>active,input:()=>input,captureAnnotation:()=>annotation,annotatedText:(text,a)=>text+'\n'+a.items.join(''),acknowledgeAnnotation:a=>{assert.equal(a,annotation);ack++},hasAttachments:()=>attachments,attachmentsPending:()=>converting,captureAttachments:()=>({id:state.selectedId,items:[...pictures]}),acknowledgeAttachments:sent=>{pictures=pictures.filter(p=>!sent.items.some(i=>i.id===p.id))},options:()=>options,captureDraft:(id,text)=>({id,text}),acknowledgeDraft:d=>{if(drafts.get(d.id)!==d.text)return false;drafts.delete(d.id);return true},sends,saveSends:()=>saved.push(structuredClone(sends)),uuid:()=> 'stable-uuid',action:async(key,run)=>{state.busy.add(key);try{return await run()}finally{state.busy.delete(key)}},post:(path,body)=>{calls.push({path,body});return pending},refresh:async()=>{refreshes++},resize:()=>resizes++,toast:(...args)=>toasts.push(args)});
 return{setActive:v=>active=v,state,input,sends,calls,saved,toasts,drafts,options,send,resolve,reject,setAttachments:v=>attachments=v,setConverting:v=>converting=v,addPicture:p=>{pictures.push(p);attachments=true},pictures:()=>pictures,counts:()=>({ack,resizes,refreshes})};
}
test('desktop send saves receipt before posting; duplicate requests are blocked and confirmed text is cleared',async()=>{
 const f=fixture(),sending=f.send();assert.deepEqual(f.saved,[{'a/b':{messageId:'stable-uuid',text:' 中文草稿 '}}]);await f.send();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{path:'/api/desktop/threads/a%2Fb/message',body:{messageId:'stable-uuid',text:'中文草稿\n注释',threads:[{id:'reference',unknown:{keep:true}}],images:[],skills:[],plugins:[]}});f.resolve({accepted:true});await sending;assert.equal(f.input.value,'');assert.deepEqual(f.sends,{});assert.deepEqual(f.counts(),{ack:1,resizes:1,refreshes:1});assert.equal(f.state.busy.size,0);
});
test('late desktop acceptance preserves another selection or edits made during the request',async()=>{
 for(const changeSelection of [false,true]){const f=fixture(),sending=f.send();if(changeSelection){f.state.selectedId='b';f.state.selectionVersion++}f.input.value='新草稿';f.drafts.set(f.state.selectedId,f.input.value);f.resolve({});await sending;assert.equal(f.input.value,'新草稿');assert.equal(f.drafts.get(f.state.selectedId),'新草稿');assert.deepEqual(f.counts(),{ack:1,resizes:0,refreshes:changeSelection?0:1});assert.deepEqual(f.sends,{})}
});
test('unknown results retain receipt and draft; definite client rejection permits a later retry',async()=>{
 for(const error of [{status:400,code:'INVALID_REQUEST'},{status:409,code:'OUTCOME_UNKNOWN'},{status:409,code:'SEND_PENDING'},{status:503},{}]){const f=fixture(),sending=f.send();f.reject(Object.assign(new Error('拒绝'),error));await assert.rejects(sending,/拒绝/);assert.equal(f.input.value,' 中文草稿 ');assert.equal(f.drafts.get('a/b'),f.input.value);assert.equal(Boolean(f.sends['a/b']),error.code!=='INVALID_REQUEST');assert.deepEqual(f.counts(),{ack:0,resizes:0,refreshes:1});assert.equal(f.state.busy.size,0)}
});
test('desktop capability and conversion guards do not create requests',async()=>{
 for(const guard of ['capability','busy','pending','converting']){const f=fixture();if(guard==='capability')f.state.detail.desktop.canSend=false;if(guard==='busy')f.state.busy.add('message');if(guard==='pending')f.sends['a/b']={messageId:'prior',text:'prior'};if(guard==='converting')f.setConverting(true);await f.send();assert.equal(f.calls.length,0);assert.equal(f.saved.length,0)}
});
test('desktop structured input sends images, skills and plugins and keeps pictures added later',async()=>{
 const f=fixture(),picture={id:'one',name:'photo',url:'data:image/png;base64,aGVsbG8='};f.addPicture(picture);f.options.skills.push({path:'/skills/sample/SKILL.md'});f.options.plugins.push({id:'sample'});
 const sending=f.send();assert.deepEqual(f.calls[0].body.images,[{url:picture.url}]);assert.deepEqual(f.calls[0].body.skills,f.options.skills);assert.deepEqual(f.calls[0].body.plugins,f.options.plugins);assert.deepEqual(f.sends['a/b'].pictures,{id:'a/b',items:[{id:'one'}]});
 f.addPicture({id:'two',url:'later'});f.resolve({});await sending;assert.deepEqual(f.pictures().map(p=>p.id),['two']);
});
test('desktop rejection preserves image draft',async()=>{
 const f=fixture();f.addPicture({id:'one',url:'picture'});const sending=f.send();f.reject({status:400});await assert.rejects(sending);assert.equal(f.pictures().length,1);
});
test('desktop explicitly selected plan mode is forwarded with the accepted message',async()=>{const f=fixture();f.options.desktopExecutionMode='plan';const pending=f.send();assert.equal(f.calls[0].body.mode,'plan');f.resolve({});await pending;});

test('desktop acceptance uses server delivery mode and suppresses notices for a changed selection',async()=>{
 for(const delivery of ['steer','start',undefined]){
  const f=fixture(),sending=f.send();f.resolve({delivery});await sending;
  assert.deepEqual(f.toasts,[[delivery==='steer'?'已提交引导，桌面将在当前轮次处理。':delivery==='start'?'已发送，桌面已启动新一轮。':'桌面已接收消息。',false]]);
 }
 const f=fixture(),sending=f.send();f.state.selectedId='other';f.state.selectionVersion++;f.resolve({delivery:'steer'});await sending;assert.deepEqual(f.toasts,[]);
});


test('desktop running send defaults to native queue and alternate input steers',async()=>{
 for(const alternate of [false,true]){const f=fixture();f.setActive(true);const sending=f.send(alternate);assert.equal(f.calls[0].body.followUp,alternate?'steer':'queue');f.resolve({delivery:alternate?'steer':'queue'});await sending;assert.equal(f.toasts[0][0].includes(alternate?'引导':'排队'),true);}
});

test('review recovery stays hidden until an in-flight send has an uncertain result',async()=>{
 const controller=readFileSync(new URL('../src/web/controller.ts',import.meta.url),'utf8');
 const assignment=controller.match(/desktopView\.reviewHidden=([^;]+);/)[1];
 const hidden=new Function('unconfirmed','posting','answering','return '+assignment);
 const f=fixture(),sending=f.send();
 assert.equal(hidden(f.sends['a/b']?.messageId,f.state.busy.has('message'),false),true);
 f.reject(Object.assign(new Error('connection lost'),{status:503}));
 await assert.rejects(sending,/connection lost/);
 assert.equal(hidden(f.sends['a/b']?.messageId,f.state.busy.has('message'),false),false);
 assert.equal(hidden(null,false,false),true);
 assert.equal(hidden('pending',false,true),true);
});
