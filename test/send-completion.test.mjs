import test from 'node:test';
import assert from 'node:assert/strict';
import {createSendReceipts} from '../public/connection-state.js';
import {createMessageSend} from '../src/web/services/message-send.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const response=deferred(),history=deferred(),errors=[],calls=[];
 const input={value:'中文草稿'},button={disabled:false},drafts=new Map([['a',input.value]]);
 drafts.capture=(id,text)=>({id,text});drafts.acknowledge=sent=>{if(drafts.get(sent.id)!==sent.text)return false;drafts.delete(sent.id);return true;};
 const state={selectedId:'a',selectionVersion:1,busy:new Set(),drafts,detail:{turns:[]}};
 const context={state,newChatOpen:false,targetHost:'local',$:id=>id==='message-input'?input:button,
 annotations:{capture:()=>({items:[]}),acknowledge(){}},annotatedText:text=>text,
 attachments:{has:()=>false,pending:()=>false,capture:()=>({items:[]}),acknowledge(){}},
 usable:()=>true,controlled:()=>true,running:()=>false,touchInput:()=>false,followUpAction:()=>null,
 composer:{validateSend(){},options:()=>({threads:[]}),prepareSend:async()=>false},
 turns:()=>state.detail.turns,sendReceipts:createSendReceipts(),scrollFollow:null,
 renderMessages(){},renderThread(){},resizeInput(){},upsertTurn:turn=>state.detail.turns.push(turn),
 api(){},sendAfterGoal:()=>{calls.push('send');return response.promise;},
 refreshSelected:()=>{calls.push('history');return history.promise;},recordError:error=>errors.push(error),
 action:async(key,fn)=>{state.busy.add(key);try{await fn();}finally{state.busy.delete(key);}},
 };
 context.sendMessage=createMessageSend({state,input:()=>input,disabled:()=>button.disabled,
 newChatOpen:()=>context.newChatOpen,createThread:()=>context.createThreadFromDraft(),sendDesktop:()=>context.sendDesktopMessage(),host:()=>context.targetHost,
 captureAnnotation:()=>context.annotations.capture(),annotatedText:(text,draft)=>context.annotatedText(text,draft.items),acknowledgeAnnotation:draft=>context.annotations.acknowledge(draft),
 hasAttachments:()=>context.attachments.has(),attachmentsPending:()=>context.attachments.pending(),captureAttachments:()=>context.attachments.capture(),acknowledgeAttachments:pictures=>context.attachments.acknowledge(pictures),
 captureDraft:(id,text)=>state.drafts.capture(id,text),acknowledgeDraft:draft=>state.drafts.acknowledge(draft),usable:()=>context.usable(),controlled:()=>context.controlled(),running:()=>context.running(),touch:()=>context.touchInput(),followUp:options=>context.followUpAction(options),
 validate:(...args)=>context.composer.validateSend(...args),options:()=>context.composer.options(),goalPending:()=>context.composer.isGoalPending(),prepare:(...args)=>context.composer.prepareSend(...args),
 send:args=>context.sendAfterGoal({...args,api:context.api}),post:(path,body)=>context.api(path,{method:'POST',body}),receipts:context.sendReceipts,turns:()=>context.turns(),action:context.action,
 renderMessages:()=>context.renderMessages(),followScroll:()=>context.scrollFollow?.schedule(),resize:()=>context.resizeInput(),upsert:turn=>context.upsertTurn(turn),renderThread:()=>context.renderThread(),refresh:()=>context.refreshSelected(),recordError:context.recordError,toast:(...args)=>context.toast(...args)});
 return {context,state,input,button,response,history,errors,calls,send:()=>context.sendMessage()};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('native acceptance releases send lock while history is still pending; duplicate submission stays blocked',async()=>{
 const f=fixture();let settled=false;const sending=f.send().then(()=>settled=true);await flush();
 assert.equal(f.state.busy.has('message'),true);await f.send();assert.deepEqual(f.calls,['send']);
 f.response.resolve({turn:{id:'t',status:'inProgress',items:[]}});await flush();
 assert.equal(settled,true);assert.equal(f.state.busy.has('message'),false);assert.equal(f.input.value,'');
 assert.deepEqual(f.calls,['send','history']);assert.equal(f.context.sendReceipts.view('local:a',[])[0].status,'accepted');
 f.history.reject(new Error('同步失败'));await flush();assert.equal(f.errors[0].message,'同步失败');assert.equal(f.calls.filter(x=>x==='send').length,1);await sending;
});
test('failed native submission retains draft and does not start history sync',async()=>{
 const f=fixture(),sending=f.send();await flush();f.response.reject(Object.assign(new Error('发送失败'),{status:409}));
 await assert.rejects(sending,/发送失败/);assert.equal(f.input.value,'中文草稿');assert.equal(f.state.busy.size,0);assert.deepEqual(f.calls,['send']);
});
test('changed selection is not rendered or refreshed by late send acknowledgement',async()=>{
 const f=fixture(),sending=f.send();await flush();f.state.selectedId='b';f.state.selectionVersion++;f.input.value='另一会话草稿';
 f.response.resolve({turn:{id:'t',status:'inProgress',items:[]}});await sending;
 assert.equal(f.input.value,'另一会话草稿');assert.deepEqual(f.state.detail.turns,[]);assert.deepEqual(f.calls,['send']);
});
test('text entered while the accepted request is pending survives acknowledgement',async()=>{
 const f=fixture(),sending=f.send();await flush();f.input.value='新的中文草稿';f.state.drafts.set('a',f.input.value);
 f.response.resolve({turn:{id:'t',status:'inProgress',items:[]}});await flush();
 assert.equal(f.input.value,'新的中文草稿');assert.equal(f.state.drafts.get('a'),'新的中文草稿');assert.equal(f.state.busy.size,0);
 f.history.resolve();await sending;
});

