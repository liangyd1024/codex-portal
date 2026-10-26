import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initializeConfig,discoverEnvironment} from '../lib/initialize.mjs';
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'rcm-init-'));return {file:path.join(root,'config.json'),binary:process.execPath,home:root,user:'example'};}
test('concurrent initialization preserves one machine identity and config permissions',async()=>{
 const options=await fixture(),results=await Promise.all([initializeConfig({...options,python:'/opt/example/python3'}),initializeConfig({...options,python:'/opt/example/python3'})]);
 assert.equal(results[0].config.connections[0].python,'/opt/example/python3');
 assert.equal(results.filter(item=>item.created).length,1);
 assert.equal(results[0].config.machineId,results[1].config.machineId);
 assert.equal((await stat(options.file)).mode&0o777,0o600);
 const before=await readFile(options.file,'utf8');
 await initializeConfig({...options,binary:'/nonexistent'});
 assert.equal(await readFile(options.file,'utf8'),before);
});
test('damaged existing configuration is preserved instead of silently replaced',async()=>{
 const options=await fixture();await writeFile(options.file,'broken');
 await assert.rejects(initializeConfig(options));assert.equal(await readFile(options.file,'utf8'),'broken');
});
test('environment discovery only runs bounded version commands, never starts an engine',async()=>{
 const calls=[];
 const result=await discoverEnvironment({binary:process.execPath,platform:'darwin',run:async(file,args,options)=>{calls.push({file,args,options});return {stdout:'version'};}});
 assert.ok(result.paths.codex);assert.ok(calls.length);
 for(const call of calls){assert.deepEqual(call.args,['--version']);assert.equal(call.options.timeout,5000);}
});
