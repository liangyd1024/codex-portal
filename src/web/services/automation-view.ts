export interface AutomationTask {id:string;name:string;status:string;rrule:string;prompt?:string|null;target_thread_id?:string|null;kind?:string|null;last_run_at?:number|null;next_run_at?:number|null;[field:string]:unknown}
export interface AutomationRun {automation_id:string;thread_id:string;created_at:number;status:string;[field:string]:unknown}
export type TaskMode='view'|'edit'|'delete';
type Time=(value:number|null|undefined)=>string;
export function matchingTasks(items:AutomationTask[],filter:string,query:string){return items.filter(task=>(filter==='all'||task.status===filter)&&task.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>(a.next_run_at??Infinity)-(b.next_run_at??Infinity));}
export function taskRow(task:AutomationTask,time:Time,schedule:(rule:string)=>string){return {task,meta:(task.status==='PAUSED'?'已暂停':task.next_run_at?'下次 '+time(task.next_run_at):'等待原生调度更新')+' · '+schedule(task.rrule)};}
export function taskPresentation(task:AutomationTask,mode:TaskMode,runs:AutomationRun[],time:Time,schedule:(rule:string)=>string){
 const editing=mode==='edit';
 return {name:task.name,mode,status:(task.status==='PAUSED'?'已暂停':'即将执行')+' · '+schedule(task.rrule),heading:editing?'编辑任务':'删除任务',
  explanation:'网页版通过已绑定的管理会话'+(editing?'编辑':'删除')+'此任务。该会话包含历史消息，与下方执行会话可能不同；打开后只填写草稿，发送后才执行。',
  manageLabel:editing?'前往管理会话编辑':'前往管理会话删除',managePrompt:editing?`请修改定时任务「${task.name}」（原生任务 ID：${task.id}）。`:`请删除定时任务「${task.name}」（原生任务 ID：${task.id}），只删除这一项。`,
  prompt:task.prompt,targetThreadId:task.target_thread_id,lastRun:task.last_run_at?'最近原生触发：'+time(task.last_run_at):null,
  emptyRuns:task.kind==='heartbeat'?'此任务在原会话运行，结果请打开执行会话查看。':'暂无原生运行记录',
  runs:runs.filter(run=>run.automation_id===task.id).map(run=>({threadId:run.thread_id,label:time(run.created_at)+' · '+(({IN_PROGRESS:'执行中',PENDING_REVIEW:'待查看',ACCEPTED:'已查看',ARCHIVED:'已归档'} as Record<string,string>)[run.status]||run.status)}))};
}
export type TaskRow=ReturnType<typeof taskRow>;
export type TaskPresentation=ReturnType<typeof taskPresentation>;

export interface AutomationListOptions {list:HTMLElement;showTask:(task:AutomationTask,mode?:TaskMode)=>void}
export interface AutomationDialogOptions {dialog:HTMLDialogElement;view:TaskPresentation;edit:()=>void;manage:()=>void;openThread:(id:string)=>void}
export interface AutomationControlsState {loading:boolean;feedback:string}
export interface AutomationControlsOptions {header:HTMLElement;toolbar:HTMLElement;feedback:HTMLElement;onCreate:()=>unknown;onRefresh:()=>unknown;onSearch:()=>void;onFilter:(value:string)=>void}
export interface AutomationViewsRenderer {
 controls:(options:AutomationControlsOptions)=>{search:HTMLInputElement;createButton:HTMLButtonElement;setState:(state:Partial<AutomationControlsState>)=>void};
 list:(options:AutomationListOptions)=>{render:(rows:TaskRow[]|null)=>void};
 task:(options:AutomationDialogOptions)=>{closeButton:HTMLButtonElement;dispose:()=>void};
}
