import {AppError} from './core/errors.mjs';

export function permissionParams(access, start=false) {
  if(access===undefined)return {};
  if(!['default','full'].includes(access))throw new AppError('权限设置无效。');
  return access==='full'
    ? {approvalPolicy:'never',...(start?{sandbox:'danger-full-access'}:{sandboxPolicy:{type:'dangerFullAccess'}})}
    : {approvalPolicy:'on-request',...(start?{sandbox:'workspace-write'}:{sandboxPolicy:{type:'workspaceWrite',networkAccess:false}})};
}

// Cache only successful reads, scoped to the live RPC connection and project.
const catalogs=new WeakMap();
export async function composerCatalog(m,cwd,kind=/** @type {string|null} */(null),{fresh=false}={}) {
  m.requireConnected();
  if(typeof cwd!=='string'||!cwd.startsWith('/'))throw new AppError('请选择项目。');
  if(kind!==null&&!['skills','plugins','modes','apps','mentions'].includes(kind))throw new AppError('目录类型无效。');
  const rpc=m.rpc,accountRevision=m.accountRevision||0;
  let cache=catalogs.get(rpc);if(!cache){cache=new Map();catalogs.set(rpc,cache);}
  const read=async(name,method,params)=>{
    const key=JSON.stringify([name==='apps'?null:cwd,name,accountRevision]),prior=cache.get(key);
    if(prior?.pending)return prior.pending;
    if(!fresh&&prior?.data&&Date.now()-prior.at<(name==='apps'?300000:30000))return prior.data;
    const entry={};cache.set(key,entry);
    entry.pending=(async()=>{
      const deadline=Date.now()+30000;
      const request=async params=>{
        const remaining=name==='apps'?deadline-Date.now():30000;if(remaining<=0)throw new AppError('应用目录读取超时，请稍后重试。');
        const result=await rpc.request(method,params,{timeoutMs:remaining});
        if(m.rpc!==rpc||(m.accountRevision||0)!==accountRevision)throw new AppError('连接或账号已变化，请重新读取目录。');
        return result;
      };
      const result=await request(params);
      if(name==='apps'){
        const data=[],ids=new Set(),cursors=new Set();let page=result,pages=0;
        while(true){
          if(!Array.isArray(page.data))throw new AppError('应用目录格式无效。');
          for(const app of page.data)if(app.isAccessible&&app.isEnabled&&!ids.has(app.id)){ids.add(app.id);data.push(app);}
          const cursor=page.nextCursor;if(!cursor)break;
          if(cursors.has(cursor)||++pages>=100)throw new AppError('应用目录未完整读取，请重试。');
          cursors.add(cursor);page=await request({...params,cursor});
        }
        result.data=data;result.nextCursor=null;
      }
      return result;
    })().then(data=>{
      entry.data=data;entry.at=Date.now();return data;
    }).catch(e=>{cache.delete(key);return {error:e.message};}).finally(()=>{entry.pending=null;});
    // Bound completed entries without evicting requests still in flight.
    if(cache.size>60)for(const [k,v] of cache){if(k!==key&&!v.pending){cache.delete(k);if(cache.size<=60)break;}}
    return entry.pending;
  };
  const specs={apps:['app/list',{limit:1000}],modes:['collaborationMode/list',{}],skills:['skills/list',{cwds:[cwd]}],plugins:['plugin/installed',{cwds:[cwd]}]};
  return Object.fromEntries(await Promise.all((kind==='mentions'?['skills','plugins','apps']:kind?[kind]:['modes','skills','plugins']).map(async name=>[name,await read(name,...specs[name])])));
}

export async function turnOptions(m,id,{access,mode,skills=[],plugins=[],apps=[]},selection) {
  const result=permissionParams(access);
  if(mode!==undefined){
    if(mode==='plan')m.requireCapability('plan');
    if(!['default','plan'].includes(mode))throw new AppError('执行模式无效。');
    const model=selection.model||m.controlled.get(id)?.model;
    if(!model)throw new AppError('请选择模型。');
    result.collaborationMode={mode,settings:{model,reasoning_effort:selection.effort||null}};
  }
  const input=await referenceInputs(m,m.controlled.get(id)?.cwd,{skills,plugins,apps});
  return {params:result,input};
}

