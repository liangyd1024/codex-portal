import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ArchiveSync} from '../lib/archive-sync.mjs';

function fixture(file=null){
  const calls=[];let archived=false;
  const manager={controlled:new Map([['t',{}]]),subscriptions:new Map([['t',{}]]),saveSubscriptions(){},publish(){},
    passive:async()=>({thread:{archived}}),notifyDesktopArchive:async(id,value)=>{calls.push([id,value]);}};
  return {manager,calls,sync:new ArchiveSync(manager,file),setState:value=>{archived=value;}};
}
test('late commit remains pending across refreshes and web restart; only notification is retried',async()=>{
  const file=path.join(mkdtempSync(path.join(tmpdir(),'rcm-archive-sync-')),'pending.json');
  const f=fixture(file);f.sync.start('t',true,'account');
  await f.sync.flush('account');assert.equal(f.calls.length,0);
  f.sync.settle('t');await f.sync.flush('account');assert.equal(f.calls.length,0);
  const restarted=new ArchiveSync(f.manager,file);f.setState(true);await restarted.flush('account');
  assert.deepEqual(f.calls,[['t',true]]);assert.equal(f.manager.controlled.has('t'),false);
  assert.equal(f.manager.subscriptions.has('t'),false);assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),[]);
  await restarted.flush('account');assert.equal(f.calls.length,1);
});
test('failed IPC retries on refresh, never routes a pending notification to another account',async()=>{
  const f=fixture();let fail=true;f.setState(true);f.manager.notifyDesktopArchive=async()=>{if(fail)throw Error('socket unavailable');f.calls.push('sent');};
  f.sync.start('t',true,'a');f.sync.settle('t');await f.sync.flush('b');assert.equal(f.sync.pending.size,1);
  await f.sync.flush('a');assert.equal(f.sync.pending.size,1);
  fail=false;await f.sync.flush('a');assert.deepEqual(f.calls,['sent']);assert.equal(f.sync.pending.size,0);
});
test('overlapping refreshes deduplicate notifications; rejected writes are cancelled',async()=>{
  const f=fixture();f.setState(true);let finish;
  f.manager.notifyDesktopArchive=()=>new Promise(resolve=>{f.calls.push('sent');finish=resolve;});
  f.sync.start('t',true,'a');f.sync.settle('t');const first=f.sync.flush('a'),second=f.sync.flush('a');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1);finish();await Promise.all([first,second]);
  f.sync.start('t',false,'a');f.sync.cancel('t');await f.sync.flush('a');assert.equal(f.calls.length,1);
});
test('a newer opposite operation cannot be removed by an older notification completing late',async()=>{
  const f=fixture();f.setState(true);let finish;
  f.manager.notifyDesktopArchive=()=>new Promise(resolve=>{finish=resolve;});
  f.sync.start('t',true,'a');f.sync.settle('t');const old=f.sync.deliver('t','a');
  await new Promise(resolve=>setImmediate(resolve));f.sync.start('t',false,'a');finish();await old;
  assert.equal(f.sync.pending.get('t').archived,false);
  assert.equal(f.manager.controlled.has('t'),true);
  f.setState(false);f.sync.settle('t');f.manager.notifyDesktopArchive=async(id,value)=>f.calls.push([id,value]);
  await f.sync.flush('a');assert.deepEqual(f.calls,[['t',false]]);
});
