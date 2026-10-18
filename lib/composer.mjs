import {AppError} from './manager.mjs';

export function permissionParams(access, start=false) {
  if(access===undefined)return {};
  if(!['default','full'].includes(access))throw new AppError('权限设置无效。');
  return access==='full'
    ? {approvalPolicy:'never',...(start?{sandbox:'danger-full-access'}:{sandboxPolicy:{type:'dangerFullAccess'}})}
    : {approvalPolicy:'on-request',...(start?{sandbox:'workspace-write'}:{sandboxPolicy:{type:'workspaceWrite',networkAccess:false}})};
}

export async function composerCatalog(m,cwd) {
  m.requireConnected();
  if(typeof cwd!=='string'||!cwd.startsWith('/'))throw new AppError('请选择项目。');
  const read=async(method,params)=>{try{return await m.rpc.request(method,params,{timeoutMs:10000});}catch(e){return {error:e.message};}};
  const [modes,skills,plugins]=await Promise.all([
    read('collaborationMode/list',{}),read('skills/list',{cwds:[cwd]}),read('plugin/installed',{cwds:[cwd]}),
  ]);
  return {modes,skills,plugins};
}

export async function turnOptions(m,id,{access,mode,skills=[],plugins=[]},selection) {
  const result=permissionParams(access);
  if(mode!==undefined){
    if(mode==='plan')m.requireCapability('plan');
    if(!['default','plan'].includes(mode))throw new AppError('执行模式无效。');
    const model=selection.model||m.controlled.get(id)?.model;
    if(!model)throw new AppError('请选择模型。');
    result.collaborationMode={mode,settings:{model,reasoning_effort:selection.effort||null}};
  }
  if(!Array.isArray(skills)||skills.length>20||!Array.isArray(plugins)||plugins.length>20)throw new AppError('技能或插件选择无效。');
  const input=[];
  if(skills.length||plugins.length){
    if(skills.length)m.requireCapability('skills');
    if(plugins.length)m.requireCapability('plugins');
    const catalog=await composerCatalog(m,m.controlled.get(id)?.cwd);
    const available=(catalog.skills.data||[]).flatMap(e=>e.skills||[]);
    for(const path of skills){
      const skill=available.find(s=>s.path===path&&s.enabled);
      if(!skill)throw new AppError('所选技能已不可用，请重新选择。');
      input.push({type:'skill',name:skill.name,path:skill.path});
    }
    const installed=(catalog.plugins.marketplaces||[]).flatMap(e=>e.plugins||[]);
    for(const id of plugins){
      const plugin=installed.find(p=>p.id===id&&p.installed&&p.enabled);
      if(!plugin)throw new AppError('所选插件已不可用，请重新选择。');
      input.push({type:'text',text:'请使用已启用的插件「'+plugin.name+'」完成本次任务。'});
    }
  }
  return {params:result,input};
}

export async function setGoal(m,id,{objective,status,tokenBudget}={}) {
  m.assertControl(id);
  m.requireCapability('goal');
  if(m.activeTurns.has(id)||m.controlled.get(id)?.status?.type==='active')throw new AppError('请等待当前轮次结束后设置目标。',409,'THREAD_BUSY');
  if(objective!==undefined&&(typeof objective!=='string'||!objective.trim()||objective.length>10000))throw new AppError('请填写目标。');
  if(status!==undefined&&!['active','paused','complete'].includes(status))throw new AppError('目标状态无效。');
  if(tokenBudget!==undefined&&(!Number.isSafeInteger(tokenBudget)||tokenBudget<=0))throw new AppError('Token 预算必须为正整数。');
  if(objective===undefined&&status===undefined)throw new AppError('请填写目标或选择状态。');
  return m.withMutation(()=>m.rpc.request('thread/goal/set',{threadId:id,origin:'user',...(objective!==undefined?{objective:objective.trim()}:{}),...(status?{status}:{}),...(tokenBudget!==undefined?{tokenBudget}:{})},{timeoutMs:10000}),id);
}
