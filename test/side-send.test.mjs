import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSendReceipts} from '../public/connection-state.js';
import {applySideEvent} from '../shared/side-chat-events.js';
import {annotatedText} from '../public/response-annotations.js';
const source=readFileSync(new URL('../public/side-chat.js',import.meta.url),'utf8');
function fixture(active=false){
 const selected={id:'side-a',draft:'中文请求',selections:[{text:'选文'}],turns:[],active,model:'test',effort:'medium'};
 const receipts=createSendReceipts(),calls=[];let resolve,reject,view=[];
 const c=vm.createContext({selected,input:{value:selected.draft},localContext:()=>({ready:true}),attachments:{pending:()=>false,capture:()=>({items:[]}),acknowledge:()=>{}},composer:{options:()=>({})},notify:()=>{},annotatedText,sendReceipts:receipts,applySideEvent,stateOf:t=>t?.status?.type||t?.status,
  api:(path,options)=>{calls.push({path,options});return new Promise((ok,fail)=>{resolve=ok;reject=fail;});},render:()=>{view=receipts.view(c.selected,c.selected.turns);}});
 vm.runInContext(source.slice(source.indexOf(' async function submit('),source.indexOf(' function renderControls(')),c);
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
