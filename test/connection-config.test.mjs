import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir,homedir,userInfo} from 'node:os';
import path from 'node:path';
import {ConnectionConfigStore,probeConnection} from '../lib/connection-config.mjs';
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'rcm-connections-')),file=path.join(root,'connections.json');await writeFile(file,JSON.stringify({formatVersion:1,machineId:'test-machine',defaultConnection:'local',connections:[{id:'local',machineId:'test-machine',kind:'local',alias:'Local',user:userInfo().username,home:homedir(),binary:process.execPath}]}));return {file,store:new ConnectionConfigStore(file)};}
const remote={kind:'ssh',alias:'Remote',address:'example.invalid',port:22,user:'example',home:'/home/example',binary:'/opt/example/codex',identityFile:'/tmp/example-key'};
test('connection mutations preserve identity, reject stale writes and never reuse removed IDs',async()=>{
 const {store,file}=await fixture(),initial=store.revision;
 let result=await store.change({revision:initial,action:'add',connection:remote});
 const target=result.connections.find(h=>h.kind==='ssh');assert.ok(target.id);assert.ok(target.hasIdentityFile);assert.equal(target.identityFile,undefined);
 await assert.rejects(store.change({revision:initial,action:'default',id:target.id}),{code:'CONFIG_CONFLICT'});
 const identity=target.machineId;
 result=await store.change({revision:store.revision,action:'edit',id:target.id,connection:{alias:'Renamed',identityFile:''}});
 assert.equal(result.connections.find(h=>h.id===target.id).machineId,identity);
 assert.equal(JSON.parse(await readFile(file,'utf8')).connections[1].identityFile,remote.identityFile);
 await assert.rejects(store.change({revision:store.revision,action:'edit',id:target.id,connection:{address:'other.invalid'}}),{code:'IDENTITY_CHANGE'});
 await store.change({revision:store.revision,action:'default',id:target.id});
 result=await store.change({revision:store.revision,action:'remove',id:target.id});assert.equal(result.defaultConnection,'local');
 result=await store.change({revision:store.revision,action:'add',connection:remote});assert.notEqual(result.connections[1].id,target.id);
 await assert.rejects(store.change({revision:store.revision,action:'remove',id:'local'}),{code:'INVALID_CONFIG'});
});
test('runtime rejection and other writers preserve original configuration',async()=>{
 const {store,file}=await fixture(),raw=await readFile(file,'utf8');
 await assert.rejects(store.change({revision:store.revision,action:'add',connection:remote},()=>{throw Error('busy');}),/busy/);
 assert.equal(await readFile(file,'utf8'),raw);
 await writeFile(file,raw+'\n');
 await assert.rejects(store.change({revision:store.revision,action:'add',connection:remote}),{code:'CONFIG_EXTERNAL_CHANGE'});
 assert.equal(await readFile(file,'utf8'),raw+'\n');
});
test('SSH probe is bounded and never invokes service startup or native execution',async()=>{
 const {store}=await fixture();let invoked=false;
 await probeConnection(store.config,{connection:remote},{remote:async(host,code,options)=>{invoked=true;assert.equal(host.address,remote.address);assert.equal(options.timeoutMs,8000);assert.match(code,/os.access/);assert.doesNotMatch(code,/subprocess|launchctl|serviceAction|Popen/);}});
 assert.ok(invoked);
});

test('discovered connections persist Python and support SSH-managed credentials',async()=>{
 const {store,file}=await fixture();const value={...remote,python:'/usr/bin/python3'};delete value.identityFile;
 const result=await store.change({revision:store.revision,action:'add',connection:value});
 assert.equal(result.connections[1].hasIdentityFile,false);assert.equal(JSON.parse(await readFile(file,'utf8')).connections[1].python,'/usr/bin/python3');
});
