import {mkdir,writeFile,chmod,cp} from 'node:fs/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label='local.remote-codex-manager.web';
const support=path.join(homedir(),'Library/Application Support/RemoteCodexManager');
const app=path.join(support,'app');
const runtime=path.join(support,'logs');
const agents=path.join(homedir(),'Library/LaunchAgents');
const job=path.join(agents,`${label}.plist`);
const domain=`gui/${process.getuid()}`;
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
await mkdir(support,{recursive:true,mode:0o700});await chmod(support,0o700);
await mkdir(runtime,{recursive:true,mode:0o700});await chmod(runtime,0o700);await mkdir(agents,{recursive:true});await mkdir(app,{recursive:true,mode:0o700});
// A login service must not depend on macOS access to the protected Documents folder.
for(const name of ['server.mjs','package.json','lib','public','scripts'])await cp(path.join(root,name),path.join(app,name),{recursive:true,force:true});
const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(app,'server.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${escape(app)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Interactive</string><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${escape(path.join(runtime,'web.stdout.log'))}</string><key>StandardErrorPath</key><string>${escape(path.join(runtime,'web.stderr.log'))}</string>
</dict></plist>\n`;
await writeFile(job,plist,{mode:0o600});await chmod(job,0o600);
const existing=spawnSync('/bin/launchctl',['print',`${domain}/${label}`],{encoding:'utf8'});
const restart=existing.status===0 && (process.argv.includes('--restart')||!existing.stdout.includes(path.join(app,'server.mjs')));
if(restart){
 const stopped=spawnSync('/bin/launchctl',['bootout',`${domain}/${label}`],{encoding:'utf8'});
 if(stopped.status!==0)throw new Error(`停止旧本机服务失败：${stopped.stderr}`);
 const stopDeadline=Date.now()+10000;
 while(Date.now()<stopDeadline){if(spawnSync('/bin/launchctl',['print',`${domain}/${label}`],{encoding:'utf8'}).status!==0)break;await new Promise(resolve=>setTimeout(resolve,200));}
}
if(existing.status!==0||restart){
 const deadline=Date.now()+10000;let installed;
 do{
  const present=spawnSync('/bin/launchctl',['print',`${domain}/${label}`],{encoding:'utf8'});
  if(present.status===0){installed={status:0};break;}
  installed=spawnSync('/bin/launchctl',['bootstrap',domain,job],{encoding:'utf8'});
  if(installed.status===0)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }while(Date.now()<deadline);
 if(installed.status!==0)throw new Error(`启动本机服务失败：${installed.stderr}`);
}
const deadline=Date.now()+45000;let healthy=false;
while(Date.now()<deadline){
 try{const response=await fetch('http://127.0.0.1:4317/api/status',{signal:AbortSignal.timeout(1000)});if(response.ok){healthy=true;break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,200));
}
if(!healthy)throw new Error(`本机服务未就绪。请查看 ${runtime}。`);
console.log('本机工作台：http://127.0.0.1:4317');
console.log('服务在后台运行。关闭启动窗口不会停止服务。');
