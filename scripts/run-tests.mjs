import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

// The CLI and updater share exactly one suite. launchd need not find npm or a shell profile.
export function runTests({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),run=spawnSync,node=process.execPath}={}){
 const files=readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join(root,'test',name));
 if(!files.length)throw Error('没有找到 Node 测试，未执行部署。');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const [command,args] of [[node,[path.join(root,'scripts/build-framework.mjs')]],[node,['--test',...files]],['python3',['-m','unittest','discover','-s','test','-p','test_*.py']]]){
  const result=run(command,args,{cwd:root,env,stdio:'inherit'});
  if(result.error)throw Error('无法启动测试命令 '+path.basename(command)+'：'+result.error.message);
  if(result.status!==0)return result.status||1;
 }
 return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=runTests();}catch(error){console.error(error.message);process.exitCode=1;}}
