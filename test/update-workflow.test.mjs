import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {updateWorkflow} from '../lib/update-workflow.mjs';import {deploymentLock} from '../lib/deployment-lock.mjs';import {WebUpdate,writeUpdate} from '../lib/web-update.mjs';
const target='b'.repeat(40),baseline='a'.repeat(40);
function fixture(change={}){
 const calls=[],stages=[];let cleanReads=0;
 const run=async(command,args)=>{calls.push([command,args]);const operation=args[2];if(command==='git'){
  if(operation==='status')return change.dirty&&++cleanReads>=change.dirty?' M file':'';
  if(operation==='diff')return change.diff??'public/app.js\0';
  if(operation==='branch')return change.branch||'master';if(operation==='remote')return change.remote||'git@example:repo';
  if(operation==='rev-parse')return args[3]==='HEAD'&&change.head?change.head:change.target||target;
  if(operation==='merge-base'&&change.behind)throw Error('not ancestor');
  if(operation==='merge'&&change.diverged)throw Error('not ff');
 }
 if(args[0]==='/source/scripts/run-tests.mjs'&&change.testFails)throw Error('test failed');return '';
 };
 return {calls,stages,options:{source:'/source',remote:'git@example:repo',baseline,run,stage:async(...args)=>stages.push(args),idle:async()=>{if(change.busy)throw Error('busy');},installedVersion:async()=>change.installed||baseline}};
}
test('update fetches master, validates the production ancestor, tests and calls the version installer',async()=>{
 const f=fixture();assert.equal(await updateWorkflow(f.options),target);
 assert.deepEqual(f.stages.map(x=>x[0]),['checking','pulling','checking','testing','installing']);
 assert.ok(f.calls.some(([c,a])=>c==='git'&&a.includes('--ff-only')));
 assert.deepEqual(f.calls.at(-1),[process.execPath,['/source/scripts/install-local.mjs','--ref',target]]);
});
test('dirty tree, wrong branch, changed remote, missing production baseline, divergence and failed tests never restart',async()=>{
 for(const change of [{dirty:1},{branch:'other'},{remote:'other'},{behind:true},{diverged:true},{testFails:true},{head:baseline},{installed:target},{busy:true},{dirty:3}]){
  const f=fixture(change);await assert.rejects(updateWorkflow(f.options));assert.ok(!f.calls.some(([,a])=>a[0]==='/source/scripts/install-local.mjs'),JSON.stringify(change));
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
 await u.start();await u.start();assert.equal(calls.length,2);assert.match(calls[1],/local.remote-codex-manager.update/);assert.ok(!calls[1].includes('KeepAlive'));assert.match(calls[1],/<key>ProcessType<\/key><string>Standard<\/string>/);
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

test('matching production version fetches and compares but never tests, checks targets or redeploys',async()=>{
 const f=fixture({target:baseline,busy:true});assert.equal(await updateWorkflow(f.options),baseline);assert.ok(f.calls.some(([c,a])=>c==='git'&&a.includes('fetch')));assert.ok(!f.calls.some(([c])=>c==='npm'||c===process.execPath));assert.equal(f.stages.at(-1)[2].targetVersion,baseline);
});
test('automatic latest checks coalesce across entries, cache failures and never fetch or deploy',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rcm-latest-')),root=path.join(dir,'release');
 await writeFile(path.join(dir,'installed.json'),JSON.stringify({app:root,commit:baseline,sourceRoot:'/source',sourceRemote:'git@example:repo'}));
 let calls=0,time=100000,fail=false;const events=[];
 const u=new WebUpdate({supportDir:dir,root,version:baseline,now:()=>time,run:async(command,args)=>{
  calls++;assert.equal(command,'git');assert.ok(['remote','ls-remote'].includes(args[2]));
  if(args[2]==='remote')return {stdout:'git@example:repo\n'};
  if(fail)throw Error('offline');return {stdout:target+'\trefs/heads/master\n'};
 }});
 if(process.platform!=='darwin')return;
 const off=u.subscribe(data=>events.push(data));
 try{
  await Promise.all([u.checkLatest(),u.checkLatest(),u.checkLatest()]);assert.equal(calls,2);assert.equal(events.at(-1).latest.version,target);
  await u.checkLatest();assert.equal(calls,2);
  time+=60001;fail=true;await u.checkLatest();await u.checkLatest();assert.equal(calls,4);assert.match((await u.status()).latest.error,/无法检查/);
  time+=60001;await writeUpdate(u.file,{phase:'testing',pid:process.pid,startedAt:time});await u.checkLatest();assert.equal(calls,4);
 }finally{off();}
});
test('independent entries observe atomic background update writes through one shared watcher',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rcm-update-watch-'));
 const u=new WebUpdate({supportDir:dir,root:dir,version:baseline});
 let a,b;const first=new Promise(resolve=>{a=resolve;}),second=new Promise(resolve=>{b=resolve;});
 const off1=u.subscribe(data=>{if(data.job)a(data);}),off2=u.subscribe(data=>{if(data.job)b(data);});let deadline;
 try{
  await writeUpdate(u.file,{phase:'succeeded',targetVersion:target});
  const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('No update event')),4000);});
  const results=await Promise.race([Promise.all([first,second]),timeout]);
  assert.equal(results[0].job.targetVersion,target);assert.deepEqual(results[0],results[1]);
 }finally{clearTimeout(deadline);off1();off2();}
});

