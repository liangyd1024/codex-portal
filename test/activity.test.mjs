import test from 'node:test';
import assert from 'node:assert/strict';
import {activitySource,creationSource,conversationActivity} from '../public/activity.js';
const now=100000;
const desktop={activity:{source:'desktop',state:'running',observedAt:now}};
test('only a fresh desktop observation shows desktop activity',()=>{
 assert.equal(activitySource(desktop,{now}),'desktop');
 assert.equal(activitySource({status:{type:'active'}},{now}),null);
 assert.equal(activitySource({...desktop,activity:{...desktop.activity,state:'idle'}},{now}),null);
 assert.equal(activitySource(desktop,{now:now+30000}),null);
 assert.equal(activitySource(desktop,{now:now-1}),null);
 assert.equal(activitySource(desktop,{now,connected:false}),null);
});
test('confirmed web execution is distinct and disconnection clears both sources',()=>{
 assert.equal(activitySource(desktop,{now,webActive:true}),'web');
 assert.equal(activitySource({}, {webActive:true}),'web');
 assert.equal(activitySource(desktop,{now,webActive:true,connected:false}),null);
});

test('service setup transports the expanded Unicode reader without a long Unicode source line',async()=>{
 const {Manager}=await import('../lib/manager.mjs');
 const {spawnSync}=await import('node:child_process');
 const {readFile}=await import('node:fs/promises');
 let script;
 await Manager.prototype.serviceAction.call({remote:async value=>{script=value;}},'status');
 const assignment=script.split('\n').find(line=>line.startsWith('OUTPUT_READER_SOURCE='));
 assert.ok(assignment);
 assert.match(assignment,/base64.b64decode/);
 const decoded=spawnSync('python3',['-'],{input:'import base64,sys\n'+assignment+'\nsys.stdout.write(OUTPUT_READER_SOURCE)\n',encoding:'utf8'});
 assert.equal(decoded.status,0,decoded.stderr);
 assert.equal(decoded.stdout,await readFile(new URL('../scripts/passive-store.py',import.meta.url),'utf8'));
});

test('creation identity survives idle, disconnection, and execution in another entrance',()=>{
 const web={originator:'remote_codex_manager',...desktop};
 assert.equal(creationSource(web),'web');
 assert.equal(activitySource(web,{now}),'desktop');
 assert.equal(creationSource({...web,status:{type:'idle'},activity:null}),'web');
 assert.equal(creationSource({originator:'Codex Desktop',status:{type:'active'}}),'desktop');
 assert.equal(creationSource({source:'vscode'}),'unknown');
 assert.equal(creationSource({originator:'another_client'}),'unknown');
});

test('completed turns with a live preview process are background work, not an active answer',()=>{
 const options={connected:true,controlled:true,active:true,background:{state:'running'}};
 assert.equal(conversationActivity({},options).kind,'turn');
 const ended=conversationActivity({}, {...options,active:false});
 assert.equal(ended.kind,'background');
 assert.equal(ended.label,'后台命令运行中');
 assert.doesNotMatch(ended.detail,/同步最新进展/);
 assert.equal(conversationActivity({}, {...options,active:false,background:{state:'idle'}}),null);
 assert.equal(conversationActivity({}, {...options,active:false,controlled:false}),null);
 assert.equal(conversationActivity({}, {...options,connected:false}),null);
 assert.equal(conversationActivity({}, {...options,active:false,background:{state:'unknown'}}).kind,'unknown');
});
