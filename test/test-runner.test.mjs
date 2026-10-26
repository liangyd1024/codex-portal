import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';
import {runTests} from '../scripts/run-tests.mjs';import {updateTestFailure} from '../lib/update-failure.mjs';

test('shared suite uses the current Node executable without npm and propagates failures',async()=>{
 const calls=[];const run=(command,args,options)=>{calls.push({command,args,options});return {status:0};};
 assert.equal(await runTests({run,node:'/runtime/node'}),0);assert.equal(calls[0].command,'/runtime/node');assert.ok(calls[0].args[0].endsWith('/scripts/build-framework.mjs'));assert.equal(calls[1].args[0],'--test');assert.ok(calls[1].args.some(s=>s.endsWith('/mobile-session.test.mjs')));assert.equal(calls[2].command,'python3');assert.ok(!calls.some(c=>c.command==='npm'));assert.equal(calls[0].options.env.NODE_TEST_CONTEXT,undefined);
 assert.notEqual(calls[1].options.env.RCM_STATE_DIR,process.env.RCM_STATE_DIR);assert.match(calls[1].options.env.RCM_STATE_DIR,/portal-node-tests-/);assert.equal(calls[2].options.env.RCM_STATE_DIR,process.env.RCM_STATE_DIR);
 let count=0;assert.equal(await runTests({run:()=>{count++;return {status:7};}}),7);assert.equal(count,1);
 count=0;assert.equal(await runTests({run:()=>({status:++count===2?3:0})}),3);
 await assert.rejects(()=>runTests({run:()=>({error:Object.assign(Error('missing'),{code:'ENOENT'})})}),/无法启动测试命令/);
});
test('update failure distinguishes runner corruption, launch failure, timeout and failing tests',()=>{
 assert.match(updateTestFailure({stdout:'test at test/mobile-session.test.mjs:1:1\nUnable to deserialize cloned data\nnode:internal/test_runner/runner'}),/运行器内部通信异常/);
 assert.match(updateTestFailure({code:'ENOENT',message:'spawn npm ENOENT'}),/未能启动/);
 assert.match(updateTestFailure({killed:true}),/超时/);
 assert.match(updateTestFailure({stdout:'test at test/example.test.mjs:12:1\nAssertionError'}),/test\/example.test.mjs/);
 assert.ok(!updateTestFailure({stdout:'secret unrelated log'}).includes('secret'));
});

test('shared runner executes TypeScript-backed tests when type stripping defaults to disabled',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'rcm-runner-types-'));mkdirSync(path.join(root,'test'));
 writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
 writeFileSync(path.join(root,'test','value.ts'),'export const value:number=42;\n');
 writeFileSync(path.join(root,'test','value.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.ts';test('typed import',()=>assert.equal(value,42));\n");
 let actual;
 const status=await runTests({root,run(command,args,options){
  if(!args.includes('--test'))return {status:0};
  actual=spawnSync(command,['--no-experimental-strip-types',...args],{...options,stdio:'pipe',encoding:'utf8'});return actual;
 }});
 assert.equal(status,0,actual?.stdout+'\n'+actual?.stderr);assert.match(actual.stdout,/typed import/);
});
