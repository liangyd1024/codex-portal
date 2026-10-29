import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';import assert from 'node:assert/strict';
import {cliTarget,readCliActivity,observeCliCommand} from '../lib/cli-activity.mjs';
import {activitySource,conversationActivity} from '../public/activity.js';
const id='00000000-0000-0000-0000-000000000001',binary='/fixture/codex';
const command=`'${binary}' exec --cd '/fixture/project with spaces' -c 'approval_policy="never"' resume '${id}' --json -`;
test('only direct CLI resume invocations identify a target',()=>{
 assert.equal(cliTarget(command,binary),id);
 assert.equal(cliTarget(`/bin/zsh -lc '${binary} exec resume ${id} --json'`,binary),id);
 for(const c of [`echo ${command}`,`${binary} exec 'resume ${id}'`,`${command}; echo done`,`${binary} exec resume --last`,`${binary} exec --unknown resume ${id}`,`${binary} exec $(echo resume) ${id}`])assert.equal(cliTarget(c,binary),null,c);
});
function fixture({status='inProgress',startedAt=101,terminals=true}={}){
 const calls=[];const m={host:{binary},generation:1,accountRevision:0,controlled:new Map([['source',{}]]),requireConnected(){},passive:async()=>({data:[{threadId:id,id:'turn',status,startedAt}]}),rpc:{connected:true,async request(method){calls.push(method);if(method==='thread/backgroundTerminals/list')return {data:terminals?[{itemId:'item',processId:'process',command}]:[]};if(method==='thread/items/list')return {data:[{startedAtMs:100500,item:{id:'item',type:'commandExecution',status:'inProgress'}}]};if(method==='thread/turns/list')return {data:[{id:'turn',status,startedAt}]};throw Error(method);}}};return {m,calls};
}
test('live command and its new active target turn yield presentation-only CLI activity',async()=>{const {m,calls}=fixture();const result=await readCliActivity(m,[id]);assert.equal(result.get(id).source,'cli');assert.deepEqual([...m.controlled.keys()],['source']);assert.deepEqual(calls,['thread/backgroundTerminals/list','thread/items/list']);assert.equal(activitySource({activity:result.get(id)}),'cli');assert.equal(conversationActivity({activity:result.get(id)},{connected:true}).label,'CLI 正在运行');});
test('completion, stale prior turn and missing live process never show running',async()=>{for(const options of [{status:'completed'},{status:'failed'},{startedAt:99},{terminals:false}])assert.equal((await readCliActivity(fixture(options).m,[id])).size,0);});
test('late evidence from another connection is discarded',async()=>{const {m}=fixture();const read=m.passive;m.passive=async()=>{const r=await read();m.generation++;return r;};assert.equal((await readCliActivity(m,[id])).size,0);});
test('unsupported live reads and disconnected observations fail closed',async()=>{const {m}=fixture();m.rpc.request=async()=>{throw Error('unavailable')};assert.equal((await readCliActivity(m,[id])).size,0);assert.equal(activitySource({activity:{source:'cli',state:'running',observedAt:Date.now()}},{connected:false}),null);});

test('live notifications work before source history is persisted and completion removes evidence',async()=>{
 const {m}=fixture();const request=m.rpc.request;
 m.rpc.request=async(method,...args)=>method==='thread/items/list'?{data:[]}:request(method,...args);
 m.passive=async()=>({data:[{threadId:id,status:'inProgress',startedAt:Math.floor(Date.now()/1000)}]});
 const params={threadId:'source',item:{id:'item',type:'commandExecution',command}};
 assert.equal((await readCliActivity(m,[id])).size,0);
 observeCliCommand(m,'item/started',params);
 assert.equal((await readCliActivity(m,[id])).size,1);
 observeCliCommand(m,'item/completed',params);
 assert.equal((await readCliActivity(m,[id])).size,0);
 observeCliCommand(m,'item/started',params);
 observeCliCommand(m,'account/updated',{});
 assert.equal((await readCliActivity(m,[id])).size,0);
});
test('simultaneous readers share source discovery but later reads recheck liveness',async()=>{
 const {m,calls}=fixture();await Promise.all([readCliActivity(m,[id]),readCliActivity(m,[id])]);
 assert.equal(calls.filter(c=>c==='thread/backgroundTerminals/list').length,1);
 await readCliActivity(m,[id]);assert.equal(calls.filter(c=>c==='thread/backgroundTerminals/list').length,2);
});

test('restart loads observation metadata but still requires a matching live process',async()=>{
 const {m}=fixture();m.titleStore=path.join(mkdtempSync(path.join(tmpdir(),'rcm-cli-observation-')),'titles.json');
 m.saveState=(file,data)=>writeFileSync(file,JSON.stringify(data));
 observeCliCommand(m,'item/started',{threadId:'source',item:{id:'item',type:'commandExecution',command}});
 const restored=fixture().m;restored.titleStore=m.titleStore;
 const request=restored.rpc.request;restored.rpc.request=async(method,...args)=>method==='thread/items/list'?{data:[]}:request(method,...args);
 restored.passive=async()=>({data:[{threadId:id,status:'inProgress',startedAt:Math.floor(Date.now()/1000)}]});
 assert.equal((await readCliActivity(restored,[id])).size,1);
 restored.rpc.request=async()=>({data:[]});assert.equal((await readCliActivity(restored,[id])).size,0);
});
