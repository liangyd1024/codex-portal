import {AppError} from './core/errors.mjs';

const statuses=new Set(['active','paused','blocked','budgetLimited','usageLimited','complete']);
export function checkedGoal(result){
  if(!result||!Object.hasOwn(result,'goal')||result.goal!==null&&(!statuses.has(result.goal?.status)||typeof result.goal.objective!=='string'||!Number.isFinite(result.goal.createdAt)))
    throw new AppError('无法确认原目标状态，请刷新后重试。',409,'GOAL_CHECK_FAILED');
  return result.goal;
}

// Reads only. A loaded thread belongs to this engine; subscribing again must
// remain possible while its goal is active. Cross-engine resumes need a guard.
export async function prepareTakeover(manager,id,rpc,generation){
  const current=()=>{if(manager.rpc!==rpc||manager.generation!==generation||!rpc.connected)throw new AppError('连接已变化，请重连后核对会话状态。',409,'CONNECTION_CHANGED');};
  const loaded=await manager.handoffs.loaded(rpc);current();
  if(loaded.has(id)){
    const result=await rpc.request('thread/goal/get',{threadId:id},{timeoutMs:30000}).catch(error=>{
      if(/^ephemeral thread does not support goals(?::|$)/i.test(error.message))return {goal:null};
      if(/unknown method|method not found/i.test(error.message))return manager.passive('goal',{threadId:id});
      throw error;
    });current();
    return checkedGoal(result);
  }
  let snapshot;
  try{snapshot=await manager.passive('takeoverState',{threadId:id});}
  catch(error){current();throw new AppError('接管前无法确认目标和桌面状态，请刷新后重试。',409,'GOAL_CHECK_FAILED',{cause:error.message});}
  current();
  const goal=checkedGoal(snapshot);
  if(snapshot.thread?.id!==id)throw new AppError('会话已变化，请刷新后重试。',409,'CONNECTION_CHANGED');
  if(snapshot.thread.activity?.state==='running')throw new AppError('此会话仍由桌面执行，请使用“恢复桌面连接”继续操作。尚未切换执行入口。',409,'DESKTOP_ACTIVE');
  if(goal?.status==='active')throw new AppError('此会话的目标仍在运行，请先恢复桌面连接。需要切换执行入口时，请先在原入口暂停目标。',409,'GOAL_ACTIVE');
  return goal;
}

// Diagnostic state only: never substitute a cached goal for native state.
export class ResumeGoalWarnings {
  entries=new Map();versions=new Map();
  version(id){return this.versions.get(id)||0;}
  check(id,before,after,error=null){
    if(!before||before.status==='complete')return;
    this.versions.set(id,this.version(id)+1);
    const message=error?'会话已连接，但原目标是否保留尚未确认。请刷新重试；不会自动重建目标。':
      !after?'会话已连接，但原来未完成的目标未保留。请核对原入口；不会自动重建或重新执行目标。':
      before.createdAt!==after.createdAt||before.objective!==after.objective?'会话已连接，但目标与连接前不一致。请核对原入口；不会自动覆盖目标。':null;
    if(message)this.entries.set(id,{before,message});else this.entries.delete(id);
  }
  observe(id,goal,version=this.version(id)){
    const entry=this.entries.get(id);
    if(version===this.version(id)&&entry&&goal&&goal.createdAt===entry.before.createdAt&&goal.objective===entry.before.objective)this.entries.delete(id);
    return this.entries.get(id)?.message||null;
  }
  clear(id){this.versions.set(id,this.version(id)+1);this.entries.delete(id);}
}
