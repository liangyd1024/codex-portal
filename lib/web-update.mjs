import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {launchdService} from './launchd.mjs';
import {processAlive} from './deployment-lock.mjs';
export const updateActive=s=>['queued','checking','pulling','testing','installing'].includes(s?.phase);
export async function writeUpdate(file,state){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(state),{mode:0o600});await rename(tmp,file);}
export async function readUpdate(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export class WebUpdate {
 constructor({supportDir,root,version,launch=launchdService(`gui/${process.getuid()}`,'local.remote-codex-manager.update')}){Object.assign(this,{supportDir,root,version,launch});this.file=path.join(supportDir,'web-update.json');}
 async status(){
  const installed=await readUpdate(path.join(this.supportDir,'installed.json'));
  let job=await readUpdate(this.file);
  if(updateActive(job)&&((job.pid&&!processAlive(job.pid))||(!job.pid&&Date.now()-job.startedAt>30000))){job={...job,phase:'failed',message:'更新进程已中断，请核对当前版本后重试。',finishedAt:Date.now()};await writeUpdate(this.file,job);}
  const available=process.platform==='darwin'&&installed?.app===this.root&&installed?.commit===this.version&&path.isAbsolute(installed?.sourceRoot||'')&&!!installed?.sourceRemote;
  return {available,reason:available?'':'仅支持已按版本安装并记录源码位置的本机正式网页。',version:this.version,job};
 }
 async start(){
  if(this.starting)throw Error('更新请求正在提交，请稍候。');this.starting=true;
  try{
   const current=await this.status();if(!current.available)throw Error(current.reason);
   if(updateActive(current.job))return current;
   if(current.job?.pid&&processAlive(current.job.pid))throw Error('更新进程正在收尾，请稍后重试。');
   const job={id:randomUUID(),phase:'queued',message:'已接收，正在准备更新…',startedAt:Date.now(),fromVersion:this.version};
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
