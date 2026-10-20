import test from 'node:test';
import assert from 'node:assert/strict';
import {completedPlan,implementationText} from '../public/composer.js';
const plan={id:'plan-turn',status:'completed',items:[{type:'plan',text:' 原生计划\n保持原文 '}]};
test('offer only the latest successfully completed native plan',()=>{
 assert.deepEqual(completedPlan([plan]),{turnId:'plan-turn',text:'原生计划\n保持原文'});
 for(const status of ['inProgress','interrupted','failed',undefined])assert.equal(completedPlan([{...plan,status}]),null);
 assert.equal(completedPlan([{...plan,items:[{type:'agentMessage',text:'计划：请执行'}]}]),null);
 assert.equal(completedPlan([plan,{id:'next',status:'inProgress',items:[]}]),null);
 assert.equal(completedPlan([{...plan,items:[{type:'plan',text:' '}]}]),null);
 assert.equal(completedPlan([]),null);
});
test('implementation forwards full plan with desktop native follow-up prefix',()=>{
 assert.equal(implementationText(completedPlan([plan])),'PLEASE IMPLEMENT THIS PLAN:\n原生计划\n保持原文');
});
