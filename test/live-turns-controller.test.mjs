import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync(new URL('../src/web/services/live-turns.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('../../../public/connection-state.js',new URL('../public/connection-state.js',import.meta.url).href);
const {createLiveTurns}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const fixture=()=>{const state={detail:{turns:[],opaque:{keep:true}}};return{state,...createLiveTurns({state,turns:()=>state.detail?.turns||[]})};};
test('live updates use the current detail only and reuse an existing turn',()=>{
 const f=fixture(),first=f.ensureTurn('t');assert.equal(f.ensureTurn('t'),first);assert.equal(f.state.detail.turns.length,1);const old=f.state.detail;f.state.detail=null;
 assert.equal(f.ensureTurn('ignored'),null);f.upsertTurn({id:'ignored',items:[]});f.upsertItem('ignored',{id:'i',type:'agentMessage',text:'ignored'});assert.equal(old.turns.length,1);
 f.state.detail={turns:[]};f.ensureTurn(undefined);assert.equal(f.state.detail.turns[0].id,'live');assert.equal(old.turns.length,1);
});
test('native user echoes remove only matching optimistic content and preserve other images',()=>{
 const f=fixture(),text=[{type:'text',text:'原文\n中文'}],image=[{type:'image',url:'data:image/png;base64,fixture'}];
 f.upsertTurn({id:'t',items:[{id:'echo',type:'userMessage',localAccepted:true,content:text},{id:'image',type:'userMessage',localAccepted:true,content:image}]});
 const native={id:'native',type:'userMessage',content:text,future:{value:'保留'}};f.upsertItem('t',native);
 assert.deepEqual(f.state.detail.turns[0].items.map(x=>x.id),['image','native']);assert.equal(f.state.detail.turns[0].items[1],native);assert.equal(native.future.value,'保留');
});
test('late short output cannot truncate text, restore active state, or replace its output token',()=>{
 const f=fixture();f.upsertTurn({id:'t',status:'completed',items:[{id:'cmd',type:'commandExecution',status:'completed',aggregatedOutput:'完整输出\n不可截断',outputToken:'full',future:{keep:true}}]});
 f.upsertItem('t',{id:'cmd',type:'commandExecution',status:'inProgress',aggregatedOutput:'完整',outputToken:'short',later:{keep:true}});
 const item=f.state.detail.turns[0].items[0];assert.equal(item.aggregatedOutput,'完整输出\n不可截断');assert.equal(item.status,'completed');assert.equal(item.outputToken,'full');assert.deepEqual(item.future,{keep:true});assert.deepEqual(item.later,{keep:true});
 f.upsertTurn({id:'t',status:'inProgress',items:[]});assert.equal(f.state.detail.turns[0].status,'completed');
});
test('turn refresh retains complete streamed text and unknown record references',()=>{
 const f=fixture(),opaque={value:['未知原文',42]};f.upsertTurn({id:'latest',items:[{id:'a',type:'agentMessage',text:'完整正文',opaque}]});
 f.upsertTurn({id:'latest',items:[{id:'a',type:'agentMessage',text:'完整'}],futureTurn:opaque});
 const t=f.state.detail.turns[0];assert.equal(t.items[0].text,'完整正文');assert.equal(t.items[0].opaque,opaque);assert.equal(t.futureTurn,opaque);assert.deepEqual(f.state.detail.opaque,{keep:true});
});
