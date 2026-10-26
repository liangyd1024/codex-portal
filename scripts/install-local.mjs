import {mkdir,writeFile,readFile,chmod,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareRelease} from '../lib/release-artifact.mjs';
import {loadConfig,supportDir} from '../lib/config.mjs';
import {launchdService} from '../lib/launchd.mjs';
import {prepareWorkbenchCheck} from '../lib/workbench-check.mjs';
import {deploymentLock} from '../lib/deployment-lock.mjs';
import {checkDeploymentEntrance} from '../lib/deployment-entrance.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label='local.remote-codex-manager.web',domain=`gui/${process.getuid()}`,job=path.join(homedir(),'Library/LaunchAgents',label+'.plist');
const lifecycle=launchdService(domain,label);
const run=(file,args,options={})=>{const r=spawnSync(file,args,{encoding:'utf8',...options});if(r.status!==0)throw Error(`${path.basename(file)} 失败：${r.stderr||r.stdout}`);return r.stdout.trim();};
const flag=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
// Explicit, invocation-only exceptions authorized by the operator. Never saved.
const values=name=>new Set(process.argv.flatMap((arg,index)=>{if(arg!==name)return [];const value=process.argv[index+1];if(!value||value.startsWith('--'))throw Error(name+' 缺少标识');return [value];}));
const allowedPendingRequestKeys=values('--allow-pending-request');
const ref=flag('--ref')||'HEAD',config=loadConfig();
let workbenchCheck;
const lock=await deploymentLock(path.join(supportDir,'deployment.lock'),process.env.RCM_DEPLOYMENT_TOKEN);
try {
const commit=run('git',['-C',root,'rev-parse','--verify',ref+'^{commit}']);
if(!/^[a-f0-9]{40}$/.test(commit))throw Error('版本无效。');
const release=path.join(supportDir,'releases',commit);let app=release;const logs=path.join(supportDir,'logs');
await mkdir(logs,{recursive:true,mode:0o700});await mkdir(path.dirname(job),{recursive:true});
// Check this entrance only. Do not interrupt tasks running through another entrance.
const existing=spawnSync('/bin/launchctl',['print',domain+'/'+label],{encoding:'utf8'}).status===0;
const localConnectionId=config.connections.find(h=>h.kind==='local').id;
async function checkEntrance(){
 await checkDeploymentEntrance({localConnectionId,allowedPendingRequestKeys,onWaiting:message=>console.log('正在重新核对：'+message)});
}
if(existing)await checkEntrance();
const archivedPackage=JSON.parse(run('git',['-C',root,'show',commit+':package.json']));
if(archivedPackage.scripts?.build){
 app=await prepareRelease({root,commit,destination:release});
}else{
 // Legacy source-only versions remain usable for rollback.
 try{await stat(app);if((await readFile(path.join(app,'VERSION'),'utf8')).trim()!==commit)throw Error('已有版本目录不完整，请手动检查：'+app);}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(app,{recursive:true,mode:0o700});const archive=spawnSync('git',['-C',root,'archive',commit],{maxBuffer:64*1024*1024});if(archive.status!==0)throw Error('无法导出版本');run('/usr/bin/tar',['-xf','-','-C',app],{input:archive.stdout});await writeFile(path.join(app,'VERSION'),commit+'\n',{mode:0o600});}
}
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const environment={PYTHONDONTWRITEBYTECODE:'1',PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'/usr/bin:/bin:/usr/sbin:/sbin')};
for(const key of ['RCM_CONFIG','RCM_STATE_DIR','RCM_EGO_BROWSER','RCM_MOBILE'])if(process.env[key])environment[key]=process.env[key];
for(const key of ['RCM_CONFIG','RCM_STATE_DIR'])if(environment[key]&&!path.isAbsolute(environment[key]))throw Error(key+' 必须为绝对路径。');
const environmentXml=Object.entries(environment).map(([key,value])=>`<key>${escape(key)}</key><string>${escape(value)}</string>`).join('');
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(app,'server.mjs'))}</string></array><key>EnvironmentVariables</key><dict>${environmentXml}</dict><key>WorkingDirectory</key><string>${escape(app)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Interactive</string><key>Umask</key><integer>63</integer><key>StandardOutPath</key><string>${escape(path.join(logs,'web.stdout.log'))}</string><key>StandardErrorPath</key><string>${escape(path.join(logs,'web.stderr.log'))}</string></dict></plist>`;
let previous=null;try{previous=await readFile(job);}catch(e){if(e.code!=='ENOENT')throw e;}
const previousFile=path.join(supportDir,'install-history',Date.now()+'.plist');
await mkdir(path.dirname(previousFile),{recursive:true,mode:0o700});
if(previous)await writeFile(previousFile,previous,{mode:0o600});
// Prepare artifact checks (and explicitly configured browser) before stopping the website.
workbenchCheck=await prepareWorkbenchCheck({staticRoot:path.join(release,'public')});
if(existing){await checkEntrance();await lifecycle.stop();}
try{
 await writeFile(job,plist,{mode:0o600});await chmod(job,0o600);
 await lifecycle.start(job);
 let healthy=false;
 for(let i=0;i<90;i++){try{const r=await fetch('http://127.0.0.1:4317/api/version',{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).version===commit){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 if(!healthy)throw Error('新版本未通过健康检查。');
 console.log('正在验证正式工作台版本与资源…');
 await workbenchCheck.check({version:commit,host:localConnectionId});
 await writeFile(path.join(supportDir,'installed.json'),JSON.stringify({commit,sourceRoot:root,sourceRemote:run('git',['-C',root,'remote','get-url','origin']),machineId:config.machineId,app,installedAt:new Date().toISOString(),previousPlist:previous?previousFile:null}),{mode:0o600});
 console.log(`已部署 ${commit}，本机网页：http://127.0.0.1:4317`);
}catch(error){
 await lifecycle.stop();
 if(previous){await writeFile(job,previous,{mode:0o600});if(existing)await lifecycle.start(job);}else{await import('node:fs/promises').then(fs=>fs.rename(job,previousFile+'.failed'));}
 if(previous&&existing){let restored=false;for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:4317/api/connections',{signal:AbortSignal.timeout(1000)});if(r.ok){restored=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!restored)throw Error('原网页已重新注册但健康检查未通过，请检查日志。原始错误：'+error.message);}
 throw Error('部署失败，已恢复原网页配置：'+error.message);
}

} finally {
 try{await workbenchCheck?.close();}catch(error){console.error('部署检查浏览器清理失败：'+error.message);}
 await lock.release();
}