test('documentation-only revisions advance source without testing or restarting the unchanged website',async()=>{
 for(const diff of ['README.md\0AGENTS.md\0docs/验证记录.md\0','']){
  const f=fixture({diff,busy:true});assert.equal(await updateWorkflow(f.options),baseline);
  assert.ok(!f.calls.some(([c])=>c===process.execPath));
  assert.deepEqual(f.stages.at(-1)[2],{sourceVersion:target,targetVersion:baseline,documentationOnly:true});
  assert.ok(f.calls.some(([c,a])=>c==='git'&&a.includes('--no-renames')&&a.includes('-z')));
 }
});
test('runtime, test, unknown and renamed files still require the full test and install path',async()=>{
 for(const diff of ['public/app.js\0','test/server.test.mjs\0','scripts/install-local.mjs\0','package.json\0','public/prompt.md\0',' docs/guide.md\0','docs/tool.js\0','docs/moved.md\0lib/removed.mjs\0','README.md\0public/styles.css\0']){
  const f=fixture({diff});assert.equal(await updateWorkflow(f.options),target,diff);
  assert.ok(f.calls.some(([,a])=>a[0]==='/source/scripts/run-tests.mjs'),diff);
  assert.ok(f.calls.some(([,a])=>a[0]==='/source/scripts/install-local.mjs'),diff);
 }
});
test('documentation shortcut never hides dirty sources, branch divergence or a changed deployed version',async()=>{
 for(const change of [{dirty:1},{branch:'feature'},{behind:true},{head:baseline},{installed:target}]){
  const f=fixture({...change,diff:'docs/guide.md\0'});await assert.rejects(updateWorkflow(f.options));
 }
});

test('a fresh verified remote version already cached locally avoids a second network fetch',async()=>{
 const f=fixture();f.options.remoteCheck={version:target,checkedAt:1000};f.options.now=()=>2000;
 assert.equal(await updateWorkflow(f.options),target);
 assert.ok(!f.calls.some(([c,a])=>c==='git'&&a.includes('fetch')));
 assert.ok(f.calls.some(([,a])=>a[0]==='/source/scripts/run-tests.mjs'));
 assert.equal(f.stages.find(s=>s[0]==='pulling')[2].reusedRemoteCheck,true);
});
test('stale, failed, future, missing or locally different remote checks always fetch normally',async()=>{
 for(const remoteCheck of [undefined,{version:target,checkedAt:0},{version:target,checkedAt:62000},{version:target,checkedAt:60000,error:'offline'},{version:baseline,checkedAt:60000},{version:'bad',checkedAt:60000}]){
  const f=fixture();Object.assign(f.options,{remoteCheck,now:()=>61000});
  assert.equal(await updateWorkflow(f.options),target);assert.ok(f.calls.some(([c,a])=>c==='git'&&a.includes('fetch')));
 }
});
test('fresh remote reuse still rejects source changes and missing deployed ancestors',async()=>{
 for(const change of [{dirty:1},{branch:'feature'},{remote:'other'},{behind:true},{head:baseline},{installed:target}]){
  const f=fixture(change);Object.assign(f.options,{remoteCheck:{version:target,checkedAt:1000},now:()=>2000});
  await assert.rejects(updateWorkflow(f.options));assert.ok(!f.calls.some(([,a])=>a[0]==='/source/scripts/install-local.mjs'));
 }
});
