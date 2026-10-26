import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverConnection} from '../lib/connection-discovery.mjs';
import {sshArgs} from '../lib/transports/ssh-options.mjs';
const detected={user:'tester',home:'/Users/tester',binary:'/Applications/Codex.app/Contents/Resources/codex',python:'/usr/bin/python3',alias:'Test Mac'};
function runner(result=detected){const calls=[];return {calls,run:async(file,args,options)=>{calls.push({file,args,options});return {stdout:args.includes('-G')?'user tester\nport 2200\nidentityfile /private/not-returned\n':'RCM_JSON:'+JSON.stringify(result)};}};}
test('address-only discovery resolves SSH defaults and reads environment without starting an engine',async()=>{
 const f=runner(),{connection}=await discoverConnection({address:'test-mac'},{run:f.run});
 assert.equal(connection.user,'tester');assert.equal(connection.port,2200);assert.equal(connection.home,detected.home);assert.equal(connection.alias,'Test Mac');assert.equal(connection.identityFile,undefined);
 assert.equal(f.calls.length,2);const ssh=f.calls[1];assert.ok(ssh.args.includes('StrictHostKeyChecking=yes'));assert.ok(ssh.args.includes('BatchMode=yes'));assert.ok(!ssh.args.includes('-i'));assert.ok(!ssh.args.includes('IdentityAgent=none'));assert.equal(ssh.options.timeoutMs,15000);
 assert.doesNotMatch(ssh.options.input,/launchctl|Popen|subprocess|--version|open\(/);assert.match(ssh.options.input,/os.access/);
});
test('explicit user, port and key remain authoritative and retain dedicated key isolation',async()=>{
 const f=runner();const result=await discoverConnection({address:'example.invalid',user:'tester',port:'2222',binary:'/opt/custom codex',identityFile:'/keys/test'},{run:f.run});
 assert.equal(result.connection.port,2222);assert.equal(result.connection.identityFile,'/keys/test');assert.ok(f.calls[0].args.includes('-l'));assert.ok(f.calls[1].args.includes('IdentityAgent=none'));assert.ok(f.calls[1].args.includes('IdentitiesOnly=yes'));assert.match(f.calls[1].options.input,/explicit="\/opt\/custom codex"/);
});
test('invalid form values never invoke SSH',async()=>{
 for(const input of [{address:'-oProxyCommand=bad'},{address:'a;whoami'},{address:'ok',user:'bad;name'},{address:'ok',port:65536},{address:'ok',identityFile:'relative/key'},{address:'ok',binary:'/tmp/bad\npath'}]){let calls=0;await assert.rejects(discoverConnection(input,{run:async()=>{calls++;}}));assert.equal(calls,0);}
});
test('unverified identity, missing Codex and malformed remote paths cannot become connection configuration',async()=>{
 for(const changed of [{user:'other'},{home:'relative'},{python:'relative'},{binary:null},{binary:'relative'}]){const f=runner({...detected,...changed});await assert.rejects(discoverConnection({address:'host'},{run:f.run}),{code:'CONNECTION_DISCOVERY'});}
});
test('authentication and host-key failures produce actionable errors without exposing remote output',async()=>{
 for(const [failure,message] of [['Permission denied (publickey)','SSH 登录失败'],['Host key verification failed','SSH 主机身份'],['REMOTE HOST IDENTIFICATION HAS CHANGED','SSH 主机身份'],['timeout secret-output','无法读取目标机器环境']]){
  const f=runner();await assert.rejects(discoverConnection({address:'host'},{run:async(...args)=>{if(args[1].includes('-G'))return f.run(...args);throw Error(failure);}}),e=>e.message.startsWith(message)&&!e.message.includes('secret-output'));
 }
});
test('implicit SSH credentials remain optional without relaxing host verification or reusing another control socket',()=>{
 const args=sshArgs({port:22});assert.deepEqual(args.slice(0,2),['-S','none']);assert.ok(args.includes('StrictHostKeyChecking=yes'));assert.ok(args.includes('ControlMaster=no'));assert.ok(args.includes('BatchMode=yes'));assert.ok(!args.includes(undefined));
});
