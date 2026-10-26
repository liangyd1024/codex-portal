import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkspaceView,saveWorkspaceView} from '../src/web/services/workspace-view.ts';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};};
test('home-screen app restores last conversation after its page session is destroyed',()=>{
 const session=memory(),persistent=memory(),view={selectedId:'last-viewed',projectId:'project',desktopMode:true};
 saveWorkspaceView(session,persistent,'local',true,view);
 assert.deepEqual(readWorkspaceView(memory(),persistent,'local',true),view);
 assert.deepEqual(readWorkspaceView(memory(),persistent,'other-host',true),{});
 assert.deepEqual(readWorkspaceView(memory(),persistent,'local',false),{});
});
test('existing browser session takes precedence and normal tabs do not replace app history',()=>{
 const persistent=memory(),session=memory();
 saveWorkspaceView(memory(),persistent,'local',true,{selectedId:'app'});
 saveWorkspaceView(session,persistent,'local',false,{selectedId:'tab'});
 assert.equal(readWorkspaceView(session,persistent,'local',true).selectedId,'tab');
 assert.equal(readWorkspaceView(memory(),persistent,'local',true).selectedId,'app');
});
test('storage failures are optional and do not prevent opening a conversation',()=>{
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 saveWorkspaceView(broken,broken,'local',true,{selectedId:'a'});
 assert.deepEqual(readWorkspaceView(broken,broken,'local',true),{});
});
