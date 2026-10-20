import test from 'node:test';
import assert from 'node:assert/strict';
import {userMessageTime, turnDurationLabel, timedTurnGroups} from '../public/message-time.js';

test('user times use individual native milliseconds, including steered messages', () => {
  const first = userMessageTime({createdAtMs:Date.parse('2026-10-20T09:00:00Z')});
  const next = userMessageTime({createdAtMs:Date.parse('2026-10-20T09:05:13Z')});
  assert.equal(first.iso,'2026-10-20T09:00:00.000Z');
  assert.match(first.label,/2026.*10.*20.*17:00:00/);
  assert.match(next.label,/17:05:13/);
  for (const value of [undefined,null,0,-1,'',NaN,Infinity,1e20])
    assert.equal(userMessageTime({createdAtMs:value}),null);
});

test('completed duration uses native milliseconds first, with seconds fallback', () => {
  const t={status:'completed',startedAt:100,completedAt:1400,durationMs:1237999};
  assert.equal(turnDurationLabel(t),'用时 20分 37秒');
  assert.equal(turnDurationLabel({...t,durationMs:undefined}),'用时 21分 40秒');
  assert.equal(turnDurationLabel({...t,durationMs:3601000}),'用时 1小时 1秒');
  assert.equal(turnDurationLabel({...t,durationMs:0}),'用时 0秒');
  assert.equal(turnDurationLabel({...t,status:{type:'interrupted'}}),'用时 20分 37秒');
  for (const status of ['inProgress','running','unknown'])
    assert.equal(turnDurationLabel({...t,status}),null);
  for (const durationMs of [-1,NaN,Infinity,'123'])
    assert.equal(turnDurationLabel({...t,durationMs}),null);
  assert.equal(turnDurationLabel({status:'completed'}),null);
  assert.equal(turnDurationLabel({status:'failed',startedAt:5,completedAt:4}),null);
});

test('duration appears once by the process before the answer without reordering messages', () => {
  const items=[{id:'u',type:'userMessage'},{id:'p',type:'commandExecution'},
    {id:'u2',type:'userMessage'},{id:'p2',type:'commandExecution'},
    {id:'a',type:'agentMessage',phase:'final_answer',text:'完成'},
    {id:'p3',type:'commandExecution'}];
  const groups=timedTurnGroups({status:'completed',durationMs:1237000,items});
  assert.deepEqual(groups.filter(g=>g.durationLabel).map(g=>g.key),['p2']);
  assert.deepEqual(groups.flatMap(g=>g.items||[g.item]),items);
  assert.equal(timedTurnGroups({status:'inProgress',durationMs:1237000,items}).some(g=>g.durationLabel),false);
});

test('answers without tools and failed turns still show known duration; unknown times stay absent', () => {
  const items=[{id:'u',type:'userMessage'},{id:'a',type:'agentMessage',text:'完成'}];
  const groups=timedTurnGroups({status:'completed',durationMs:9000,items});
  assert.deepEqual(groups.map(g=>g.type),['message','duration','message']);
  assert.equal(groups[1].label,'用时 9秒');
  assert.deepEqual(timedTurnGroups({status:'completed',items}).map(g=>g.type),['message','message']);
  assert.equal(timedTurnGroups({status:'failed',items:items.slice(0,1),durationMs:1000}).at(-1).label,'用时 1秒');
});
