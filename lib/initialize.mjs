import {access,readFile,mkdir,writeFile,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir,userInfo} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {configPath,validateConfig} from './config.mjs';
const execute=promisify(execFile);
export async function findExecutable(names,{searchPath=process.env.PATH||''}={}){
 for(const name of names){
  const candidates=path.isAbsolute(name)?[name]:searchPath.split(path.delimiter).filter(Boolean).map(dir=>path.resolve(dir,name));
  for(const candidate of candidates){try{await access(candidate,constants.X_OK);return candidate;}catch{}}
 }
 return null;
}
export async function discoverEnvironment({binary,run=execute,platform=process.platform}={}){
 const [major,minor]=process.versions.node.split('.').map(Number);
 const codex=await findExecutable(binary?[binary]:['codex','/Applications/Codex.app/Contents/Resources/codex','/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex']);
 const python=await findExecutable(['python3','/opt/homebrew/bin/python3','/usr/local/bin/python3','/usr/bin/python3']);
 const npm=await findExecutable([path.join(path.dirname(process.execPath),'npm')]);
 const checks=[{name:'macOS',ok:platform==='darwin'},{name:'Node >=22.12',ok:major>22||major===22&&minor>=12}];
 for(const [name,file,args] of [['Codex',codex,['--version']],['Python 3',python,['--version']]]){
  try{if(!file)throw Error('未找到可执行文件');await run(file,args,{timeout:5000,maxBuffer:65536});checks.push({name,ok:true});}catch{checks.push({name,ok:false,message:'未找到或无法运行，请安装或指定有效路径。'});}
 }
 checks.push({name:'npm（同一 Node 安装）',ok:!!npm,message:npm?undefined:'此 Node 安装缺少 npm，请安装完整的 Node.js 发行版。'});
 return {ok:checks.every(item=>item.ok),checks,paths:{node:process.execPath,npm,python,codex}};
}
export async function initializeConfig({file=configPath,binary,python,home=homedir(),user=userInfo().username}={}){
 // Reading an existing config is deliberate: never repair by overwriting it.
 try{const config=validateConfig(JSON.parse(await readFile(file,'utf8')),{checkLocal:false});return {created:false,config};}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!path.isAbsolute(file)||!binary||!path.isAbsolute(binary))throw Error('初始化需要绝对配置路径和有效 Codex 二进制路径。');
 await access(binary,constants.X_OK);
 const machineId='machine-'+randomUUID();
 const config={formatVersion:1,machineId,defaultConnection:'local',connections:[{id:'local',machineId,alias:'本机',kind:'local',user,home,binary,...python?{python}:{}}]};
 validateConfig(config,{checkLocal:false});
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const temporary=file+'.'+randomUUID()+'.tmp';
 await writeFile(temporary,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
 try{
  // Atomic no-replace publish: concurrent initialization cannot change identity.
  try{await link(temporary,file);return {created:true,config};}catch(error){if(error.code!=='EEXIST')throw error;return {created:false,config:validateConfig(JSON.parse(await readFile(file,'utf8')),{checkLocal:false})};}
 }finally{await unlink(temporary);}
}
