import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createSendReceipts} from '../public/connection-state.js';
import {applySideEvent} from '../shared/side-chat-events.js';
import {messageInput} from '../lib/message-input.mjs';
import {annotatedText} from '../public/response-annotations.js';
const source=readFileSync(new URL('../src/web/services/side-chat.ts',import.meta.url),'utf8');
const parsed=ts.createSourceFile('side-chat.ts',source,ts.ScriptTarget.Latest,true);
function functionCode(name){let found;const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;else ts.forEachChild(node,visit);};visit(parsed);assert.ok(found,'missing side function '+name);return ts.transpileModule(found.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;}

function fixture(active=false){
 const selected={id:'side-a',draft:'中文请求',selections:[{text:'选文'}],turns:[],active,model:'test',effort:'medium'};
 const receipts=createSendReceipts(),calls=[];let resolve,reject,view=[];
 const c=vm.createContext({selected,input:{value:selected.draft},localContext:()=>({ready:true}),attachments:{pending:()=>false,capture:()=>({items:[]}),acknowledge:()=>{}},composer:{options:()=>({})},notify:()=>{},annotatedText,sendReceipts:receipts,applySideEvent,stateOf:t=>t?.status?.type||t?.status,
  api:(path,options)=>{calls.push({path,options});return new Promise((ok,fail)=>{resolve=ok;reject=fail;});},render:()=>{view=receipts.view(c.selected,c.selected.turns);}});
 vm.runInContext(functionCode('submit'),c);
 return {c,selected,calls,receipts,view:()=>view,resolve:v=>resolve(v),reject:e=>reject(e)};
}
test('side submission renders before HTTP settles, blocks duplicates and acknowledges turnId',async()=>{
 const f=fixture(true),sending=f.c.submit();
 assert.equal(f.view()[0].status,'sending');assert.match(f.view()[0].content[0].text,/选文/);assert.match(f.view()[0].content[0].text,/中文请求/);
 assert.equal(f.selected.turns.length,0);assert.equal(f.c.input.value,'中文请求');
 await f.c.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/threads/side-a/steer');
 f.resolve({turnId:'native-turn'});await sending;assert.equal(f.view()[0].status,'accepted');assert.equal(f.c.input.value,'');
});
test('native event before side HTTP removes the receipt without duplicate or late resurrection',async()=>{
 const f=fixture(),sending=f.c.submit(),content=f.view()[0].content;
 applySideEvent(f.selected.turns,'item/completed',{turnId:'t',item:{id:'native-input',type:'userMessage',content}});
 f.c.render();assert.equal(f.view().length,0);
 f.resolve({turn:{id:'t',status:'inProgress',items:[]}});await sending;
 assert.equal(f.view().length,0);assert.equal(f.selected.turns[0].items.length,1);
});
test('side rejection preserves drafts; ambiguous server failure blocks automatic retry',async()=>{
 for(const [status,expected] of [[409,'failed'],[503,'unknown']]){
  const f=fixture(),sending=f.c.submit();f.reject(Object.assign(Error('send failed'),{status}));await assert.rejects(sending,/send failed/);
  assert.equal(f.view()[0].status,expected);assert.equal(f.selected.draft,'中文请求');assert.equal(f.selected.selections.length,1);
  assert.equal(f.selected.uncertain,expected==='unknown');if(f.selected.uncertain){await f.c.submit();assert.equal(f.calls.length,1);}
 }
});
test('late side acknowledgement cannot replace the newly selected chat draft',async()=>{
 const f=fixture(),sending=f.c.submit();f.c.selected={id:'side-b',draft:'新的草稿',turns:[]};f.c.input.value='新的草稿';
 f.resolve({turnId:'t'});await sending;assert.equal(f.c.input.value,'新的草稿');assert.equal(f.receipts.view(f.c.selected,[]).length,0);
 assert.equal(f.receipts.view(f.selected,[])[0].status,'accepted');
});

