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
 let attachments=false,ack=0,resizes=0,refreshes=0;
 const send=createDesktopSend({state,input:()=>input,captureAnnotation:()=>annotation,annotatedText:(text,a)=>text+'\n'+a.items.join(''),acknowledgeAnnotation:a=>{assert.equal(a,annotation);ack++},hasAttachments:()=>attachments,options:()=>options,captureDraft:(id,text)=>({id,text}),acknowledgeDraft:d=>{if(drafts.get(d.id)!==d.text)return false;drafts.delete(d.id);return true},sends,saveSends:()=>saved.push(structuredClone(sends)),uuid:()=> 'stable-uuid',action:async(key,run)=>{state.busy.add(key);try{return await run()}finally{state.busy.delete(key)}},post:(path,body)=>{calls.push({path,body});return pending},refresh:async()=>{refreshes++},resize:()=>resizes++,toast:(...args)=>toasts.push(args)});
 return{state,input,sends,calls,saved,toasts,drafts,options,send,resolve,reject,setAttachments:v=>attachments=v,counts:()=>({ack,resizes,refreshes})};
}
test('desktop send saves receipt before posting; duplicate requests are blocked and confirmed text is cleared',async()=>{
 const f=fixture(),sending=f.send();assert.deepEqual(f.saved,[{'a/b':{messageId:'stable-uuid',text:' 中文草稿 '}}]);await f.send();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{path:'/api/desktop/threads/a%2Fb/message',body:{messageId:'stable-uuid',text:'中文草稿\n注释',threads:[{id:'reference',unknown:{keep:true}}]}});f.resolve({accepted:true});await sending;assert.equal(f.input.value,'');assert.deepEqual(f.sends,{});assert.deepEqual(f.counts(),{ack:1,resizes:1,refreshes:1});assert.equal(f.state.busy.size,0);
});
test('late desktop acceptance preserves another selection or edits made during the request',async()=>{
 for(const changeSelection of [false,true]){const f=fixture(),sending=f.send();if(changeSelection){f.state.selectedId='b';f.state.selectionVersion++}f.input.value='新草稿';f.drafts.set(f.state.selectedId,f.input.value);f.resolve({});await sending;assert.equal(f.input.value,'新草稿');assert.equal(f.drafts.get(f.state.selectedId),'新草稿');assert.deepEqual(f.counts(),{ack:1,resizes:0,refreshes:changeSelection?0:1});assert.deepEqual(f.sends,{})}
});
test('unknown results retain receipt and draft; definite client rejection permits a later retry',async()=>{
 for(const error of [{status:400,code:'INVALID_REQUEST'},{status:409,code:'OUTCOME_UNKNOWN'},{status:409,code:'SEND_PENDING'},{status:503},{}]){const f=fixture(),sending=f.send();f.reject(Object.assign(new Error('拒绝'),error));await assert.rejects(sending,/拒绝/);assert.equal(f.input.value,' 中文草稿 ');assert.equal(f.drafts.get('a/b'),f.input.value);assert.equal(Boolean(f.sends['a/b']),error.code!=='INVALID_REQUEST');assert.deepEqual(f.counts(),{ack:0,resizes:0,refreshes:1});assert.equal(f.state.busy.size,0)}
});
test('desktop capability and unsupported attachment/reference guards do not create receipts or requests',async()=>{
 for(const guard of ['capability','busy','pending','attachment','skill','plugin']){const f=fixture();if(guard==='capability')f.state.detail.desktop.canSend=false;if(guard==='busy')f.state.busy.add('message');if(guard==='pending')f.sends['a/b']={messageId:'prior',text:'prior'};if(guard==='attachment')f.setAttachments(true);if(guard==='skill')f.options.skills.push({id:'skill'});if(guard==='plugin')f.options.plugins.push({id:'plugin'});await f.send();assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);assert.equal(f.toasts.length,['attachment','skill','plugin'].includes(guard)?1:0);assert.equal(f.input.value,' 中文草稿 ')}
});
