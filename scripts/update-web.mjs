import {updateTestFailure} from '../lib/update-failure.mjs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile} from 'node:fs/promises';
import {supportDir,loadConfig} from '../lib/config.mjs';
import {deploymentLock} from '../lib/deployment-lock.mjs';
import {readUpdate,writeUpdate} from '../lib/web-update.mjs';
import {updateWorkflow} from '../lib/update-workflow.mjs';
import {checkDeploymentEntrance} from '../lib/deployment-entrance.mjs';
const file=path.join(supportDir,'web-update.json'),job=await readUpdate(file);
// A relaunched/crashed worker never replays a partially completed update.
if(job?.id===process.argv[2]&&job.phase==='queued'){
 let lock;
 const stage=async(phase,message,extra={})=>{const now=Date.now();if(job.phase!==phase){job.phaseDurationsMs={...job.phaseDurationsMs,[job.phase]:(job.phaseDurationsMs?.[job.phase]||0)+now-(job.phaseStartedAt||job.startedAt)};job.phaseStartedAt=now;}Object.assign(job,{phase,message,updatedAt:now,pid:process.pid},extra);await writeUpdate(file,job);};
 try{
  lock=await deploymentLock(path.join(supportDir,'deployment.lock'));
  const installed=await readUpdate(path.join(supportDir,'installed.json'));
  if(installed.commit!==job.fromVersion)throw Error('正式版本已变化，请重新检查。');
  const env={...process.env,PATH:path.dirname(process.execPath)+':'+(process.env.PATH||'/usr/bin:/bin:/usr/sbin:/sbin'),RCM_DEPLOYMENT_TOKEN:lock.token};
  // Keep the update worker independent of the caller's preview environment.
  delete env.CODEX_THREAD_ID;delete env.RCM_PORT;delete env.RCM_STATE_DIR;
  const run=async(command,args,options={})=>{const started=Date.now(),step=command==='git'?'git.'+args[2]:args[0]?.endsWith('/run-tests.mjs')?'tests':'install';try{const r=await promisify(execFile)(command,args,{env,timeout:120000,maxBuffer:16*1024*1024,...options});await appendFile(path.join(supportDir,'logs/web-update.log'),r.stdout+r.stderr,{mode:0o600});return r.stdout;}catch(e){await appendFile(path.join(supportDir,'logs/web-update.log'),String(e.stdout||'')+String(e.stderr||'')+String(e.message)+'\n',{mode:0o600});throw Error(command==='git'?'Git 更新失败，请检查仓库访问、网络及 master 分支状态。':args[0]===installed.sourceRoot+'/scripts/run-tests.mjs'?updateTestFailure(e):e.message);}finally{const elapsed=Date.now()-started;job.commandDurationsMs={...job.commandDurationsMs,[step]:(job.commandDurationsMs?.[step]||0)+elapsed};await appendFile(path.join(supportDir,'logs/web-update.log'),`[update] ${step}: ${elapsed} ms\n`,{mode:0o600});}};
  const config=loadConfig(),local=config.connections.find(h=>h.kind==='local').id;
  const idle=()=>checkDeploymentEntrance({localConnectionId:local,onWaiting:message=>stage('checking','正在重新核对：'+message)});
  const target=await updateWorkflow({source:installed.sourceRoot,remote:installed.sourceRemote,baseline:installed.commit,run,stage,idle,installedVersion:async()=>(await readUpdate(path.join(supportDir,'installed.json'))).commit});
  await stage('succeeded',target===installed.commit?(job.documentationOnly?'仅文档更新，网页已是最新版本，无需重启。':'已是最新版本，无需重新部署。'):'更新完成，网页服务已恢复。',{targetVersion:target,unchanged:target===installed.commit,finishedAt:Date.now()});
 }catch(error){await stage('failed',error.message,{finishedAt:Date.now()});}
 finally{await lock?.release();}
}
