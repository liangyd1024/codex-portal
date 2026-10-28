import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompletionNotices} from '../src/web/services/completion-notices.ts';
function fixture(){const data=new Map();const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};const notices=createCompletionNotices(storage,'host');notices.scope('account');return {storage,notices};}
const row=(status,id='turn')=>[{id:'chat',latestTurn:{id,status}}];
test('only a newly completed turn creates a persistent receipt; opening matching detail clears it',()=>{
 const {notices:n,storage}=fixture();n.update(row('completed','history'));assert.equal(n.has('chat'),false);
 n.update(row('inProgress'));n.update(row('completed'));assert.equal(n.has('chat'),true);
 const restored=createCompletionNotices(storage,'host');restored.scope('account');assert.equal(restored.has('chat'),true);
 restored.update(row('completed'),{id:'chat',turnId:'history'});assert.equal(restored.has('chat'),true);
 restored.update(row('completed'),{id:'chat',turnId:'turn'});assert.equal(restored.has('chat'),false);
 restored.update(row('completed'));assert.equal(restored.has('chat'),false);
});
test('failure, interruption, unknown status and a new running turn never show success',()=>{
 for(const status of ['failed','interrupted','inProgress','unknown']){const {notices:n}=fixture();n.update(row('inProgress'));n.update(row('completed'));n.update(row(status,'next'));assert.equal(n.has('chat'),false);}
});
test('missed completion is detected from next snapshot; missing data and other accounts cannot clear receipts',()=>{
 const {notices:n,storage}=fixture();n.update(row('inProgress'));n.update(row('completed','next'));assert.equal(n.has('chat'),true);
 n.update([{id:'chat'}]);assert.equal(n.has('chat'),true);
 n.scope('other');assert.equal(n.has('chat'),false);n.scope('account');assert.equal(n.has('chat'),true);
 const other=createCompletionNotices(storage,'other-host');other.scope('account');assert.equal(other.has('chat'),false);
});
test('invalid or unavailable browser storage does not break the sidebar',()=>{
 const n=createCompletionNotices({getItem:()=>'{bad',setItem:()=>{throw Error('blocked');}},'host');n.scope('account');n.update(row('inProgress'));n.update(row('completed'));assert.equal(n.has('chat'),true);
});
