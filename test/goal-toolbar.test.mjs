import test from 'node:test';
import assert from 'node:assert/strict';
import {goalPresentation} from '../public/goal-toolbar.js';
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
