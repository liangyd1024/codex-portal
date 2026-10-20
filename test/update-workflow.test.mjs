import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {updateWorkflow} from '../lib/update-workflow.mjs';import {deploymentLock} from '../lib/deployment-lock.mjs';import {WebUpdate,writeUpdate} from '../lib/web-update.mjs';
const target='b'.repeat(40),baseline='a'.repeat(40);
function fixture(change={}){
 const calls=[],stages=[];let cleanReads=0;
 const run=async(command,args)=>{calls.push([command,args]);const operation=args[2];if(command==='git'){
  if(operation==='status')return change.dirty&&++cleanReads>=change.dirty?' M file':'';
  if(operation==='branch')return change.branch||'master';if(operation==='remote')return change.remote||'git@example:repo';
  if(operation==='rev-parse')return args[3]==='HEAD'&&change.head?change.head:target;
  if(operation==='merge-base'&&change.behind)throw Error('not ancestor');
  if(operation==='merge'&&change.diverged)throw Error('not ff');
 }
 if(command==='npm'&&change.testFails)throw Error('test failed');return '';
 };
 return {calls,stages,options:{source:'/source',remote:'git@example:repo',baseline,run,stage:async(...args)=>stages.push(args),idle:async()=>{if(change.busy)throw Error('busy');},installedVersion:async()=>change.installed||baseline}};
}
test('update fetches master, validates the production ancestor, tests and calls the version installer',async()=>{
 const f=fixture();assert.equal(await updateWorkflow(f.options),target);
 assert.deepEqual(f.stages.map(x=>x[0]),['checking','pulling','testing','installing']);
 assert.ok(f.calls.some(([c,a])=>c==='git'&&a.includes('--ff-only')));
 assert.deepEqual(f.calls.at(-1),[process.execPath,['/source/scripts/install-local.mjs','--ref',target]]);
});
test('dirty tree, wrong branch, changed remote, missing production baseline, divergence and failed tests never restart',async()=>{
 for(const change of [{dirty:1},{branch:'other'},{remote:'other'},{behind:true},{diverged:true},{testFails:true},{head:baseline},{installed:target},{busy:true},{dirty:3}]){
  const f=fixture(change);await assert.rejects(updateWorkflow(f.options));assert.ok(!f.calls.some(([c])=>c===process.execPath),JSON.stringify(change));
 }
});
test('deployment lock serializes manual and web installs; delegated installer cannot release its parent lock',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rcm-deploy-lock-')),file=path.join(dir,'lock');
 const a=await deploymentLock(file);await assert.rejects(deploymentLock(file),/已有更新/);
 const child=await deploymentLock(file,a.token);await child.release();await assert.rejects(deploymentLock(file),/已有更新/);
 await a.release();const b=await deploymentLock(file);await b.release();
});
test('web launch records queued state before starting a distinct launchd job; duplicate requests do not launch twice',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rcm-update-'));const root=path.join(dir,'release');
 await writeFile(path.join(dir,'installed.json'),JSON.stringify({app:root,commit:baseline,sourceRoot:'/source',sourceRemote:'git@example:repo'}));
 const calls=[],launch={stop:async()=>calls.push('stop'),start:async(file)=>{calls.push(await readFile(file,'utf8'));assert.equal(JSON.parse(await readFile(path.join(dir,'web-update.json'))).phase,'queued');}};
 const u=new WebUpdate({supportDir:dir,root,version:baseline,launch});
 if(process.platform!=='darwin'){assert.equal((await u.status()).available,false);return;}
 await u.start();await u.start();assert.equal(calls.length,2);assert.match(calls[1],/local.remote-codex-manager.update/);assert.ok(!calls[1].includes('KeepAlive'));
 await writeUpdate(u.file,{phase:'queued',startedAt:0});assert.equal((await u.status()).job.phase,'failed');
});
test('an abnormal deployment lock is not stolen or deleted',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rcm-deploy-stale-')),file=path.join(dir,'lock');
 await writeFile(file,JSON.stringify({pid:-1,token:'old'}));await assert.rejects(deploymentLock(file),/异常中断/);
 assert.equal(JSON.parse(await readFile(file)).token,'old');
});
test('a terminal worker still releasing its lock cannot be stopped by the next update',async()=>{
 if(process.platform!=='darwin')return;
 const dir=await mkdtemp(path.join(tmpdir(),'rcm-update-finishing-')),root=path.join(dir,'release');
 await writeFile(path.join(dir,'installed.json'),JSON.stringify({app:root,commit:baseline,sourceRoot:'/source',sourceRemote:'origin'}));
 const u=new WebUpdate({supportDir:dir,root,version:baseline,launch:{stop:async()=>assert.fail('must not stop finishing worker')}});
 await writeUpdate(u.file,{phase:'succeeded',pid:process.pid});await assert.rejects(u.start(),/收尾/);
});