test('message keeps annotations, image URLs and composer options and acknowledges captured snapshots only',async()=>{
 const f=fixture(),ack=[],annotation={items:[{text:'批注'}]},pictures={items:[{url:'data:image/png;base64,AA==',extra:'internal'}]};
 f.state.model='fixture-model';f.state.effort='high';
 f.context.annotations={capture:()=>annotation,acknowledge:value=>ack.push(['annotation',value])};
 f.context.annotatedText=(text,items)=>text+'\n'+items[0].text;
 f.context.attachments={has:()=>true,pending:()=>false,capture:()=>pictures,acknowledge:value=>ack.push(['images',value])};
 f.context.composer.options=()=>({threads:[],skills:[{name:'skill'}],plugins:[{id:'plugin'}],mode:'plan',access:'full',unknown:{keep:true}});
 let payload;f.context.sendAfterGoal=async args=>{payload=args.payload;return {turn:{id:'native',unknown:{keep:true}}};};
 await f.send();assert.deepEqual(payload,{text:'中文草稿\n批注',images:[{url:'data:image/png;base64,AA=='}],model:'fixture-model',effort:'high',threads:[],skills:[{name:'skill'}],plugins:[{id:'plugin'}],mode:'plan',access:'full',unknown:{keep:true}});
 assert.equal(ack[0][1],pictures);assert.equal(ack[1][1],annotation);assert.deepEqual(f.state.detail.turns,[{id:'native',unknown:{keep:true}}]);f.history.resolve();
});
test('active queue submission replaces matching native queue row and keeps other fields',async()=>{
 const f=fixture();f.context.running=()=>true;f.context.followUpAction=()=> 'queue';
 f.state.detail.queue={data:[{id:'q',old:true},{id:'other'}],nextCursor:'opaque',unknown:true};
 f.context.composer.options=()=>({threads:[],skills:['skill'],plugins:['plugin'],mode:'plan'});
 const sent=[];f.context.api=async(path,options)=>{sent.push([path,options]);return {queuedSubmission:{id:'q',input:[{type:'text',text:'原文'}],unknown:{keep:true}}};};
 await f.send();assert.deepEqual(sent,[['/api/threads/a/queue-add',{method:'POST',body:{text:'中文草稿',images:[],skills:['skill'],plugins:['plugin'],threads:[]}}]]);
 assert.deepEqual(f.state.detail.queue,{data:[{id:'other'},{id:'q',input:[{type:'text',text:'原文'}],unknown:{keep:true}}],nextCursor:'opaque',unknown:true});
 assert.deepEqual(f.context.sendReceipts.view('local:a',[]),[]);assert.equal(f.input.value,'');f.history.resolve();
});
test('goal preparation failure keeps draft and marks provisional receipt failed without submitting',async()=>{
 const f=fixture();f.context.composer.prepareSend=async()=>{throw Error('目标尚未确认');};
 await assert.rejects(f.send(),/目标尚未确认/);assert.deepEqual(f.calls,[]);assert.equal(f.input.value,'中文草稿');assert.equal(f.state.busy.size,0);assert.equal(f.context.sendReceipts.view('local:a',[])[0].status,'failed');
});
test('thread references remain rejected for active turns and pending goals before creating receipts',async()=>{
 for(const active of [true,false]){const f=fixture();f.context.running=()=>active;f.context.composer.isGoalPending=()=>!active;f.context.composer.options=()=>({threads:[{id:'reference'}]});
 await assert.rejects(f.send(),/单独发送会话引用/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.context.sendReceipts.view('local:a',[]),[]);assert.equal(f.input.value,'中文草稿');assert.equal(f.state.busy.size,0);}
});
