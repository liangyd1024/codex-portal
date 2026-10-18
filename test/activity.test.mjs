import test from 'node:test';
import assert from 'node:assert/strict';
import {activitySource} from '../public/activity.js';
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
