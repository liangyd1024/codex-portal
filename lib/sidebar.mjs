import {AppError} from './manager.mjs';
export const PINNED_SECTION='01984de2-8f74-7c91-a3b2-5c5e937cf318';
const methods={rename:'thread/name/set',archive:'thread/archive',restore:'thread/unarchive',pin:'thread/section/move',moveSection:'thread/section/move',moveProject:'thread/metadata/update',read:'thread/readState/update',createSection:'threadSection/create',renameSection:'threadSection/update',deleteSection:'threadSection/delete',reorderThread:'thread/section/move'};
const unavailable='当前桌面版没有可同步此设置的接口，请在桌面版修改。';
export function sidebarCapabilities(manager,layout){
  const validated=manager.service.protocolValidation;
  const capabilities=Object.fromEntries(Object.entries(methods).map(([action,method])=>[action,{supported:validated?.policy>=4&&!validated.unsupportedMethods?.includes(method),reason:'当前目标引擎不支持此操作。'}]));
  for(const key of ['preferences','moveProjectSection','reorderProject','reorderSection','reorderProjectThread','createSection','renameSection','deleteSection','moveProject','moveSection','read'])capabilities[key]={supported:false,reason:unavailable};
  capabilities.read.reason='当前桌面版使用独立的已读状态，目标引擎不能可靠同步，请在桌面版修改。';
  if(!layout.accountLayoutAvailable)for(const key of ['pin','moveSection','createSection','renameSection','deleteSection','reorderThread'])capabilities[key]={supported:false,reason:'尚未确认当前桌面账号，暂不修改分区和置顶。'};
  return capabilities;
}
export async function readSidebar(manager,options={}){
  manager.requireConnected();
  // Resolve the active identity every time; never select another account's layout.
  // A transport failure is not a signed-out account. Reject the refresh so the
  // client keeps its last successful layout instead of replacing it with no sections.
  const account=await manager.rpc.request('account/read',{}, {timeoutMs:3000});
  manager.sidebarAccountId=account?.workspaceRouting?.chatgptAccountId||null;
  const data=await manager.passive('sidebar',{...options,accountId:account?.workspaceRouting?.chatgptAccountId||null});
  data.hostName=manager.host?.alias||manager.host?.name||manager.host?.label;
  data.capabilities=sidebarCapabilities(manager,data);
  for(const t of data.data)t.status=manager.controlled.get(t.id)?.status||{type:'unknown'};
  return data;
}
const fail=(message,code='INVALID_REQUEST',status=400)=>{throw new AppError(message,status,code);};
const text=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=200;
export async function sidebarAction(manager,input){
  manager.requireWritable();
  if(!input||!Object.hasOwn(methods,input.action))fail('不支持的侧边栏操作。');
  if(manager.sidebarMutation)fail('正在更新侧边栏，请等待操作完成。','SIDEBAR_BUSY',409);
  manager.sidebarMutation=true;
  try{
    const snapshot=await readSidebar(manager,{archived:input.action==='restore'});
    const capability=snapshot.capabilities[input.action];if(!capability?.supported)fail(capability?.reason||unavailable,'FEATURE_UNAVAILABLE',409);
    if(input.accountScope!==snapshot.accountScope)fail('目标账号已变化，请刷新后重试。','ACCOUNT_CHANGED',409);
    const sectionAction=['renameSection','deleteSection'].includes(input.action);
    let target=sectionAction?snapshot.sections.find(s=>s.id===input.id):snapshot.data.find(t=>t.id===input.id);
    // Archived lists are paged; look up the requested page without trusting browser metadata.
    if(input.action==='restore'&&!target){let cursor=snapshot.nextCursor;while(cursor&&!target){const page=await manager.passive('sidebar',{archived:true,cursor,accountId:manager.sidebarAccountId});target=page.data.find(t=>t.id===input.id);cursor=page.nextCursor;}}
    if(input.action!=='createSection'){
      if(!target)fail('项目或会话已变化，请刷新列表。','SIDEBAR_CHANGED',409);
      if(input.expectedRevision!==target.revision)fail('桌面端已修改此项，请刷新后重新操作。','SIDEBAR_CHANGED',409);
    }
    const p={threadId:input.id};let result;
    switch(input.action){
      case 'rename':if(!text(input.name))fail('名称不能为空且不能超过 200 个字符。');p.name=input.name.trim();break;
      case 'archive':{
        const live=await manager.rpc.request('thread/read',{threadId:input.id,includeTurns:false},{timeoutMs:5000});
        if(live.thread?.status?.type==='active'||manager.startingTurns.has(input.id)||manager.activeTurns.has(input.id))fail('会话正在运行，请结束后再归档。','THREAD_BUSY',409);
        const history=await manager.passive('history',{threadId:input.id,preview:true});
        if(history.data?.some(t=>t.status==='inProgress'))fail('会话仍在运行，暂不能归档。','THREAD_BUSY',409);
        if(!['idle','notLoaded'].includes(live.thread?.status?.type)||history.data?.some(t=>!['completed','interrupted','failed'].includes(t.status)))fail('无法确认会话已结束，请刷新后重试。','STATUS_UNKNOWN',409);
        {
          const [background,queue,goal]=await Promise.all([manager.rpc.request('thread/backgroundTerminals/list',{threadId:input.id,limit:100},{timeoutMs:3000}).catch(error=>{if(live.thread.status.type==='notLoaded'&&/^thread not found:/.test(error.message))return {data:[]};throw error;}),manager.rpc.request('thread/queue/list',{threadId:input.id,limit:100},{timeoutMs:3000}),manager.rpc.request('thread/goal/get',{threadId:input.id},{timeoutMs:3000})]);
          if(!Array.isArray(background.data)||!Array.isArray(queue.data))fail('无法确认后台任务状态，请刷新后重试。','STATUS_UNKNOWN',409);
          if(background.data.length||background.nextCursor||queue.data.length||queue.nextCursor||goal.goal?.status==='active')fail('会话还有后台任务、排队输入或目标，请处理后再归档。','THREAD_BUSY',409);
        }
        break;
      }
      case 'restore':break;
      case 'pin':if(typeof input.pinned!=='boolean')fail('置顶参数无效。');p.sectionId=input.pinned?PINNED_SECTION:null;break;
      case 'moveSection':
        if(input.sectionId!==null&&!snapshot.sections.some(s=>s.id===input.sectionId))fail('分区不存在。');p.sectionId=input.sectionId;break;
      case 'moveProject':
        if(input.projectId!==null&&!snapshot.projects.some(s=>s.id===input.projectId))fail('项目不存在。');p.projectId=input.projectId??'';break;
      case 'read':
        if(typeof input.read!=='boolean'||!target.readRevision)fail('此会话尚无可靠的已读状态，请打开后重试。','READ_STATE_UNAVAILABLE',409);
        p.expectedRevision=target.readRevision;p.operation={type:input.read?'read':'unread'};break;
      case 'createSection':case 'renameSection':
        if(!text(input.name))fail('分区名称不能为空且不能超过 200 个字符。');
        delete p.threadId;p.name=input.name.trim();if(sectionAction)p.sectionId=input.id;break;
      case 'deleteSection':delete p.threadId;p.sectionId=input.id;break;
      case 'reorderThread':{
        if(!target.isPinned||snapshot.preferences.pinned!=='manual')fail('此列表使用自动排序或不支持同步手动顺序。');
        const before=snapshot.data.find(t=>t.id===input.beforeThreadId);
        if(input.beforeThreadId!==null&&(!before||before.sectionId!==target.sectionId||before.id===target.id))fail('只能在同一分区内移动。');
        p.sectionId=target.sectionId;p.beforeThreadId=input.beforeThreadId;break;
      }
    }
    // Prevent a pending automatic title job from overwriting the explicit user name.
    if(input.action==='rename'){const info=manager.autoTitles.get(input.id);if(info)info.manual=true;await manager.titleJobs?.get(input.id)?.catch(()=>{});}
    try{result=await manager.withMutation(()=>manager.rpc.request(methods[input.action],p,{timeoutMs:10000}));}
    catch(error){
      if(error.code==='RPC_TIMEOUT'||!manager.rpc?.connected)throw new AppError('操作结果未确认，请恢复连接并刷新列表核对；不会自动重复执行。',502,'OUTCOME_UNKNOWN');
      throw error;
    }
    if(input.action==='rename'){manager.autoTitles.delete(input.id);manager.saveTitles();}
    if(input.action==='archive'){manager.controlled.delete(input.id);manager.subscriptions.delete(input.id);manager.saveSubscriptions();}
    manager.publish('manager/sidebarChanged',{action:input.action,threadId:sectionAction?null:input.id});
    return {ok:true,result};
  }finally{manager.sidebarMutation=false;}
}
