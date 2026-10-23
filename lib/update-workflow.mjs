// Fixed commands only: browser input cannot select repositories, branches or scripts.
export async function updateWorkflow({source,remote,baseline,run,stage,idle,installedVersion}){
 const git=(...args)=>run('git',['-C',source,...args]);
 const clean=async()=>{if((await git('status','--porcelain')).trim())throw Error('源码目录有未提交修改，请先提交或保留修改后再更新。');if((await git('branch','--show-current')).trim()!=='master')throw Error('源码目录不在 master 分支，未执行更新。');};
 await stage('checking','正在检查源码…');await clean();
 if((await git('remote','get-url','origin')).trim()!==remote)throw Error('源码仓库地址已变化，请核对后重新安装。');
 await stage('pulling','正在拉取 origin/master…');await git('fetch','origin','master');await clean();
 const target=(await git('rev-parse','origin/master')).trim();if(!/^[a-f0-9]{40}$/.test(target))throw Error('远端版本无效。');
 try{await git('merge-base','--is-ancestor',baseline,target);}catch{throw Error('远端 master 未包含当前正式版本，已停止更新以保留已上线功能。');}
 await git('merge','--ff-only',target);await clean();
 if((await git('rev-parse','HEAD')).trim()!==target)throw Error('本地 master 含未推送提交或与远端分叉，未执行部署。');
 await stage('checking','正在比较版本…',{targetVersion:target});
 if(await installedVersion()!==baseline)throw Error('正式版本已变化，请重试更新。');
 if(target===baseline)return target;
 // Only an explicit documentation allowlist can avoid testing and restarting runtime code.
 // Disable rename detection so moving runtime files into docs cannot hide their removal.
 const changed=(await git('diff','--name-only','--no-renames','-z',baseline,target)).split('\0').filter(Boolean);
 if(changed.every(file=>/^(?:README\.md|AGENTS\.md|docs\/.+\.md)$/.test(file))){
  await stage('checking','仅文档更新，无需测试或重启网页。',{sourceVersion:target,targetVersion:baseline,documentationOnly:true});
  return baseline;
 }
 await idle();
 await stage('testing','正在运行更新前测试…',{targetVersion:target});await run(process.execPath,[source+'/scripts/run-tests.mjs'],{cwd:source,timeout:600000});
 await clean();if((await git('rev-parse','HEAD')).trim()!==target)throw Error('测试期间源码版本已变化，请重新更新。');
 if(await installedVersion()!==baseline)throw Error('正式版本已被其他部署更新，请重新检查后重试。');
 // The installer checks entrance state before export and immediately before restart.
 await stage('installing','正在重新部署并检查服务…');
 await run(process.execPath,[source+'/scripts/install-local.mjs','--ref',target],{cwd:source,timeout:300000});
 return target;
}
