import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {treeDigest,prepareRelease,verifyRelease} from '../lib/release-artifact.mjs';
const version='a'.repeat(40);
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'rcm-release-test-')),output=path.join(root,'.framework-build/build');
 for(const name of ['runtime','public','server','shared'])await mkdir(path.join(output,name),{recursive:true});
 await writeFile(path.join(output,'server/application.mjs'),'export const ready=true;');
 for(const name of ['package.json','package-lock.json'])await writeFile(path.join(root,name),'{}');
 const manifest={version,dirty:false,output};
 await writeFile(path.join(root,'.framework-build/latest.json'),JSON.stringify(manifest));
 await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest));
 await writeFile(path.join(output,'verified.json'),JSON.stringify({version,filesHash:await treeDigest(output)}));
 return {root,output,commit:version,destination:path.join(root,'releases',version),run(command,args,options){if(command==='git')return {status:0,stdout:'{}'};if(args[0]==='ci')return {status:0};return spawnSync(command,args,options);}};
}
test('verified artifact relocates and can be reused offline without its source',async()=>{
 const f=await fixture(),runtime=await prepareRelease(f);
 assert.equal(runtime,path.join(f.destination,'runtime'));
 assert.equal((await readFile(path.join(runtime,'VERSION'),'utf8')).trim(),version);
 await rename(path.join(f.root,'.framework-build'),path.join(f.root,'hidden-build'));
 assert.equal(await prepareRelease({...f,run(){throw Error('offline');}}),runtime);
 await writeFile(path.join(f.destination,'server/application.mjs'),'throw Error("changed")');
 await assert.rejects(verifyRelease(f.destination,version),/完整性/);
});
test('dirty, changed, wrong-version or unverified builds cannot be installed',async()=>{
 for(const change of ['dirty','version','tamper','receipt']){
  const f=await fixture();
  if(change==='dirty'||change==='version')await writeFile(path.join(f.root,'.framework-build/latest.json'),JSON.stringify({version:change==='version'?'b'.repeat(40):version,dirty:change==='dirty',output:f.output}));
  else if(change==='tamper')await writeFile(path.join(f.output,'runtime/extra'),'changed');
  else await writeFile(path.join(f.output,'verified.json'),'{}');
  await assert.rejects(prepareRelease(f));
 }
});
test('runtime dependency failure prevents publishing a release',async()=>{
 const f=await fixture();await assert.rejects(prepareRelease({...f,run:(command,...args)=>command==='git'?f.run(command,...args):({status:1,stderr:'offline'})}),/运行依赖安装失败/);
 await assert.rejects(readFile(path.join(f.destination,'release.json')),{code:'ENOENT'});
});
test('artifact hashes cover runtime adapters and reject links outside the release',async()=>{
 const f=await fixture(),before=await treeDigest(f.output);
 await writeFile(path.join(f.output,'runtime/adapter.py'),'print(1)');
 assert.notEqual(await treeDigest(f.output),before);
 await symlink('../../../../outside',path.join(f.output,'runtime/escape'));
 await assert.rejects(treeDigest(f.output),/越界符号链接/);
});

test('uncommitted dependency edits are excluded from a verified commit release',async()=>{
 const f=await fixture();
 for(const name of ['package.json','package-lock.json'])await writeFile(path.join(f.root,name),'invalid uncommitted content');
 const reads=[];
 await prepareRelease({...f,run(command,args,options){if(command==='git')reads.push(args);return f.run(command,args,options);}});
 assert.deepEqual(reads,['package.json','package-lock.json'].map(name=>['-C',f.root,'show',version+':'+name]));
 for(const name of ['package.json','package-lock.json']){
  assert.equal(await readFile(path.join(f.destination,name),'utf8'),'{}');
  assert.equal(await readFile(path.join(f.root,name),'utf8'),'invalid uncommitted content');
 }
});
test('missing committed dependency manifest prevents release preparation',async()=>{
 const f=await fixture();
 await assert.rejects(prepareRelease({...f,run:()=>({status:1,stderr:'missing'})}),/指定提交的依赖清单/);
 await assert.rejects(readFile(path.join(f.destination,'release.json')),{code:'ENOENT'});
});
