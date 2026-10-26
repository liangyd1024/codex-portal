import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveUpdateSource} from '../lib/update-source.mjs';
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8'}).trim();
test('detached build checkouts resolve the persistent master worktree, including spaces',async()=>{
 const parent=await realpath(await mkdtemp(path.join(tmpdir(),'portal-update-source-'))),root=path.join(parent,'main source'),detached=path.join(parent,'build checkout');
 run('git',['init','-b','master',root]);run('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','initial']);
 run('git',['-C',root,'remote','add','origin','https://example.invalid/portal.git']);run('git',['-C',root,'worktree','add','--detach',detached,'HEAD']);
 const expected={sourceRoot:root,sourceRemote:'https://example.invalid/portal.git'};
 assert.deepEqual(resolveUpdateSource({root:detached,run}),expected);assert.deepEqual(resolveUpdateSource({root,run}),expected);
 run('git',['-C',root,'switch','-c','feature']);assert.throws(()=>resolveUpdateSource({root:detached,run}),/未找到.*master/);
});