export async function referenceInputs(m,cwd,{skills=[],plugins=[],apps=[]}) {
  if(!Array.isArray(skills)||skills.length>20||!Array.isArray(plugins)||plugins.length>20)throw new AppError('技能或插件选择无效。');
  const input=[];
  if(!Array.isArray(apps)||apps.length>20)throw new AppError('应用选择无效。');
  if(apps.length){
    const catalog=await composerCatalog(m,cwd,'apps',{fresh:true});
    if(catalog.apps?.error)throw new AppError('应用目录暂时无法读取。草稿已保留。');
    for(const id of apps){const app=catalog.apps.data.find(e=>e.id===id&&e.isAccessible&&e.isEnabled);if(!app)throw new AppError('所选应用已不可用，请重新选择。');input.push({type:'mention',name:app.name,path:'app://'+app.id});}
  }
  if(skills.length||plugins.length){
    if(skills.length)m.requireCapability('skills');
    if(plugins.length)m.requireCapability('plugins');
    const catalog=await composerCatalog(m,cwd,skills.length&&plugins.length?null:skills.length?'skills':'plugins',{fresh:true});
    if(skills.length&&catalog.skills?.error||plugins.length&&catalog.plugins?.error)throw new AppError('能力目录暂时无法读取，请稍后重试。草稿已保留。');
    const available=(catalog.skills?.data||[]).flatMap(e=>e.skills||[]);
    for(const path of skills){
      const skill=available.find(s=>s.path===path&&s.enabled);
      if(!skill)throw new AppError('所选技能已不可用，请重新选择。');
      input.push({type:'skill',name:skill.name,path:skill.path});
    }
    const installed=(catalog.plugins?.marketplaces||[]).flatMap(e=>e.plugins||[]);
    for(const id of plugins){
      const plugin=installed.find(p=>p.id===id&&p.installed&&p.enabled);
      if(!plugin)throw new AppError('所选插件已不可用，请重新选择。');
      input.push({type:'mention',name:plugin.interface?.displayName||plugin.name,path:'plugin://'+plugin.id});
    }
  }
  return input;
}

// Older native goal APIs predate provenance. Omit it only when the verified
// schema says so; modern engines still receive explicit user authorization.
const goalOrigin=(m,method)=>m.service.protocolValidation?.optionalParams?.[method]?.origin===false?{}:{origin:'user'};
export async function setGoal(m,id,{objective,status,tokenBudget,expectedObjective,clear}={}) {
  m.assertControl(id);
  m.requireCapability('goal');
  if(clear!==undefined){
    if(clear!==true||objective!==undefined||status!==undefined||tokenBudget!==undefined||expectedObjective!==undefined)throw new AppError('删除目标参数无效。');
    m.requireCapability('goalClear');
    return m.withMutation(async()=>{const result=await m.rpc.request('thread/goal/clear',{threadId:id,...goalOrigin(m,'thread/goal/clear')},{timeoutMs:10000});m.resumeGoalWarnings?.clear(id);return result;},id);
  }
  const editing=expectedObjective!==undefined;
  if(editing&&(typeof expectedObjective!=='string'||objective===undefined||status!==undefined||tokenBudget!==undefined))throw new AppError('目标编辑参数无效。');
  if(!editing&&!(status==='paused'&&objective===undefined&&tokenBudget===undefined)&&(m.activeTurns.has(id)||m.controlled.get(id)?.status?.type==='active'))throw new AppError('请等待当前轮次结束后设置目标。',409,'THREAD_BUSY');
  if(objective!==undefined&&(typeof objective!=='string'||!objective.trim()||objective.length>10000))throw new AppError('请填写目标。');
  if(status!==undefined&&!['active','paused','complete'].includes(status))throw new AppError('目标状态无效。');
  if(tokenBudget!==undefined&&(!Number.isSafeInteger(tokenBudget)||tokenBudget<=0))throw new AppError('Token 预算必须为正整数。');
  if(objective===undefined&&status===undefined)throw new AppError('请填写目标或选择状态。');
  return m.withMutation(async()=>{
    if(!editing&&objective!==undefined){
      const {goal}=await m.rpc.request('thread/goal/get',{threadId:id},{timeoutMs:10000});
      if(goal)throw new AppError('已有目标，请使用“编辑目标”修改。追加消息不会修改目标。',409,'GOAL_EXISTS');
      m.assertControl(id);
    }
    if(editing){
      const {goal}=await m.rpc.request('thread/goal/get',{threadId:id},{timeoutMs:10000});
      if(!goal||goal.objective!==expectedObjective)throw new AppError('目标已变化，请重新读取后再保存。',409,'GOAL_CHANGED');
      m.assertControl(id);
      if(goal.objective.trim()===objective.trim())return {goal};
    }
    const rpc=m.rpc,generation=m.generation;
    const result=await rpc.request('thread/goal/set',{threadId:id,...goalOrigin(m,'thread/goal/set'),...(objective!==undefined?{objective:objective.trim()}:{}),...(editing?{status:'active'}:status?{status}:{}),...(tokenBudget!==undefined?{tokenBudget}:{})},{timeoutMs:10000});
    if(m.rpc===rpc&&m.generation===generation)m.resumeGoalWarnings?.clear(id);
    if(!editing&&objective!==undefined&&m.rpc===rpc&&m.generation===generation)m.titleFromFirstInput(id,objective);
    return result;},id);
}
