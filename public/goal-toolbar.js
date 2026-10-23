const labels={active:'进行中的目标',paused:'已暂停的目标',blocked:'已阻塞的目标',budgetLimited:'目标预算已用尽',usageLimited:'目标用量受限',complete:'已完成的目标'};
export function goalPresentation(goal,error){
 const status=goal?.status;
 return {visible:Boolean(error||(goal&&status!=='complete')),label:error?'目标待确认':labels[status]||'目标待确认',action:!error?(status==='active'?'paused':['paused','blocked'].includes(status)?'active':null):null};
}
const shapes={goal:'<circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4"/><path d="m11 13 9-9m-5 0h5v5"/>',clear:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7"/>',paused:'<circle cx="12" cy="12" r="9"/><path d="M10 8v8m4-8v8"/>',active:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>'};
function icon(kind){return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+shapes[kind]+'</svg>';}
export function installGoalToolbar({input,context,api,refresh}){
 const bar=document.createElement('section');bar.className='goal-toolbar';bar.hidden=true;bar.setAttribute('aria-label','会话目标');
 bar.innerHTML=icon('goal')+'<div class="goal-toolbar-info"><strong></strong><span class="goal-toolbar-usage"></span></div><button type="button" class="goal-clear" aria-label="删除目标" title="删除目标">'+icon('clear')+'</button><button type="button" class="goal-toggle"></button><span class="goal-toolbar-feedback" role="status"></span>';
 input.form.before(bar);
 const label=bar.querySelector('strong'),usage=bar.querySelector('.goal-toolbar-usage'),clear=bar.querySelector('.goal-clear'),toggle=bar.querySelector('.goal-toggle'),feedback=bar.querySelector('[role=status]');
 let pending=false,error='',errorId=null;
 function render(){
  const c=context(),view=goalPresentation(c.goal,c.goalError);
  bar.hidden=c.draft||c.ephemeral||!view.visible;
  bar.setAttribute('aria-busy',String(pending));label.textContent=view.label;label.title=c.goal?.objective||'';
  usage.textContent=[Number.isFinite(c.goal?.tokensUsed)?c.goal.tokensUsed.toLocaleString()+' tokens':'',Number.isFinite(c.goal?.timeUsedSeconds)?Math.floor(c.goal.timeUsedSeconds)+'秒':''].filter(Boolean).join(' · ');
  clear.disabled=pending||!c.ready||c.busy||Boolean(c.goalError)||!c.goal;
  toggle.hidden=!view.action;toggle.disabled=clear.disabled||(view.action==='active'&&c.active);
  const name=view.action==='paused'?'暂停目标':'继续目标';toggle.title=name;toggle.setAttribute('aria-label',name);if(toggle.dataset.action!==view.action){toggle.dataset.action=view.action||'';toggle.innerHTML=icon(view.action||'active');}
  feedback.textContent=errorId===c.id?error:'';
 }
 async function mutate(clearGoal){
  const c=context(),view=goalPresentation(c.goal,c.goalError);
  if(pending||!c.ready||c.busy||c.goalError||!c.goal||(!clearGoal&&(!view.action||(view.action==='active'&&c.active))))return;
  const id=c.id;pending=true;error='';errorId=id;render();
  try{
   await api('/api/threads/'+encodeURIComponent(id)+'/goal',{method:'POST',body:clearGoal?{clear:true}:{status:view.action}});
   if(context().id===id){await refresh();if(clearGoal&&context().id===id&&!context().goal)input.focus();}
  }catch(e){if(context().id===id)error='目标操作未确认：'+e.message;}
  finally{pending=false;render();}
 }
 clear.onclick=()=>mutate(true);toggle.onclick=()=>mutate(false);
 return {render};
}

// Completion is native goal metadata, never an invented assistant message.
export function completedGoalPlacement(goal,turns,error){
 if(error||goal?.status!=='complete')return null;
 let matching=null;
 if(Number.isFinite(goal.updatedAt))for(const turn of turns){
  if(Number.isFinite(turn.startedAt)&&turn.startedAt<=goal.updatedAt&&(!matching||turn.startedAt>matching.startedAt))matching=turn;
 }
 return {goal,turnId:matching?.id||null};
}
export function renderCompletedGoal(goal){
 const row=document.createElement('details');row.className='goal-completion';row.setAttribute('aria-label','目标完成记录');
 row.dataset.itemId='goal-completion-'+goal.createdAt+'-'+goal.updatedAt;
 const summary=document.createElement('summary');summary.textContent='✓ 目标已完成';
 const objective=document.createElement('p');objective.className='goal-completion-objective';objective.textContent=goal.objective||'';
 const meta=document.createElement('p');meta.className='goal-completion-meta';
 const stamp=Number.isFinite(goal.updatedAt)?new Date(goal.updatedAt*1000):null;
 meta.textContent=[stamp&&!Number.isNaN(stamp.getTime())?stamp.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'',Number.isFinite(goal.tokensUsed)?goal.tokensUsed.toLocaleString()+' tokens':'',Number.isFinite(goal.timeUsedSeconds)?Math.floor(goal.timeUsedSeconds)+'秒':''].filter(Boolean).join(' · ');
 row.append(summary,objective,meta);return row;
}
