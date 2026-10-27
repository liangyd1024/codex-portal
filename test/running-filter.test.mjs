import test from 'node:test';
import assert from 'node:assert/strict';
import {RunningFilter} from '../src/web/services/running-filter.ts';
import {Sidebar} from '../public/sidebar.js';
const snapshot=data=>({accountScope:'one',data,activityPhase:'ready'});
const options={connected:true,source:t=>t.status==='active'?'web':null,waiting:t=>!!t.question};
const ids=v=>v.rows.map(r=>r.thread.id);
test('running filter includes questions, excludes completed/background/archive and preserves order across recency updates',()=>{
 const f=new RunningFilter(),s=snapshot([{id:'a',status:'active'},{id:'b',status:'active'},{id:'q',question:true},{id:'done',status:'completed',background:true},{id:'archive',archived:true,status:'active'}]);
 assert.deepEqual(ids(f.read(s,options)),['q','a','b']);
 s.data.reverse();s.data.push({id:'new',status:'active'});
 assert.deepEqual(ids(f.read(s,options)),['q','a','b','new']);
 s.data.find(t=>t.id==='a').status='completed';
 assert.deepEqual(ids(f.read(s,options)),['q','b','new']);
});
test('initial loading and partial pagination cannot claim an exact zero',()=>{
 const f=new RunningFilter();
 assert.equal(f.read({...snapshot([]),activityPhase:'loading'},options).pending,true);
 assert.equal(f.read({...snapshot([]),nextCursor:'next'},options).uncertain,true);
 assert.deepEqual(f.read(snapshot([]),options),{rows:[],count:0,pending:false,uncertain:false});
});
test('disconnect, failed reads and stale desktop observations retain known rows with uncertainty, not false completion',()=>{
 for(const mode of ['disconnect','failed','stale','unknown']){
  const f=new RunningFilter(),s=snapshot([{id:'a',status:'active'}]);f.read(s,options);
  s.data[0].status='unknown';if(mode==='stale')s.data[0].activity={state:'running',observedAt:1};if(mode==='unknown')s.data[0].activity={state:'unknown'};
  const v=f.read(s,{...options,connected:mode!=='disconnect',failed:mode==='failed'},40000);
  assert.equal(v.uncertain,true);assert.deepEqual(ids(v),['a']);assert.equal(v.rows[0].uncertain,true);assert.equal(v.count,0);
  s.data[0]={id:'a',status:'idle'};assert.deepEqual(ids(f.read(s,options)),[]);
 }
});
test('search removes unmatched rows and account change drops cached identity and ordering',()=>{
 const f=new RunningFilter();f.read(snapshot([{id:'a',status:'active'}]),options);
 assert.deepEqual(ids(f.read(snapshot([]),options)),[]);
 f.read(snapshot([{id:'a',status:'active'}]),options);
 assert.deepEqual(ids(f.read({...snapshot([{id:'a'}]),accountScope:'two',activityPhase:'loading'},options)),[]);
});
test('desktop question comes only from a fresh live observation, not a persisted or disconnected snapshot',()=>{
 const c=Object.create(Sidebar.prototype);let connected=true;c.o={connected:()=>connected,needsAnswer:()=>false};
 const t={id:'a',activity:{source:'desktop',state:'running',needsAnswer:true,observedAt:Date.now()}};
 assert.equal(c.waiting(t),true);t.activity.observedAt=0;assert.equal(c.waiting(t),false);
 t.activity.observedAt=Date.now();connected=false;assert.equal(c.waiting(t),false);
});
test('toggle restores scroll and never changes native expansion, selected thread or search',()=>{
 const c=Object.create(Sidebar.prototype),parent={scrollTop:123};c.running=false;c.o={connected:()=>true};c.node={parentElement:parent};c.view={search:'中文'};c.snapshot={};c.expanded=new Set(['project:p']);c.closeMenu=()=>{};c.render=()=>{parent.scrollTop=0;};
 c.toggleRunning();assert.equal(c.running,true);assert.equal(parent.scrollTop,0);
 parent.scrollTop=60;c.toggleRunning();assert.equal(c.running,false);assert.equal(parent.scrollTop,123);assert.equal(c.view.search,'中文');assert.deepEqual([...c.expanded],['project:p']);
});
