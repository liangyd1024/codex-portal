import {watch,watchFile,unwatchFile} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {recentRemoteVersion} from './update-workflow.mjs';
import {launchdService} from './launchd.mjs';
import {processAlive} from './deployment-lock.mjs';
export const updateActive=s=>['queued','checking','pulling','testing','installing'].includes(s?.phase);
export async function writeUpdate(file,state){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(state),{mode:0o600});await rename(tmp,file);}
export async function readUpdate(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export class WebUpdate {
 constructor({supportDir,root,version,run=promisify(execFile),now=Date.now,launch=launchdService(`gui/${process.getuid()}`,'local.remote-codex-manager.update')}){Object.assign(this,{supportDir,root,version,launch,run,now});this.listeners=new Set();this.file=path.join(supportDir,'web-update.json');this.installedFile=path.join(supportDir,'installed.json');}
 subscribe(listener){
  this.listeners.add(listener);
  if(this.listeners.size===1){
   const changed=()=>void this.publish();
   const fallback=()=>{for(const file of [this.file,this.installedFile])watchFile(file,{interval:1000,persistent:false},changed);this.stopWatching=()=>{for(const file of [this.file,this.installedFile])unwatchFile(file,changed);};};
   try{
    const watcher=watch(this.supportDir,{persistent:false},(_event,name)=>{if(!name||['web-update.json','installed.json'].includes(String(name)))changed();});
    this.stopWatching=()=>watcher.close();
    watcher.once('error',()=>{watcher.close();if(this.listeners.size)fallback();});
   }catch{fallback();}
  }
  return ()=>{this.listeners.delete(listener);if(!this.listeners.size)this.stopWatching?.();};
 }
 async publish(){
  if(this.publishing){this.publishAgain=true;return this.publishing;}
  this.publishing=(async()=>{
   do{this.publishAgain=false;try{const data=await this.status();for(const listener of this.listeners)listener(data);}catch{/* Readers retry after reconnect. */}}while(this.publishAgain);
  })().finally(()=>{this.publishing=null;});
  return this.publishing;
 }

 async checkLatest(){
  if(this.checking)return this.checking;
  if(this.latest&&this.now()-this.latest.checkedAt<60000)return;
  this.checking=(async()=>{
   const current=await this.status();if(!current.available||updateActive(current.job))return;
   const installed=await readUpdate(path.join(this.supportDir,'installed.json'));
   try{
    const {stdout:remote}=await this.run('git',['-C',installed.sourceRoot,'remote','get-url','origin'],{timeout:5000});
    if(remote.trim()!==installed.sourceRemote)throw Error('源码仓库地址已变化');
    const {stdout}=await this.run('git',['-C',installed.sourceRoot,'ls-remote','--exit-code','origin','refs/heads/master'],{timeout:15000,maxBuffer:65536,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
    const version=stdout.trim().split(/\s+/)[0];if(!/^[a-f0-9]{40}$/.test(version))throw Error('远端版本无效');
    this.latest={version,checkedAt:this.now()};
   }catch{this.latest={...this.latest,checkedAt:this.now(),error:'暂时无法检查新版本，请稍后重试。'};}
   await this.publish();
  })().finally(()=>{this.checking=null;});
  return this.checking;
 }
 async status(){
  const installed=await readUpdate(path.join(this.supportDir,'installed.json'));
  let job=await readUpdate(this.file);
  if(updateActive(job)&&((job.pid&&!processAlive(job.pid))||(!job.pid&&Date.now()-job.startedAt>30000))){job={...job,phase:'failed',message:'更新进程已中断，请核对当前版本后重试。',finishedAt:Date.now()};await writeUpdate(this.file,job);}
  const available=process.platform==='darwin'&&installed?.app===this.root&&installed?.commit===this.version&&path.isAbsolute(installed?.sourceRoot||'')&&!!installed?.sourceRemote;
  return {available,reason:available?'':'仅支持已按版本安装并记录源码位置的本机正式网页。',version:this.version,job,latest:this.latest||null};
 }
 async start(){
  if(this.starting)throw Error('更新请求正在提交，请稍候。');this.starting=true;
  try{
   const current=await this.status();if(!current.available)throw Error(current.reason);
   if(updateActive(current.job))return current;
   if(current.job?.pid&&processAlive(current.job.pid))throw Error('更新进程正在收尾，请稍后重试。');
   const job={id:randomUUID(),phase:'queued',message:'已接收，正在准备更新…',startedAt:Date.now(),fromVersion:this.version,...(recentRemoteVersion(this.latest,this.now())?{remoteCheck:{version:this.latest.version,checkedAt:this.latest.checkedAt}}:{})};
   const plist=path.join(this.supportDir,'web-update.plist'),log=path.join(this.supportDir,'logs/web-update.log');
   await mkdir(path.dirname(log),{recursive:true,mode:0o700});
   const body=`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>local.remote-codex-manager.update</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(this.root,'scripts/update-web.mjs'))}</string><string>${job.id}</string></array><key>RunAtLoad</key><true/><key>ProcessType</key><string>Standard</string><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>`;
   // A distinct launchd job survives stopping the web service; it has no KeepAlive/replay.
   await this.launch.stop();await writeFile(plist,body,{mode:0o600});await writeUpdate(this.file,job);
   try{await this.launch.start(plist);}catch(error){await writeUpdate(this.file,{...job,phase:'failed',message:'无法启动更新进程：'+error.message,finishedAt:Date.now()});throw error;}
   return {...current,job};
  }finally{this.starting=false;}
 }
}
