import type {NativeGoal,NativeTurn} from '../../contracts/native';
import type {installReactGoalToolbar} from '../components/GoalToolbar';
import type {installReactGoalEditor} from '../components/GoalEditor';
export function goalDuration(seconds:number|undefined){
 if(!Number.isFinite(seconds)||seconds!<0)return '';
 const minutes=Math.floor(seconds!/60);
 if(!minutes)return '不足1分钟';
 const hours=Math.floor(minutes/60),remainder=minutes%60;
 return (hours?hours+'小时':'')+(remainder?remainder+'分钟':'');
}
const labels:Record<string,string>={active:'进行中的目标',paused:'已暂停的目标',blocked:'已阻塞的目标',budgetLimited:'目标预算已用尽',usageLimited:'目标用量受限',complete:'已完成的目标'};
export function goalPresentation(goal:{status?:string}|null|undefined,error:unknown){
 const status=goal?.status;
 return {visible:Boolean(error||(goal&&status!=='complete')),label:error?'目标待确认':labels[status!]||'目标待确认',action:!error?(status==='active'?'paused':['paused','blocked'].includes(status!)?'active':null):null};
}
let toolbarInstaller:typeof installReactGoalToolbar|undefined;
export function configureGoalToolbar(installer:typeof installReactGoalToolbar){toolbarInstaller=installer;}
export function installGoalToolbar(options:Parameters<typeof installReactGoalToolbar>[0]){
 if(!toolbarInstaller)throw new Error('目标工具栏尚未初始化。');
 return toolbarInstaller(options);
}

let editorInstaller:typeof installReactGoalEditor|undefined;
export function configureGoalEditor(installer:typeof installReactGoalEditor){editorInstaller=installer;}
export function installGoalEditor(options:Parameters<typeof installReactGoalEditor>[0]){
 if(!editorInstaller)throw new Error('目标编辑器尚未初始化。');
 return editorInstaller(options);
}

// Completion is native goal metadata, never an invented assistant message.
export function completedGoalPlacement(goal:NativeGoal|null|undefined,turns:NativeTurn[],error:unknown){
 if(error||goal?.status!=='complete')return null;
 let matching:NativeTurn|null=null;
 if(Number.isFinite(goal.updatedAt))for(const turn of turns){
  if(Number.isFinite(turn.startedAt)&&turn.startedAt!<=goal.updatedAt!&&(!matching||turn.startedAt!>matching.startedAt!))matching=turn;
 }
 return {goal,turnId:matching?.id||null};
}
export function renderCompletedGoal(goal:NativeGoal){
 const row=document.createElement('details');row.className='goal-completion';row.setAttribute('aria-label','目标完成记录');
 row.dataset.itemId='goal-completion-'+goal.createdAt+'-'+goal.updatedAt;
 const summary=document.createElement('summary');summary.textContent='✓ 目标已完成';
 const objective=document.createElement('p');objective.className='goal-completion-objective';objective.textContent=goal.objective||'';
 const meta=document.createElement('p');meta.className='goal-completion-meta';
 const stamp=Number.isFinite(goal.updatedAt)?new Date(goal.updatedAt!*1000):null;
 meta.textContent=[stamp&&!Number.isNaN(stamp.getTime())?stamp.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'',goalDuration(goal.timeUsedSeconds)].filter(Boolean).join(' · ');
 row.append(summary,objective,meta);return row;
}