test('replacing an expired side chat preserves unsent text and attachments but does not replay history',async()=>{const old={id:'expired',expired:true,parent:'parent',draft:'保留草稿',selections:[{text:'选文'}],turns:[{id:'old-turn'}]},moves=[],created=[];const c=vm.createContext({selected:old,chats:new Map(),input:{value:old.draft},crypto:{randomUUID:()=> 'new-request'},attachments:{moveDraft:(...args)=>moves.push(args)},render(){},create:async s=>created.push(s)});vm.runInContext(functionCode('restartExpired'),c);await c.restartExpired();assert.equal(c.selected.parent,'parent');assert.equal(c.selected.draft,old.draft);assert.equal(c.selected.turns.length,0);assert.equal(c.selected.selections[0].text,'选文');assert.deepEqual(moves,[['expired','new-request']]);assert.equal(created.length,1);assert.equal(old.turns.length,1);});

test('side receipt matches the server-normalized selection input before and after HTTP acknowledgement',async()=>{
 for(const active of [false,true])for(const eventFirst of [false,true]){
  const f=fixture(active);f.selected.draft='  中文请求\n保留内部换行  ';f.c.input.value=f.selected.draft;const sending=f.c.submit();
  const native=messageInput(f.calls[0].options.body.text),result=active?{turnId:'native-turn'}:{turn:{id:'native-turn',status:'inProgress',items:[]}};
  if(!eventFirst){f.resolve(result);await sending;}
  applySideEvent(f.selected.turns,'item/completed',{turnId:'native-turn',item:{id:'native-input',type:'userMessage',content:native}});
  applySideEvent(f.selected.turns,'item/completed',{turnId:'native-turn',item:{id:'reply',type:'agentMessage',text:'真实回复'}});
  f.c.render();assert.equal(f.view().length,0,'native input replaces the pending bubble');
  if(eventFirst){f.resolve(result);await sending;}
  assert.equal(f.view().length,0);assert.equal(f.selected.turns[0].items.filter(i=>i.type==='userMessage').length,1);
  assert.match(native[0].text,/中文请求\n保留内部换行/);assert.equal(f.calls.length,1);
 }
});

test('side drafts are editable during native creation, failure, expiry and disconnection; sending stays gated',()=>{
 const selected={model:'test',effort:'medium',selections:[{text:'quote'}]};let controls;
 const c=vm.createContext({selected,context:()=>({ready:true,models:[{id:'test',efforts:['medium']}]}),localContext:()=>({ready:!!selected.id&&!selected.expired}),input:{value:'草稿'},view:{renderControls:value=>{controls=value;}},attachments:{pending:()=>false,render(){}},composer:null});
 vm.runInContext(functionCode('renderControls'),c);
 for(const state of [{creating:true},{creating:false,error:'创建失败'},{id:'side-a',expired:true},{id:undefined,expired:false}]){
  Object.assign(selected,state);c.renderControls();assert.equal(controls.inputDisabled,false);assert.equal(controls.sendDisabled,true);assert.equal(c.input.value,'草稿');
 }
 Object.assign(selected,{id:'side-a',expired:false,error:''});c.renderControls();assert.equal(controls.sendDisabled,false);
 selected.busy=true;c.renderControls();assert.equal(controls.inputDisabled,true);assert.equal(controls.sendDisabled,true);
});

test('pending native side creation is deduplicated and preserves typed drafts without sending',async()=>{
 const selected={parent:'parent',requestId:'request',draft:''},calls=[];let resolve;
 const c=vm.createContext({selected,attachments:{moveDraft(){}},render(){},requestsChanged(){},notify(){},api:(path)=>{calls.push(path);return new Promise(r=>resolve=r);}});
 vm.runInContext(functionCode('create'),c);
 const pending=c.create(selected);await c.create(selected);selected.draft='等待期间输入';
 resolve({thread:{id:'side-a'}});await pending;assert.equal(selected.draft,'等待期间输入');assert.equal(selected.id,'side-a');assert.equal(selected.creating,false);assert.deepEqual(calls,['/api/threads/parent/side-chat']);
});
