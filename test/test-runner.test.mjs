import test from 'node:test';import assert from 'node:assert/strict';
import {runTests} from '../scripts/run-tests.mjs';import {updateTestFailure} from '../lib/update-failure.mjs';

test('shared suite uses the current Node executable without npm and propagates failures',()=>{
 const calls=[];const run=(command,args,options)=>{calls.push({command,args,options});return {status:0};};
 assert.equal(runTests({run,node:'/runtime/node'}),0);assert.equal(calls[0].command,'/runtime/node');assert.ok(calls[0].args[0].endsWith('/scripts/build-framework.mjs'));assert.equal(calls[1].args[0],'--test');assert.ok(calls[1].args.some(s=>s.endsWith('/mobile-session.test.mjs')));assert.equal(calls[2].command,'python3');assert.ok(!calls.some(c=>c.command==='npm'));assert.equal(calls[0].options.env.NODE_TEST_CONTEXT,undefined);
 let count=0;assert.equal(runTests({run:()=>{count++;return {status:7};}}),7);assert.equal(count,1);
 count=0;assert.equal(runTests({run:()=>({status:++count===2?3:0})}),3);
 assert.throws(()=>runTests({run:()=>({error:Object.assign(Error('missing'),{code:'ENOENT'})})}),/无法启动测试命令/);
});
test('update failure distinguishes runner corruption, launch failure, timeout and failing tests',()=>{
 assert.match(updateTestFailure({stdout:'test at test/mobile-session.test.mjs:1:1\nUnable to deserialize cloned data\nnode:internal/test_runner/runner'}),/运行器内部通信异常/);
 assert.match(updateTestFailure({code:'ENOENT',message:'spawn npm ENOENT'}),/未能启动/);
 assert.match(updateTestFailure({killed:true}),/超时/);
 assert.match(updateTestFailure({stdout:'test at test/example.test.mjs:12:1\nAssertionError'}),/test\/example.test.mjs/);
 assert.ok(!updateTestFailure({stdout:'secret unrelated log'}).includes('secret'));
});
