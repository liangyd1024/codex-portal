import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,stat} from 'node:fs/promises';
import {homedir,tmpdir,userInfo} from 'node:os';
import path from 'node:path';
import {saveCredential,readCredential,deleteCredential} from '../lib/ssh-credentials.mjs';
import {prepareSshAuth} from '../lib/ssh-auth.mjs';
import {sshArgs} from '../lib/transports/ssh-options.mjs';
import {ConnectionConfigStore} from '../lib/connection-config.mjs';
const secret='fictional-password-for-tests';
test('session credentials are opaque, deletable and never require a vault',async()=>{
 const ref=await saveCredential(secret,false);assert.match(ref,/^session:/);assert.equal(await readCredential(ref),secret);await deleteCredential(ref);await assert.rejects(readCredential(ref),{code:'SSH_PASSWORD_REQUIRED'});
});
test('remembered credentials pass values through the vault API while configuration only receives an opaque reference',async()=>{
 const calls=[],items=new Map();const vault=async(op,ref,password)=>{calls.push(op);if(op==='save')items.set(ref,password);if(op==='delete')items.delete(ref);return{password:items.get(ref)};};
 const ref=await saveCredential(secret,true,{vault});assert.match(ref,/^keychain:/);assert.equal(await readCredential(ref,{vault}),secret);await deleteCredential(ref,{vault});assert.deepEqual(calls,['save','read','delete']);assert.equal(items.size,0);
});
test('askpass never places passwords in environment or arguments and answers only once',async()=>{
 const auth=await prepareSshAuth({password:secret});try{
  assert.ok(!JSON.stringify(auth.env).includes(secret));assert.equal((await stat(path.dirname(auth.env.RCM_ASKPASS_SOCKET))).mode&0o777,0o700);
  const run=promisify(execFile),helper=auth.env.SSH_ASKPASS;
  await assert.rejects(run('/usr/bin/python3',[helper,'Confirm host key?'],{env:auth.env}));
  const result=await run('/usr/bin/python3',[helper,"test@example.invalid's password:"],{env:auth.env});assert.equal(result.stdout.trim(),secret);assert.equal(result.stderr,'');
  await assert.rejects(run('/usr/bin/python3',[helper,'Password:'],{env:auth.env}));
 }finally{auth.close();}
});
test('password SSH keeps strict host verification, suppresses key auth and allows only one password prompt',()=>{
 const args=sshArgs({port:22,credentialRef:'session:00000000-0000-0000-0000-000000000000'});
 for(const value of ['StrictHostKeyChecking=yes','BatchMode=no','NumberOfPasswordPrompts=1','PubkeyAuthentication=no'])assert.ok(args.includes(value));assert.ok(!args.includes(secret));assert.deepEqual(args.slice(0,2),['-S','none']);
});
async function fixture(){const directory=await mkdtemp(path.join(tmpdir(),'cp-password-test-')),file=path.join(directory,'connections.json');await writeFile(file,JSON.stringify({formatVersion:1,machineId:'test',defaultConnection:'local',connections:[{id:'local',machineId:'test',kind:'local',alias:'Local',user:userInfo().username,home:homedir(),binary:process.execPath}]}));return {file,store:new ConnectionConfigStore(file)};}
const connection={kind:'ssh',alias:'Test',address:'test.invalid',user:'tester',port:22,home:'/Users/tester',binary:'/opt/codex',password:secret,rememberPassword:false};
test('password-backed connection survives through references, hides references in responses and deletes the secret on removal',async()=>{
 const {file,store}=await fixture();const result=await store.change({action:'add',revision:store.revision,connection});const host=result.connections[1];
 assert.equal(host.hasPassword,true);assert.equal(host.credentialStorage,'session');assert.equal(host.password,undefined);assert.equal(host.credentialRef,undefined);
 const raw=await readFile(file,'utf8');assert.ok(!raw.includes(secret));assert.ok(!raw.includes('"password"'));const ref=JSON.parse(raw).connections[1].credentialRef;assert.equal(await readCredential(ref),secret);
 await store.change({action:'edit',revision:store.revision,id:host.id,connection:{alias:'Renamed'}});assert.equal(await readCredential(ref),secret);
 await store.change({action:'remove',revision:store.revision,id:host.id});await assert.rejects(readCredential(ref),{code:'SSH_PASSWORD_REQUIRED'});
});
test('failed configuration update discards a newly saved password and preserves the existing file',async()=>{
 const {file,store}=await fixture(),before=await readFile(file,'utf8');let ref;store.credentials.save=async(...args)=>(ref=await saveCredential(...args));
 await assert.rejects(store.change({action:'add',revision:store.revision,connection},()=>{throw Error('busy');}),/busy/);assert.equal(await readFile(file,'utf8'),before);await assert.rejects(readCredential(ref),{code:'SSH_PASSWORD_REQUIRED'});
});

test('password rotation and switching back to a private key retire old credentials',async()=>{
 const {file,store}=await fixture();let response=await store.change({action:'add',revision:store.revision,connection});const id=response.connections[1].id;const first=JSON.parse(await readFile(file,'utf8')).connections[1].credentialRef;
 await store.change({action:'edit',revision:store.revision,id,connection:{password:'replacement-test-password',rememberPassword:false}});await assert.rejects(readCredential(first));
 const second=JSON.parse(await readFile(file,'utf8')).connections[1].credentialRef;
 response=await store.change({action:'edit',revision:store.revision,id,connection:{identityFile:'/test/key'}});await assert.rejects(readCredential(second));assert.equal(response.connections[1].hasPassword,undefined);
});
test('failed vault writes attempt cleanup and never silently fall back to a persistent plaintext password',async()=>{
 const calls=[];await assert.rejects(saveCredential(secret,true,{vault:async(op)=>{calls.push(op);if(op==='save')throw Error('locked');}}),/locked/);assert.deepEqual(calls,['save','delete']);
});
test('file cancellation while authentication is being prepared never starts the remote read',async()=>{
 const {runFileReader}=await import('../lib/file-transfer.mjs');const controller=new AbortController();const pending=runFileReader({kind:'ssh',password:secret,address:'unused.invalid',port:22,user:'tester'},'not executed',{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
