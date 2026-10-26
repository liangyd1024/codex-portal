import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
async function fixture({platform='Darwin',nodeMissing=false,existing=false}={}){
 const root=await mkdtemp(path.join(tmpdir(),'rcm-bootstrap-')),bin=path.join(root,'bin');await mkdir(bin);await mkdir(path.join(root,'scripts'));
 await copyFile(new URL('../scripts/bootstrap-macos.sh',import.meta.url),path.join(root,'scripts/bootstrap-macos.sh'));
 if(existing)await mkdir(path.join(root,'node_modules'));
 const script=async(name,body)=>writeFile(path.join(bin,name),'#!/bin/sh\n'+body+'\n',{mode:0o700});
 await script('uname','echo '+platform);
 await script('node',`if [ "$1" = -e ]; then exit ${nodeMissing?1:0}; fi\nprintf 'node %s\\n' "$*" >> "$RCM_TEST_LOG"`);
 await script('npm',`printf 'npm %s\\n' "$*" >> "$RCM_TEST_LOG"`);
 for(const name of ['python3','age','age-keygen'])await script(name,'exit 0');
 await script('brew',`printf 'brew %s\\n' "$*" >> "$RCM_TEST_LOG"\nexit 9`);
 const log=path.join(root,'commands.log');await writeFile(log,'');
 const result=spawnSync('/bin/sh',[path.join(root,'scripts/bootstrap-macos.sh')],{encoding:'utf8',env:{PATH:bin+':/usr/bin:/bin',RCM_TEST_LOG:log}});
 return {result,commands:await readFile(log,'utf8')};
}
test('bootstrap is explicit, preserves existing dependencies and deploys only after validation',async()=>{
 for(const existing of [false,true]){
  const {result,commands}=await fixture({existing});assert.equal(result.status,0,result.stderr);
  assert.match(commands,/node scripts\/configure.mjs doctor/);assert.match(commands,/node scripts\/configure.mjs init/);
  assert.ok(commands.indexOf('npm test')<commands.indexOf('npm run deploy -- --ref HEAD'));
  if(existing){assert.match(commands,/npm run typecheck/);assert.doesNotMatch(commands,/npm ci/);}else assert.match(commands,/npm ci --ignore-scripts/);
  assert.doesNotMatch(commands,/brew/);
 }
});
test('unsupported platform and failed dependency installation never reach deployment',async()=>{
 const unsupported=await fixture({platform:'Linux'});assert.notEqual(unsupported.result.status,0);assert.equal(unsupported.commands,'');
 const failed=await fixture({nodeMissing:true});assert.notEqual(failed.result.status,0);assert.match(failed.commands,/brew install node@24/);assert.doesNotMatch(failed.commands,/deploy|configure/);
});
