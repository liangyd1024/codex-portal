import test from 'node:test';
import assert from 'node:assert/strict';
import {goalPresentation,completedGoalPlacement} from '../public/goal-toolbar.js';
test('goal controls reflect native lifecycle rather than turn completion',()=>{
 for(const status of ['paused','blocked'])assert.equal(goalPresentation({status}).action,'active');
 assert.equal(goalPresentation({status:'active'}).action,'paused');
 for(const status of ['complete','budgetLimited','usageLimited','future'])assert.equal(goalPresentation({status}).action,null);
});
test('missing goals hide the bar while failed reads retain uncertainty without actions',()=>{
 assert.equal(goalPresentation(null).visible,false);
 assert.deepEqual(goalPresentation({status:'active'},'offline'),{visible:true,label:'目标待确认',action:null});
 assert.equal(goalPresentation(null,'offline').visible,true);
});

test('completed goal leaves the composer and stays beside its original turn',()=>{
 const goal={status:'complete',objective:'原目标',createdAt:10,updatedAt:25};
 assert.equal(goalPresentation(goal).visible,false);
 const original={id:'original',startedAt:20},followup={id:'followup',startedAt:30};
 assert.deepEqual(completedGoalPlacement(goal,[original,followup]),{goal,turnId:'original'});
 assert.equal(completedGoalPlacement(goal,[followup]).turnId,null);
 assert.equal(completedGoalPlacement(goal,[]).turnId,null);
 for(const status of ['active','paused','blocked','usageLimited','budgetLimited'])assert.equal(completedGoalPlacement({...goal,status},[original]),null);
 assert.equal(completedGoalPlacement(goal,[original],'offline'),null);
 assert.equal(goalPresentation(goal,'offline').visible,true);
});
