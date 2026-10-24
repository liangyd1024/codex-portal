export interface UpdateInfo {
 version?:string; available?:boolean; reason?:string;
 latest?:{checkedAt?:number;version?:string;error?:string};
 job?:{phase?:string;message?:string;updatedAt?:number;sourceVersion?:string;targetVersion?:string;documentationOnly?:boolean;unchanged?:boolean}|null;
}
export interface UpdateView {
 disabled:boolean;button:string;status:string;versions:string;title?:string;
 progressHidden:boolean;progressText?:string;stepsHidden:boolean;steps:string;
}
export const initialUpdateView:UpdateView={disabled:true,button:'更新并重新部署',status:'正在读取更新状态…',versions:'',progressHidden:true,stepsHidden:true,steps:''};
export function updateVersionInfo(data:UpdateInfo){
 const job=data.job,latest=data.latest?.checkedAt!==undefined&&data.latest.checkedAt>=(job?.updatedAt||0)?data.latest.version:job?.sourceVersion||job?.targetVersion||data.latest?.version;
 const documentationOnly=job?.phase==='succeeded'&&job.documentationOnly===true&&job.targetVersion===data.version&&job.sourceVersion===latest;
 return {latest,documentationOnly,current:latest===data.version||documentationOnly};
}
interface Dependencies {
 api:(path:string,options:{timeout:number;method?:string;body?:Record<string,unknown>})=>Promise<UpdateInfo>;
 flush:()=>void;resetCsrf:()=>void;publish:(view:UpdateView)=>void;
}
export function installSystemUpdate({api,flush,resetCsrf,publish}:Dependencies){
 const view={...initialUpdateView};publish({...view});
 const active=(job: UpdateInfo["job"])=>['queued','checking','pulling','testing','installing'].includes(job?.phase ?? "");
 let submitting=false,reading=false,last:UpdateInfo|null=null,timer:ReturnType<typeof setTimeout>|undefined,uncertain=false,generation=0;
 function render(data:UpdateInfo){
  clearTimeout(timer);last=data;const running=active(data.job);view.disabled=submitting||uncertain||running||!data.available;
  view.button=submitting?'正在提交…':running?'正在更新…':'更新并重新部署';
  view.status=data.job?.phase==='failed'?'上次更新未完成：'+data.job.message:data.job?.message||data.reason||'更新入口已就绪。';

  const short=(value:string|undefined)=>value?value.slice(0,8):'尚未检查';
  const {latest,documentationOnly,current}=updateVersionInfo(data);
  view.versions='当前版本 '+short(data.version)+'\n'+(current?(documentationOnly?'网页已是最新版本（仅文档更新）':'已是最新版本'):latest?'可更新版本 '+short(latest):data.latest?.error?'尚未检查到新版本':'正在检查新版本…');
  if(data.latest?.error)view.versions+='\n'+data.latest.error;
  if(!data.available&&!latest)view.versions='当前版本 '+short(data.version);
  view.title='当前：'+(data.version||'未知')+'\n远端：'+(latest||'尚未检查');
  view.progressHidden=!running;
  const phases=['checking','pulling','testing','installing','succeeded'],labels=['检查','拉取','验证','部署','完成'];
  const index=phases.indexOf(data.job?.phase ?? "");view.stepsHidden=!data.job||data.job.phase==='failed'||data.job.unchanged===true;
  view.steps=data.job?.phase==='failed'?'更新未完成，请查看上方原因。':labels.map((label,i)=>`${i<index?'✓ ':i===index?'● ':''}${label}`).join(' › ');
  view.progressText=data.job?.message||'正在准备更新';publish({...view});
  if(running){clearTimeout(timer);timer=setTimeout(check,2000);}
 }
 async function check(latest=false){
  if(reading)return;reading=true;const version=generation;
  try{const data=await api('/api/system/update'+(latest?'?check=1':''),{timeout:8000});if(version!==generation)return;uncertain=false;render(data);}
  catch(error){if(version!==generation)return;view.status=active(last?.job)||submitting||uncertain?'正在等待网页服务恢复，稍后自动核对更新结果…':'暂时无法读取更新状态，正在自动重试…';publish({...view});clearTimeout(timer);timer=setTimeout(check,3000);}
  finally{reading=false;}
 }
 async function submit(){
  if(view.disabled||submitting)return;submitting=true;uncertain=true;generation++;flush();view.disabled=true;view.button='正在提交…';view.status='正在提交更新请求…';view.progressHidden=false;view.stepsHidden=false;view.steps='正在准备更新…';publish({...view});
  try{resetCsrf();const data=await api('/api/system/update',{method:'POST',body:{},timeout:15000});uncertain=false;render(data);}
  catch(caught){const error=caught as {status?:number;message:string};view.status=error.status?'更新未开始：'+error.message:'提交结果暂未确认，正在检查更新状态…';if(error.status){uncertain=false;view.progressHidden=true;view.steps='更新未开始';}}
  finally{submitting=false;if(last&&!uncertain)view.disabled=active(last.job)||!last.available;view.button=active(last?.job)?'正在更新…':'更新并重新部署';publish({...view});clearTimeout(timer);timer=setTimeout(check,1500);}
 };
 window.addEventListener('rcm:system-update',event=>{if(!submitting&&!uncertain){generation++;render((event as CustomEvent<UpdateInfo>).detail);}});
 const panel=document.getElementById('system-update') as HTMLDetailsElement;
 panel.addEventListener('toggle',()=>{if(panel.open&&!panel.hidden)void check(true);});
 const open=()=>check(true);
 window.addEventListener('online',()=>check());document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!panel.hidden)void check(true);});
 return {open,submit};
}
