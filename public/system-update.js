export function installSystemUpdate({api,flush,resetCsrf}){
 const area=document.getElementById('system-update-body');
 const description=document.createElement('p');description.className='subtle';description.textContent='拉取 master 最新代码并重新部署当前网页服务。更新时连接会短暂断开，完成后自动恢复。';
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent='更新并重新部署';button.disabled=true;
 const refresh=document.createElement('button');refresh.type='button';refresh.className='text-button';refresh.textContent='检查更新状态';
 const reload=document.createElement('button');reload.type='button';reload.className='text-button';reload.textContent='刷新页面使用新版本';reload.hidden=true;reload.onclick=()=>{flush();location.reload();};
 const active=job=>['queued','checking','pulling','testing','installing'].includes(job?.phase);
 let submitting=false,reading=false,last=null,timer=null,uncertain=false,generation=0;
 function render(data){
  last=data;const running=active(data.job);button.disabled=submitting||uncertain||running||!data.available;
  button.textContent=submitting?'正在提交…':running?'正在更新…':'更新并重新部署';
  status.textContent=data.job?.message||data.reason||'更新入口已就绪。';
  reload.hidden=data.job?.phase!=='succeeded';
  if(running){clearTimeout(timer);timer=setTimeout(check,2000);}
 }
 async function check(){
  if(reading)return;reading=true;refresh.disabled=true;const version=generation;
  try{const data=await api('/api/system/update',{timeout:8000});if(version!==generation)return;uncertain=false;render(data);}
  catch(error){if(version!==generation)return;status.textContent=active(last?.job)||submitting||uncertain?'正在等待网页服务恢复，稍后自动核对更新结果…':error.message;clearTimeout(timer);timer=setTimeout(check,3000);}
  finally{reading=false;refresh.disabled=false;}
 }
 button.onclick=async()=>{
  if(button.disabled||submitting)return;submitting=true;uncertain=true;generation++;flush();button.disabled=true;button.textContent='正在提交…';status.textContent='正在提交更新请求…';
  try{resetCsrf();const data=await api('/api/system/update',{method:'POST',body:{},timeout:15000});uncertain=false;render(data);}
  catch(error){status.textContent=error.status?'更新未开始：'+error.message:'提交结果暂未确认，正在检查更新状态…';if(error.status)uncertain=false;}
  finally{submitting=false;if(last&&!uncertain)button.disabled=active(last.job)||!last.available;button.textContent=active(last?.job)?'正在更新…':'更新并重新部署';clearTimeout(timer);timer=setTimeout(check,1500);}
 };
 refresh.onclick=check;area.append(description,status,button,refresh,reload);void check();
 window.addEventListener('online',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check();});
}
