import {readFile,writeFile,mkdir,access,rename,chmod} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {loadConfig,supportDir,shellWord} from '../lib/config.mjs';
import {launchdService} from '../lib/launchd.mjs';
const command=process.argv[2],config=loadConfig(),host=config.connections.find(h=>h.kind==='local');
const file=path.join(host.dataDir,'desktop-shared.json'),label='local.remote-codex-manager.desktop-bridge';
const domain='gui/'+process.getuid(),job=path.join(host.home,'Library/LaunchAgents',label+'.plist');
const lifecycle=launchdService(domain,label);
const atomic=async(file,value)=>{const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';await writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);};
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function desktopExecutable(){
 let app=null;
 for(let dir=path.dirname(host.binary);dir!==path.dirname(dir);dir=path.dirname(dir))if(dir.endsWith('.app'))app=dir;
 if(!app)throw Error('原生二进制不在桌面应用内，无法确定桌面启动路径。');
 const value=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}));
 if(typeof value.CFBundleExecutable!=='string'||path.basename(value.CFBundleExecutable)!==value.CFBundleExecutable)throw Error('桌面程序入口无效。');
 const executable=path.join(app,'Contents/MacOS',value.CFBundleExecutable);await access(executable);return executable;
}
try {
 if(process.platform!=='darwin')throw Error('当前共享桌面安装仅支持 macOS 本机。');
 if(command==='prepare'){
  const installed=JSON.parse(await readFile(path.join(supportDir,'installed.json'),'utf8'));
  const runtime=path.join(installed.app,'runtime'),bridgeScript=path.join(runtime,'scripts/shared-engine-bridge.mjs'),launcherScript=path.join(runtime,'scripts/shared-desktop.mjs');
  await access(bridgeScript);await access(launcherScript);
  let settings;
  try{settings=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(settings){console.log('已保留现有共享连接配置。');if(!lifecycle.registered())await lifecycle.start(job);}
  else {
   settings={version:1,activated:false,socketPath:path.join(host.dataDir,'output-relay-v2.sock'),port:4330,token:randomBytes(32).toString('hex'),desktopExecutable:await desktopExecutable()};
   // Probe before enabling any listener. Never pick another port silently.
   const {startSharedEngineBridge}=await import('../lib/shared-engine-bridge.mjs');const probe=await startSharedEngineBridge(settings);await probe.close();
   await mkdir(host.dataDir,{recursive:true,mode:0o700});await atomic(file,settings);
   const logs=path.join(supportDir,'logs');await mkdir(logs,{recursive:true,mode:0o700});await mkdir(path.dirname(job),{recursive:true});
   const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath,bridgeScript,file].map(v=>'<string>'+xml(v)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>Umask</key><integer>63</integer><key>StandardErrorPath</key><string>${xml(path.join(logs,'desktop-bridge.stderr.log'))}</string></dict></plist>`;
   await writeFile(job,plist,{mode:0o600,flag:'wx'});await lifecycle.start(job);
  }
  const launcher=path.join(supportDir,'共享桌面.command');
  const env=['RCM_CONFIG','RCM_STATE_DIR'].filter(k=>process.env[k]).map(k=>k+'='+shellWord(process.env[k])).join(' ');
  await writeFile(launcher,'#!/bin/sh\nexec env '+env+' '+shellWord(process.execPath)+' '+shellWord(launcherScript)+' launch\n',{mode:0o700});await chmod(launcher,0o700);
  console.log('共享连接已准备。尚未切换或重启桌面。启动文件：'+launcher);
 } else if(command==='launch'){
  const settings=JSON.parse(await readFile(file,'utf8'));
  if(process.env.CODEX_APP_SERVER_FORCE_CLI==='1')throw Error('当前环境强制独立 CLI 模式，未启动共享桌面。');
  const processes=execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8'}).split('\n').map(s=>s.trim());
  if(processes.includes(settings.desktopExecutable))throw Error('请先确认桌面任务已结束，再正常退出桌面应用，然后重新打开此启动文件。不会自动退出桌面。');
  const status=await fetch('http://127.0.0.1:4317/api/status?host='+encodeURIComponent(host.id)).then(r=>{if(!r.ok)throw Error('网页状态不可用。');return r.json();});
  if(status.service?.sharedDesktop!==true||status.connection?.state!=='connected')throw Error('共享保护或原生连接尚未就绪，请先恢复 Portal。');
  const url='ws://127.0.0.1:'+settings.port+'/rpc/'+settings.token;
  const {RpcClient}=await import('../lib/rpc-client.mjs');const rpc=new RpcClient({timeoutMs:5000});try{await rpc.connect(url);await rpc.request('thread/loaded/list',{});}finally{rpc.close();}
  const child=spawn(settings.desktopExecutable,[],{env:{...process.env,CODEX_APP_SERVER_WS_URL:url},stdio:'ignore',detached:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  // The user invokes this launcher. It never kills an app or an engine.
  console.log('已按共享连接方式启动桌面。请打开网页创建的专用验收会话，再执行 verify <会话ID>。');
 } else if(command==='verify'){
  const id=process.argv[3];if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('请提供专用验收会话 ID。');
  const settings=JSON.parse(await readFile(file,'utf8'));
  const {RpcClient}=await import('../lib/rpc-client.mjs');const rpc=new RpcClient({timeoutMs:5000});
  try{
   await rpc.connect('ws://127.0.0.1:'+settings.port+'/rpc/'+settings.token);
   const loaded=new Set();let cursor;const seen=new Set();
   do{const page=await rpc.request('thread/loaded/list',cursor?{cursor}:{});for(const value of page.data)loaded.add(value);cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw Error('原生分页异常。');seen.add(cursor);}while(cursor);
   if(!loaded.has(id))throw Error('该会话未在共享引擎中加载。');
   const {localPython}=await import('../lib/local.mjs');const script=await readFile(new URL('./desktop-session.py',import.meta.url),'utf8');
   const probe=await localPython(host,'PAYLOAD='+JSON.stringify({action:'probe',threadId:id})+'\n'+script);
   if(probe.available!==true)throw Error('尚未确认桌面打开了同一会话。');
   await atomic(file,{...settings,activated:true});console.log('已确认桌面托管会话与共享引擎使用同一会话。刷新网页后隐藏交还按钮。');
  }finally{rpc.close();}
 } else if(command==='disable'){
  const settings=JSON.parse(await readFile(file,'utf8'));
  const processes=execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8'}).split('\n').map(s=>s.trim());
  if(processes.includes(settings.desktopExecutable))throw Error('请先确认桌面任务已结束并正常退出桌面，再关闭共享连接。');
  await lifecycle.stop();const suffix='.disabled-'+Date.now();await rename(file,file+suffix);await rename(job,job+suffix);
  console.log('已关闭 Portal 共享桥接。原生引擎和会话未停止；可以正常打开桌面应用。');
 } else if(command==='status'){
  const settings=JSON.parse(await readFile(file,'utf8'));console.log(JSON.stringify({prepared:true,activated:settings.activated===true,bridgeRegistered:lifecycle.registered(),port:settings.port}));
 } else throw Error('用法：node scripts/shared-desktop.mjs prepare|launch|verify <thread-id>|status|disable');
} catch(error){console.error(error.message);process.exitCode=1;}
