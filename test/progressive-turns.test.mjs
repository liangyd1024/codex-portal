import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressiveTurns} from '../public/render-cache.js';
function fixture(){
  const tasks=[],views=[];let turns=Array.from({length:10},(_,i)=>({id:String(i),items:[]}));
  const p=new ProgressiveTurns({schedule:fn=>{const task={fn};tasks.push(task);return ()=>{task.cancelled=true;};},render:()=>{views.push(p.view(turns));p.enqueue();}});
  p.reset('a');
  return {p,tasks,views,set:next=>{turns=next;},start:()=>p.render()};
}
test('newest turn paints first; later batches retain exact objects and chronological order',()=>{
  const f=fixture();f.start();assert.deepEqual(f.views[0].map(t=>t.id),['9']);assert.equal(f.tasks.length,1);
  f.p.enqueue();assert.equal(f.tasks.length,1);
  for(let i=0;i<f.tasks.length;i++)f.tasks[i].fn();
  assert.deepEqual(f.views.map(v=>v.length),[1,5,9,10]);
  assert.deepEqual(f.views.at(-1).map(t=>t.id),Array.from({length:10},(_,i)=>String(i)));
  assert.equal(f.views[0][0],f.views.at(-1).at(-1));assert.equal(f.p.pending,false);
});
test('switch cancels old work, including an already queued callback',()=>{
  const f=fixture();f.start();const old=f.tasks[0];f.p.reset('b');f.set([{id:'b0'},{id:'b1'}]);f.start();
  assert.equal(old.cancelled,true);old.fn();assert.equal(f.views.length,2);
  f.p.reset('c');assert.equal(f.tasks[1].cancelled,true);
});
test('streaming and prepended pages keep the visible boundary and render all original content',()=>{
  const f=fixture();f.start();f.set([{id:'older'},...Array.from({length:11},(_,i)=>({id:String(i)}))]);f.start();
  assert.deepEqual(f.views.at(-1).map(t=>t.id),['9','10']);
  for(let i=0;i<f.tasks.length;i++)f.tasks[i].fn();
  assert.equal(f.views.at(-1)[0].id,'older');assert.equal(f.views.at(-1).length,12);
});
test('explicit navigation reveals the requested turn and completion does not reschedule',()=>{
  const f=fixture();f.start();f.p.reveal('2');assert.equal(f.views.at(-1)[0].id,'2');
  f.p.reveal('missing');assert.equal(f.views.length,2);
  f.tasks[0].fn();assert.equal(f.p.pending,false);assert.equal(f.tasks.length,1);
});
