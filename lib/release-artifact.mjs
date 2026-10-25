import {readFile,writeFile,readdir,lstat,readlink,mkdir,cp,rename,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const digest=data=>createHash('sha256').update(data).digest('hex');
export async function treeDigest(root,{exclude=[]}={}){
 const hash=createHash('sha256');
 async function visit(directory){
  for(const name of (await readdir(directory)).sort()){
   const file=path.join(directory,name),relative=path.relative(root,file).split(path.sep).join('/');
   if(exclude.includes(relative))continue;
   const info=await lstat(file);
   if(info.isDirectory()){await visit(file);continue;}
   let value;
   if(info.isSymbolicLink()){
    value=await readlink(file);const target=path.resolve(path.dirname(file),value);
    if(path.isAbsolute(value)||!target.startsWith(root+path.sep))throw Error('发布文件包含越界符号链接：'+relative);
    value='link:'+value;
   }else if(info.isFile())value=digest(await readFile(file));
   else throw Error('发布文件类型无效：'+relative);
   hash.update(JSON.stringify([relative,info.mode&0o777,value])+'\n');
  }
 }
 await visit(root);return hash.digest('hex');
}
export async function verifyRelease(directory,version){
 const manifest=JSON.parse(await readFile(path.join(directory,'release.json'),'utf8'));
 if(manifest.formatVersion!==1||manifest.version!==version||manifest.filesHash!==await treeDigest(directory,{exclude:['release.json']}))throw Error('发布产物版本或完整性检查失败。');
 return manifest;
}
export async function prepareRelease({root,commit,destination,run=spawnSync}){
 // Existing immutable releases can be reused for offline rollback.
 try{await lstat(destination);await verifyRelease(destination,commit);return path.join(destination,'runtime');}catch(error){if(error.code!=='ENOENT')throw error;}
 const build=JSON.parse(await readFile(path.join(root,'.framework-build/latest.json'),'utf8'));
 if(build.version!==commit||build.dirty)throw Error('缺少此提交的干净构建，请先运行 npm test。');
 const receipt=JSON.parse(await readFile(path.join(build.output,'verified.json'),'utf8'));
 if(receipt.version!==commit||receipt.filesHash!==await treeDigest(build.output,{exclude:['verified.json']}))throw Error('构建未经完整测试或验证后已变化，请重新运行 npm test。');
 await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
 const stage=await mkdtemp(path.join(path.dirname(destination),'.staging-'));
 for(const name of ['public','server','shared','runtime'])await cp(path.join(build.output,name),path.join(stage,name),{recursive:true});
 for(const name of ['package.json','package-lock.json'])await cp(path.join(root,name),path.join(stage,name));
 const npm=path.join(path.dirname(process.execPath),'npm');
 const result=run(npm,['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:stage,encoding:'utf8',timeout:180000,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'')}});
 if(result.error||result.status!==0)throw Error('运行依赖安装失败，未重启网页：'+(result.error?.message||result.stderr||result.stdout));
 await writeFile(path.join(stage,'runtime/VERSION'),commit+'\n',{mode:0o600});
 const manifest={formatVersion:1,version:commit,node:process.version,lockHash:digest(await readFile(path.join(stage,'package-lock.json'))),filesHash:await treeDigest(stage)};
 await writeFile(path.join(stage,'release.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 await verifyRelease(stage,commit);
 // Import in a fresh process: dependencies must resolve from the staged artifact.
 const check=run(process.execPath,['--input-type=module','-e',"await import('./server/application.mjs')"],{cwd:stage,encoding:'utf8',timeout:30000});
 if(check.error||check.status!==0)throw Error('独立发布产物加载失败，未重启网页：'+(check.error?.message||check.stderr));
 await rename(stage,destination);
 return path.join(destination,'runtime');
}
