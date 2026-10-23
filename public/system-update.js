// Keep the version observer independent of the lazily opened settings panel.
export function createVersionSync({flush,reload,onError,schedule=setTimeout}){
 let version=null,reloading=false,composing=false,pending=null;
 const receive=data=>{
  if(!version)version=data.version;
  if(!data.version)return;
  if(data.version===version||data.version==='development'){pending=null;return;}
  pending=data;
  if(composing||reloading)return;
  try{flush();reloading=true;reload();}catch(error){reloading=false;onError(error);}
 };
 return {receive,compositionStart(){composing=true;},compositionEnd(){composing=false;if(pending)schedule(()=>{if(pending)receive(pending);},0);}};
}
export function updateVersionInfo(data){
 const job=data.job,latest=data.latest?.checkedAt>=(job?.updatedAt||0)?data.latest.version:job?.sourceVersion||job?.targetVersion||data.latest?.version;
 const documentationOnly=job?.phase==='succeeded'&&job.documentationOnly===true&&job.targetVersion===data.version&&job.sourceVersion===latest;
 return {latest,documentationOnly,current:latest===data.version||documentationOnly};
}
export function installSystemUpdate({api,flush,resetCsrf}){
 const area=document.getElementById('system-update-body');
 const description=document.createElement('p');description.className='subtle';description.textContent='更新当前网页服务，连接会短暂断开并自动恢复。';
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent='更新并重新部署';button.disabled=true;
 const progress=document.createElement('progress');progress.className='system-update-progress';progress.setAttribute('aria-label','更新进行中');progress.hidden=true;
 const steps=document.createElement('p');steps.className='system-update-steps';steps.hidden=true;
 const versions=document.createElement('p');versions.className='subtle system-update-versions';
 const actions=document.createElement('div');actions.className='settings-actions';actions.append(button);
 status.textContent='正在读取更新状态…';
 const active=job=>['queued','checking','pulling','testing','installing'].includes(job?.phase);
 let submitting=false,reading=false,last=null,timer=null,uncertain=false,generation=0;
 function render(data){
  clearTimeout(timer);last=data;const running=active(data.job);button.disabled=submitting||uncertain||running||!data.available;
  button.textContent=submitting?'正在提交…':running?'正在更新…':'更新并重新部署';
  status.textContent=data.job?.phase==='failed'?'上次更新未完成：'+data.job.message:data.job?.message||data.reason||'更新入口已就绪。';

  const short=value=>value?value.slice(0,8):'尚未检查';
  const {latest,documentationOnly,current}=updateVersionInfo(data);
  versions.textContent='当前版本 '+short(data.version)+'\n'+(current?(documentationOnly?'网页已是最新版本（仅文档更新）':'已是最新版本'):latest?'可更新版本 '+short(latest):data.latest?.error?'尚未检查到新版本':'正在检查新版本…');
  if(data.latest?.error)versions.textContent+='\n'+data.latest.error;
  if(!data.available&&!latest)versions.textContent='当前版本 '+short(data.version);
  versions.title='当前：'+(data.version||'未知')+'\n远端：'+(latest||'尚未检查');
  progress.hidden=!running;
  const phases=['checking','pulling','testing','installing','succeeded'],labels=['检查','拉取','验证','部署','完成'];
  const index=phases.indexOf(data.job?.phase);steps.hidden=!data.job||data.job.phase==='failed'||data.job.unchanged===true;
  steps.textContent=data.job?.phase==='failed'?'更新未完成，请查看上方原因。':labels.map((label,i)=>`${i<index?'✓ ':i===index?'● ':''}${label}`).join(' › ');
  progress.setAttribute('aria-valuetext',data.job?.message||'正在准备更新');
  if(running){clearTimeout(timer);timer=setTimeout(check,2000);}
 }
 async function check(latest=false){
  if(reading)return;reading=true;const version=generation;
  try{const data=await api('/api/system/update'+(latest?'?check=1':''),{timeout:8000});if(version!==generation)return;uncertain=false;render(data);}
  catch(error){if(version!==generation)return;status.textContent=active(last?.job)||submitting||uncertain?'正在等待网页服务恢复，稍后自动核对更新结果…':'暂时无法读取更新状态，正在自动重试…';clearTimeout(timer);timer=setTimeout(check,3000);}
  finally{reading=false;}
 }
 button.onclick=async()=>{
  if(button.disabled||submitting)return;submitting=true;uncertain=true;generation++;flush();button.disabled=true;button.textContent='正在提交…';status.textContent='正在提交更新请求…';progress.hidden=false;steps.hidden=false;steps.textContent='正在准备更新…';
  try{resetCsrf();const data=await api('/api/system/update',{method:'POST',body:{},timeout:15000});uncertain=false;render(data);}
  catch(error){status.textContent=error.status?'更新未开始：'+error.message:'提交结果暂未确认，正在检查更新状态…';if(error.status){uncertain=false;progress.hidden=true;steps.textContent='更新未开始';}}
  finally{submitting=false;if(last&&!uncertain)button.disabled=active(last.job)||!last.available;button.textContent=active(last?.job)?'正在更新…':'更新并重新部署';clearTimeout(timer);timer=setTimeout(check,1500);}
 };
 area.append(description,versions,status,progress,steps,actions);
 window.addEventListener('rcm:system-update',event=>{if(!submitting&&!uncertain){generation++;render(event.detail);}});
 const panel=document.getElementById('system-update');
 panel.addEventListener('toggle',()=>{if(panel.open&&!panel.hidden)void check(true);});
 const open=()=>check(true);
 window.addEventListener('online',()=>check());document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!panel.hidden)void check(true);});
 return {open};
}
