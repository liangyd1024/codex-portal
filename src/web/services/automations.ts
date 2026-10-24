import {matchingTasks,taskRow,taskPresentation,type AutomationTask,type AutomationRun,type TaskMode,type AutomationViewsRenderer,type AutomationCandidate} from './automation-view.ts';
import type {createApiClient} from './api';
export interface AutomationSnapshot {threadId:string|null;items:AutomationTask[];runs:AutomationRun[];observedAt:number;pendingNativeRefresh?:boolean;truncated?:boolean;[field:string]:unknown}
export type {AutomationCandidate} from './automation-view.ts';
interface Options {api:ReturnType<typeof createApiClient>;onOpen:()=>void;openSession:(id:string,prompt:string)=>unknown;openThread:(id:string)=>unknown;notify:(message:string,error:boolean)=>unknown}
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls?:string,text?:string)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
const time=(value:number|null|undefined)=>value?new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
export function scheduleLabel(rule:unknown){
  const fields:Record<string,string|undefined>=Object.fromEntries(String(rule||'').replace(/^RRULE:/,'').split(';').map(v=>v.split('=')));
  if(Object.keys(fields).some(k=>!['FREQ','INTERVAL','BYDAY','BYHOUR','BYMINUTE','BYSECOND'].includes(k))||fields.BYMINUTE?.includes(',')||(fields.INTERVAL&&fields.INTERVAL!=='1'&&['DAILY','WEEKLY'].includes(fields.FREQ as string)))return '自定义安排';
  if(fields.BYSECOND&&fields.BYSECOND!=='0')return '自定义安排';
  if(['MINUTELY','HOURLY'].includes(fields.FREQ as string)&&['BYDAY','BYHOUR','BYMINUTE'].some(k=>fields[k]))return '自定义安排';
  if(fields.FREQ==='MINUTELY')return `每 ${fields.INTERVAL||1} 分钟`;
  if(fields.FREQ==='HOURLY')return `每 ${fields.INTERVAL||1} 小时`;
  const at=fields.BYHOUR?.split(',').map(h=>h.padStart(2,'0')+':'+(fields.BYMINUTE||'0').padStart(2,'0')).join('、');
  if(fields.FREQ==='DAILY'&&at&&!fields.BYDAY)return '每天 '+at;
  if(fields.FREQ==='WEEKLY'&&at)return '每周 '+(fields.BYDAY||'').split(',').map(d=>(({MO:'一',TU:'二',WE:'三',TH:'四',FR:'五',SA:'六',SU:'日'} as Record<string,string>)[d]||d)).join('、')+' '+at;
  return '自定义安排';
}
export function installAutomations({api,onOpen,openSession,openThread,notify}:Options){
  const page=node('section','automations-page');page.id='automations-page';page.hidden=true;
  document.querySelector<HTMLElement>('.main-panel')!.insertBefore(page,document.querySelector('.workspace-footer'));
  const header=node('div','automations-heading');
  const feedback=node('p','subtle');feedback.setAttribute('role','status');
  const list=node('div','automation-list');
  const listView=automationViews!.list({list,showTask});
  let snapshot:AutomationSnapshot|null=null,seq=0,loading=false,threadId:string|null=null,filter='all',signature='',activeDialog:HTMLDialogElement|null=null;
  const manage=async(prompt='')=>{try{if(!threadId){await choose(prompt);return;}await openSession(threadId,prompt);}catch(error){notify((error as Error).message,true);}};
  const toolbar=node('div','automations-toolbar');
  const controls=automationViews!.controls({header,toolbar,feedback,onCreate:()=>manage('请帮我创建一个定时任务。'),onRefresh:load,onSearch:render,onFilter:value=>{filter=value;render();}});
  const {search,createButton:create}=controls;
  page.append(header,toolbar,feedback,list);
  function showTask(task:AutomationTask,mode:TaskMode='view'){
    activeDialog?.close();
    const trigger=(document.activeElement?.closest('.automation-row')?.querySelector('.automation-name')||document.activeElement) as HTMLElement|null;
    const dialog=node('dialog','automation-task-panel');activeDialog=dialog;
    dialog.setAttribute('aria-label',task.name);
    const view=taskPresentation(task,mode,snapshot!.runs,time,scheduleLabel);
    const content=automationViews!.task({dialog,view,edit:()=>showTask(task,'edit'),manage:()=>{dialog.close();void manage(view.managePrompt);},openThread:id=>{dialog.close();void openThread(id);}});
    document.body.append(dialog);dialog.showModal();content.closeButton.focus();
    dialog.addEventListener('close',()=>{if(activeDialog===dialog)activeDialog=null;content.dispose();dialog.remove();if(!page.hidden)(trigger?.isConnected?trigger:create).focus();},{once:true});
  }
  function render(){
    listView.render(snapshot?matchingTasks(snapshot.items,filter,search.value).map(task=>taskRow(task,time,scheduleLabel)):null);
  }
  async function load(){
    if(loading)return;loading=true;const version=++seq;controls.setState({loading:true,feedback:'正在同步原生定时任务…'});
    try{const data=await api<AutomationSnapshot>('/api/automations');if(version!==seq)return;snapshot=data;threadId=data.threadId;const next=JSON.stringify([data.items,data.runs]);if(signature!==next){render();signature=next;}controls.setState({feedback:data.pendingNativeRefresh?'部分任务等待桌面同步，请在桌面打开定时任务后刷新。':data.truncated?'当前显示最近 500 个任务。':'与目标机器 Codex 共用任务 · '+time(data.observedAt)+' 同步'});}
    catch(error){if(version===seq)controls.setState({feedback:'同步失败：'+(error as Error).message+' 已有列表保留。'});}
    finally{loading=false;controls.setState({loading:false});}
  }
  async function choose(prompt=''){
    const trigger=document.activeElement as HTMLElement|null;
    const dialog=node('dialog','automation-picker');let request=0,busy=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const view=automationViews!.picker({dialog,cancel:()=>dialog.close(),search:()=>{clearTimeout(timer);timer=setTimeout(find,250);},select:()=>view.setState({confirmDisabled:!choices.value}),confirm:async()=>{
      if(!choices.value||busy)return;busy=true;view.setState({busy:true,confirmDisabled:true,error:'正在确认桌面托管状态…'});
      try{const result=await api<{threadId:string}>('/api/automations/binding',{method:'POST',body:{threadId:choices.value}});threadId=result.threadId;dialog.close();await manage(prompt);}
      catch(e){view.setState({error:(e as Error).message});}
      finally{busy=false;view.setState({busy:false,confirmDisabled:false});}
    }});
    const {query,choices}=view;
    document.body.append(dialog);dialog.showModal();query.focus();
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>{request++;view.dispose();dialog.remove();if(page.hidden)return;(trigger?.isConnected?trigger:create).focus();},{once:true});
    async function find(){const version=++request;view.setState({confirmDisabled:true});try{const result=await api<{data:AutomationCandidate[]}>('/api/automations/candidates?search='+encodeURIComponent(query.value));if(version!==request)return;view.setCandidates(result.data,threadId);view.setState({confirmDisabled:!choices.value,error:result.data.length?'':'没有匹配的会话。'});}catch(e){if(version===request)view.setState({error:(e as Error).message});}}
    await find();
  }
  return {get threadId(){return threadId;},get opened(){return !page.hidden;},
    open(){onOpen();page.hidden=false;document.querySelector<HTMLElement>('.main-panel')!.classList.add('automations-open');void load();},
    close(){activeDialog?.close();page.hidden=true;document.querySelector<HTMLElement>('.main-panel')!.classList.remove('automations-open');},refresh:load};
}

let automationViews:AutomationViewsRenderer|undefined;
export function configureAutomationViews(renderer:AutomationViewsRenderer|undefined){automationViews=renderer;}
