import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function typecheck({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),run=spawnSync}={}){
 const manifest=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
 const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'));
 for(const [name,version] of Object.entries({...manifest.dependencies,...manifest.devDependencies})){
  let installed;try{installed=JSON.parse(readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8'));}catch{throw Error('检查工具缺失，请在独立工作目录按锁文件准备依赖（必须禁用安装脚本）。');}
  if(installed.version!==version||lock.packages['node_modules/'+name]?.version!==version)throw Error('依赖版本与锁文件不一致：'+name);
 }
 const result=run(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--project',path.join(root,'tsconfig.json'),'--noEmit'],{cwd:root,stdio:'inherit'});
 if(result.error)throw result.error;return result.status??1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=typecheck();}catch(error){console.error(error.message);process.exitCode=1;}}
