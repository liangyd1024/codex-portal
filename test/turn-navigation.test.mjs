import test from 'node:test';
import assert from 'node:assert/strict';
import {turnPreview} from '../public/turn-navigation.js';
test('preview uses the first user input and final answer without splitting steer messages or tools',()=>{
 const turn={id:'native-turn',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'原始问题'}]},{type:'commandExecution',aggregatedOutput:'private tool output'},{type:'agentMessage',phase:'commentary',text:'过程'},{type:'userMessage',content:[{type:'text',text:'补充'}]},{type:'agentMessage',phase:'final_answer',text:'| 字段 | 值 |\n|---|---|\n| A | B |'}]};
 const before=JSON.stringify(turn),p=turnPreview(turn);assert.equal(p.id,'native-turn');assert.equal(p.question,'原始问题');assert.match(p.answer,/字段/);assert.equal(JSON.stringify(turn),before);
});
test('goal, attachment-only, continuation and uncertain live turns keep accurate labels',()=>{
 assert.equal(turnPreview({items:[{type:'goalMessage',objective:'目标原文'}]}).question,'目标原文');
 assert.equal(turnPreview({items:[{type:'userMessage',content:[{type:'image',url:'test'}]}]}).question,'图片消息');
 assert.equal(turnPreview({status:'inProgress',items:[]}).question,'继续执行');
 const unknown=turnPreview({status:{type:'inProgress'}},{uncertain:true});assert.equal(unknown.status,'状态待确认');assert.equal(unknown.running,false);
});
test('preview truncates without changing original messages or breaking unicode',()=>{
 const text='😀'.repeat(200);const p=turnPreview({items:[{type:'userMessage',content:[{type:'text',text}]},{type:'agentMessage',text:'x'.repeat(1200)}]});
 assert.equal(Array.from(p.question).length,181);assert.ok(p.question.endsWith('😀…'));assert.equal(p.answer.length,1001);
});
