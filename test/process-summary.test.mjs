import test from 'node:test';
import assert from 'node:assert/strict';
import {processSummary} from '../public/process-summary.js';
import {groupTurnItems} from '../public/message-body.js';
const command = (extra={}) => ({id:'command',type:'commandExecution',status:'completed',exitCode:0,...extra});
test('native actions become ordered compact summaries without inspecting command text',()=>{
 const items=[command({commandActions:[{type:'read'},{type:'search'},{type:'read'},{type:'unknown'}]})];
 assert.equal(processSummary({status:'completed'},items).label,'已读取文件、已搜索文件、运行了命令');
 assert.equal(processSummary({},[command({command:'cat file.txt'})]).label,'运行了命令');
 assert.equal(processSummary({},[command({commandActions:[{type:'newAction'}]})]).label,'运行了命令');
});
test('running, failed, disconnected and stale historical commands do not claim success',()=>{
 const pending=[command({status:'inProgress',exitCode:null})];
 assert.equal(processSummary({status:'inProgress',items:pending},pending).status,'执行中');
 assert.equal(processSummary({status:'inProgress',items:pending},pending,{uncertain:true}).status,'状态未确认');
 for (const status of ['completed','failed','interrupted','declined','systemError']) assert.equal(processSummary({status},pending).status,'');
 const failed=processSummary({status:'failed'},[command({exitCode:1})]);
 assert.equal(failed.label,'运行了命令');assert.equal(failed.status,'');
 assert.equal(processSummary({status:'completed'},pending,{background:{terminals:[{itemId:'command'}]}}).status,'后台命令仍在运行');
});
test('thinking is live only at the current native reasoning item',()=>{
 const item={type:'reasoning'},turn={status:'inProgress',items:[item]};
 assert.equal(processSummary(turn,[item]).label,'正在思考');
 assert.notEqual(processSummary(turn,[item],{uncertain:true}).label,'正在思考');
 assert.equal(processSummary({...turn,status:'interrupted'},[item]).status,'');
 assert.equal(processSummary({...turn,items:[item,command()]},[item]).status,'');
});
test('commentary separates live action summaries and completed answer folds original process',()=>{
 const items=[{type:'agentMessage',phase:'commentary',text:'先检查。'},command(),{type:'agentMessage',phase:'commentary',text:'已找到。'},command({id:'second'}),{type:'agentMessage',phase:'final_answer',text:'完成。'}];
 const before=JSON.stringify(items);
 assert.deepEqual(groupTurnItems({status:'inProgress',items}).map(g=>g.type),['message','process','message','process','message']);
 const ended=groupTurnItems({status:'completed',items});
 assert.equal(ended.length,2);assert.deepEqual(ended[0].items,items.slice(0,-1));
 assert.equal(JSON.stringify(items),before);
});

test('mixed command outcomes deduplicate by action, keeping original errors in items',()=>{
 const items=[command({commandActions:[{type:'read'}]}),command({exitCode:1}),command(),command({status:'inProgress',exitCode:null})];
 const before=JSON.stringify(items);
 const value=processSummary({status:'inProgress',items:[...items,{type:'agentMessage',text:'继续。'}]},items);
 assert.equal(value.label,'已读取文件、运行了命令');assert.equal(value.status,'');assert.equal(value.icon,'book');
 assert.equal(JSON.stringify(items),before);
});
test('integrations use native display names and never expose implementation tool names',()=>{
 const items=[{type:'mcpToolCall',tool:'js',server:'computer',appContext:{appName:'Example App'}},command(),{type:'mcpToolCall',tool:'js',appContext:{appName:'Example App'}}];
 const value=processSummary({status:'completed'},items);
 assert.equal(value.label,'已使用 Example App 集成、运行了命令');assert.equal(value.icon,'integration');
 assert.equal(processSummary({},[{type:'mcpToolCall',tool:'js',pluginId:'private-id'}]).label,'已使用集成');
});
test('empty historical reasoning adds no disclosure but nonempty original summaries remain available',()=>{
 const empty={type:'reasoning',summary:[],content:[]};
 assert.equal(processSummary({status:'inProgress',items:[empty,command()]},[empty]).hidden,true);
 assert.equal(processSummary({status:'inProgress',items:[empty]},[empty]).hidden,false);
 assert.equal(processSummary({status:'completed'},[{...empty,summary:['说明']}]).hidden,false);
});

test('shared process disclosure preserves original items and renders live, uncertain and timed states',async t=>{
 const {renderProcessGroup}=await import('../public/process-summary.js');
 class Node {children=[];dataset={};className='';textContent='';classList={add:value=>{this.className+=' '+value;}};append(...nodes){this.children.push(...nodes);}}
 const previous=globalThis.document;globalThis.document={createElement:()=>new Node()};
 t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document;});
 const item={id:'thinking',type:'reasoning',summary:[]},turn={status:'inProgress',items:[item]},seen=[];
 const options={itemId:'side-process-t-thinking',icon:()=>new Node(),renderItem:item=>{seen.push(item);return new Node();},open:true};
 const live=renderProcessGroup(turn,{items:[item]},options);
 assert.equal(live.children[0].children[1].textContent,'正在思考');assert.equal(live.open,true);assert.equal(seen[0],item);
 const uncertain=renderProcessGroup(turn,{items:[item]},{...options,uncertain:true});
 assert.equal(uncertain.children[0].children[1].textContent,'状态未确认');
 assert.equal(renderProcessGroup({...turn,status:'completed'},{items:[item]},options),null);
 const timed=renderProcessGroup({...turn,status:'completed'},{items:[item],durationLabel:'用时 3秒'},options);
 assert.match(timed.className,/has-duration/);assert.equal(timed.children[0].children[1].textContent,'用时 3秒');
 assert.match(timed.children[0].children.at(-1).className,/process-chevron/);
});
