import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopNotifications} from '../lib/desktop-notifications.mjs';
const setup=()=>{const events=[];return {events,n:new DesktopNotifications((method,params)=>events.push({method,params}))};};
const patch=(path,value)=>({op:'replace',path,value});
test('desktop completion uses only live running-to-terminal transitions and excludes transcript text',()=>{
 const {n,events}=setup();n.snapshot('t',{threadGoal:null,turns:[{turnId:'a',status:'inProgress',items:[{text:'private'}]}]});
 assert.equal(JSON.stringify(n.states.get('t')).includes('private'),false);
 n.patches('t',[patch(['turns',0,'items',0,'text'],'output')]);assert.equal(events.length,0);
 n.patches('t',[patch(['turns',0,'status'],'completed')]);assert.equal(events.length,1);assert.equal(events[0].params.turn.id,'a');assert.equal(events[0].params.notificationGoalKnown,true);
 n.patches('t',[patch(['turns',0,'status'],'completed')]);assert.equal(events.length,1);
 n.snapshot('t',{threadGoal:null,turns:[{turnId:'b',status:'completed'}]});assert.equal(events.length,1);
 n.patches('t',[{op:'add',path:['turns',1],value:{turnId:'old',status:'completed'}}]);assert.equal(events.length,1);
});
test('canonical history uses referenced entities and handles failed/interrupted turns',()=>{
 for(const status of ['failed','interrupted']){const {n,events}=setup();n.snapshot('t',{threadGoal:null,turnHistory:{kind:'canonical',history:{entitiesByKey:{a:{turnId:'a',status:'inProgress'},stale:{turnId:'stale',status:'inProgress'}},islands:[{entries:[{value:'a'}]}]}}});
 n.patches('t',[patch(['turnHistory','history','entitiesByKey','a','status'],status),patch(['turnHistory','history','entitiesByKey','stale','status'],'completed')]);assert.equal(events.length,1);assert.equal(events[0].params.turn.status,status);}
});
test('goal terminal transitions notify once, and suppress the associated ordinary completion',()=>{
 const {n,events}=setup();n.snapshot('t',{threadGoal:{createdAt:1,status:'active'},turns:[{turnId:'a',status:'inProgress'}]});
 n.patches('t',[patch(['threadGoal','status'],'complete'),patch(['turns',0,'status'],'completed')]);assert.equal(events[0].method,'thread/goal/updated');assert.equal(events[1].params.notificationGoal.status,'complete');
 n.patches('t',[patch(['threadGoal','status'],'complete')]);assert.equal(events.length,2);
});
test('resynchronization drops prior state and malformed patches cannot mutate prototypes',()=>{
 const {n,events}=setup();n.snapshot('t',{threadGoal:null,turns:[{turnId:'a',status:'inProgress'}]});n.clear();n.patches('t',[patch(['turns',0,'status'],'completed')]);assert.equal(events.length,0);
 n.snapshot('t',{turns:[]});assert.throws(()=>n.patches('t',[patch(['__proto__','polluted'],true)]));assert.equal({}.polluted,undefined);
});
test('an ordinary turn after a completed goal still notifies without inheriting that goal',()=>{
 const {n,events}=setup();n.snapshot('t',{threadGoal:{status:'complete',createdAt:1},turns:[{turnId:'a',status:'inProgress'}]});
 n.patches('t',[patch(['turns',0,'status'],'completed')]);assert.equal(events[0].params.notificationGoal,null);
});
