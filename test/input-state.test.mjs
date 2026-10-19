import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftStore, shouldSendOnEnter, coalesceRefresh} from '../public/input-state.js';

function storage(){const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};}
test('drafts survive reload without a navigation event and stay isolated by host and thread',()=>{
  const backend=storage(),a=new DraftStore({storage:backend,host:'a'}),b=new DraftStore({storage:backend,host:'b'});
  a.set('one','第一行\n第二行');a.set('two','另一个草稿');b.set('one','其他机器');
  assert.deepEqual([...new DraftStore({storage:backend,host:'a'})],[['one','第一行\n第二行'],['two','另一个草稿']]);
  assert.equal(new DraftStore({storage:backend,host:'b'}).get('one'),'其他机器');
});
test('late send success cannot erase a newer revision, even if the user retypes identical text',()=>{
  const drafts=new DraftStore({storage:storage(),host:'a'}),sent=drafts.capture('one','原草稿');
  drafts.set('one','新草稿');drafts.set('one','原草稿');
  assert.equal(drafts.acknowledge(sent),false);assert.equal(drafts.get('one'),'原草稿');
  const next=drafts.capture('one','下一条');drafts.set('two','保留');
  assert.equal(drafts.acknowledge(next),true);assert.equal(drafts.get('two'),'保留');
  assert.equal(new DraftStore({storage:drafts.storage,host:'a'}).has('one'),false);
});
test('storage failures preserve the in-memory draft and report once until recovery',()=>{
  let fail=true,warnings=0;const backend=storage(),set=backend.setItem;
  backend.setItem=(...args)=>{if(fail)throw Error('quota');set(...args);};
  const drafts=new DraftStore({storage:backend,host:'a',onError:()=>warnings++});
  drafts.set('one','一');drafts.set('one','二');assert.equal(warnings,1);assert.equal(drafts.get('one'),'二');
  fail=false;drafts.persist();assert.equal(new DraftStore({storage:backend,host:'a'}).get('one'),'二');
  fail=true;drafts.set('one','三');assert.equal(warnings,2);
});
test('mobile return, IME confirmation, legacy Safari composition and Shift Enter never send',()=>{
  const enter={key:'Enter'};
  assert.equal(shouldSendOnEnter(enter,{now:100}),true);
  for(const state of [{touch:true},{composing:true},{compositionEnded:99,now:100}])assert.equal(shouldSendOnEnter(enter,state),false);
  for(const event of [{key:'Enter',shiftKey:true},{key:'Enter',isComposing:true},{key:'Enter',keyCode:229},{key:'a'}])assert.equal(shouldSendOnEnter(event),false);
  assert.equal(shouldSendOnEnter(enter,{compositionEnded:1,now:100}),true);
});
test('foreground, online and stream recovery share one read and can retry a failed read',async()=>{
  let count=0,finish;const refresh=coalesceRefresh(()=>{count++;return new Promise(resolve=>{finish=resolve;});});
  const a=refresh(),b=refresh();assert.equal(a,b);await Promise.resolve();assert.equal(count,1);finish();await a;
  const c=refresh();await Promise.resolve();assert.equal(count,2);finish();await c;
  let attempts=0;const retry=coalesceRefresh(()=>{if(!attempts++)throw Error('offline');return 'ready';});
  await assert.rejects(retry(),/offline/);assert.equal(await retry(),'ready');
});
