import test from 'node:test';
import assert from 'node:assert/strict';
import {processSummary} from '../public/process-summary.js';
import {groupTurnItems} from '../public/message-body.js';
const command = (extra={}) => ({id:'command',type:'commandExecution',status:'completed',exitCode:0,...extra});
test('native actions become ordered compact summaries without inspecting command text',()=>{
 const items=[command({commandActions:[{type:'read'},{type:'search'},{type:'read'},{type:'unknown'}]})];
 assert.equal(processSummary({status:'completed'},items).label,'已读取文件 · 已搜索文件 · 运行了命令');
 assert.equal(processSummary({},[command({command:'cat file.txt'})]).label,'运行了命令');
 assert.equal(processSummary({},[command({commandActions:[{type:'newAction'}]})]).label,'运行了命令');
});
test('running, failed, disconnected and stale historical commands do not claim success',()=>{
 const pending=[command({status:'inProgress',exitCode:null})];
 assert.equal(processSummary({status:'inProgress'},pending).status,'执行中');
 assert.equal(processSummary({status:'inProgress'},pending,{uncertain:true}).status,'状态未确认');
 for (const status of ['completed','failed','interrupted','declined','systemError']) assert.equal(processSummary({status},pending).status,'');
 const failed=processSummary({status:'failed'},[command({exitCode:1})]);
 assert.equal(failed.label,'运行命令');assert.equal(failed.status,'执行未成功');
 assert.equal(processSummary({status:'completed'},pending,{background:{terminals:[{itemId:'command'}]}}).status,'后台命令仍在运行');
});
test('thinking is live only at the current native reasoning item',()=>{
 const item={type:'reasoning'},turn={status:'inProgress',items:[item]};
 assert.equal(processSummary(turn,[item]).status,'正在思考');
 assert.notEqual(processSummary(turn,[item],{uncertain:true}).status,'正在思考');
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
