import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile} from 'node:fs/promises';
import {supportDir,loadConfig} from '../lib/config.mjs';
import {deploymentLock} from '../lib/deployment-lock.mjs';
import {readUpdate,writeUpdate} from '../lib/web-update.mjs';
import {updateWorkflow} from '../lib/update-workflow.mjs';
import {assertDeploymentIdle} from '../lib/deployment-check.mjs';
const file=path.join(supportDir,'web-update.json'),job=await readUpdate(file);
// A relaunched/crashed worker never replays a partially completed update.
if(job?.id===process.argv[2]&&job.phase==='queued'){
 let lock;
 const stage=async(phase,message,extra={})=>{Object.assign(job,{phase,message,updatedAt:Date.now(),pid:process.pid},extra);await writeUpdate(file,job);};
 try{
  lock=await deploymentLock(path.join(supportDir,'deployment.lock'));
  const installed=await readUpdate(path.join(supportDir,'installed.json'));
  if(installed.commit!==job.fromVersion)throw Error('正式版本已变化，请重新检查。');
  const env={...process.env,PATH:path.dirname(process.execPath)+':'+(process.env.PATH||'/usr/bin:/bin:/usr/sbin:/sbin'),RCM_DEPLOYMENT_TOKEN:lock.token};
  // A web click cannot claim a Codex turn's deployment exemption.
  delete env.CODEX_THREAD_ID;delete env.RCM_PORT;delete env.RCM_STATE_DIR;
  const run=async(command,args,options={})=>{try{const r=await promisify(execFile)(command,args,{env,timeout:120000,maxBuffer:16*1024*1024,...options});await appendFile(path.join(supportDir,'logs/web-update.log'),r.stdout+r.stderr,{mode:0o600});return r.stdout.trim();}catch(e){await appendFile(path.join(supportDir,'logs/web-update.log'),String(e.stderr||e.message)+'\n',{mode:0o600});throw Error(command==='git'?'Git 更新失败，请检查仓库访问、网络及 master 分支状态。':command==='npm'?'更新前测试未通过，未重启服务。':e.message);}};
  const config=loadConfig(),local=config.connections.find(h=>h.kind==='local').id;
  const idle=async()=>{for(const {id} of config.connections){const r=await fetch('http://127.0.0.1:4317/api/status?host='+encodeURIComponent(id),{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('无法核对网页服务状态。');assertDeploymentIdle(await r.json(),{connectionId:id,localConnectionId:local});}};
  const target=await updateWorkflow({source:installed.sourceRoot,remote:installed.sourceRemote,baseline:installed.commit,run,stage,idle,installedVersion:async()=>(await readUpdate(path.join(supportDir,'installed.json'))).commit});
  await stage('succeeded','更新完成，网页服务已恢复。',{targetVersion:target,finishedAt:Date.now()});
 }catch(error){await stage('failed',error.message,{finishedAt:Date.now()});}
 finally{await lock?.release();}
}
