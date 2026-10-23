import {test} from 'node:test';import assert from 'node:assert/strict';import {selectConnectionStatus} from '../public/connection-state.js';
const status=(state,revision,instanceId='server-a')=>({connection:{state},revision,instanceId});
test('a late accepted HTTP reply cannot replace a newer connection failure',()=>{
 const failed=status('error',3);assert.equal(selectConnectionStatus(failed,status('connecting',1)),failed);
});
test('a late polling response cannot replace a newer successful connection',()=>{
 const connected=status('connected',8);assert.equal(selectConnectionStatus(connected,status('reconnecting',7)),connected);
});
test('a restarted server can reset revisions without accepting old server replies afterwards',()=>{
 const retired=new Set(),before=status('error',20),after=status('connected',1,'server-b');
 assert.equal(selectConnectionStatus(before,after,retired),after);
 assert.equal(selectConnectionStatus(after,status('connecting',21),retired),after);
});
test('newer and initial states remain accepted',()=>{
 const latest=status('connected',4);assert.equal(selectConnectionStatus(status('connecting',3),latest),latest);assert.equal(selectConnectionStatus(null,latest),latest);
});

import {mergeLiveTurns} from '../public/connection-state.js';
test('lagging snapshots preserve live command metadata and streamed output',()=>{
 const live=[{id:'t',status:'inProgress',items:[{id:'i',type:'commandExecution',command:'echo live',cwd:'/daily',aggregatedOutput:'1\n2\n'}]}];
 const merged=mergeLiveTurns(live,[{id:'t',status:'inProgress',items:[{id:'i',aggregatedOutput:'1\n'}]}]);
 assert.equal(merged[0].items[0].aggregatedOutput,'1\n2\n');assert.equal(merged[0].items[0].command,'echo live');
 assert.equal(mergeLiveTurns(live,[])[0].items.length,1);
});
test('completion with unloaded items keeps output and cannot regress to running',()=>{
 const live=[{id:'t',status:'inProgress',items:[{id:'i',text:'hello'}]}];
 const done=mergeLiveTurns(live,[{id:'t',status:'completed',items:[]}]);
 assert.equal(done[0].items[0].text,'hello');assert.equal(mergeLiveTurns(done,live)[0].status,'completed');
});
test('new turns and final command results merge without duplicate items',()=>{
 const result=mergeLiveTurns([{id:'t',items:[{id:'i',aggregatedOutput:'1'}]}],[{id:'t',status:'completed',items:[{id:'i',aggregatedOutput:'12',exitCode:0}]},{id:'t2',items:[]}]);
 assert.equal(result.length,2);assert.equal(result[0].items.length,1);assert.equal(result[0].items[0].exitCode,0);assert.equal(result[0].items[0].aggregatedOutput,'12');
});
test('confirmed user message replaces accepted placeholder without duplication',()=>{
 const content=[{type:'text',text:'hello'}];
 const result=mergeLiveTurns([{id:'t',items:[{id:'accepted-t',type:'userMessage',content,localAccepted:true}]}],[{id:'t',items:[{id:'real-id',type:'userMessage',content}]}]);
 assert.equal(result[0].items.length,1);assert.equal(result[0].items[0].id,'real-id');
});
