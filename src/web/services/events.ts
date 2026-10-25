import type {ConnectionStatus} from './connection-status';
export interface Request {id?:unknown;key?:string;[field:string]:unknown}
export interface StreamItem {id?:string;type:string;text?:string;aggregatedOutput?:string;summary?:string[];[field:string]:unknown}
export interface StreamTurn {id?:string;items:StreamItem[];error?:unknown;[field:string]:unknown}
export interface EventParams extends Request {threadId?:string;thread?:{id?:string};turnId?:string;turn?:StreamTurn;item?:StreamItem;itemId?:string;request?:Request;requestId?:unknown;status?:ConnectionStatus;message?:unknown;error?:unknown;stage?:string;threadName?:string;name?:string;delta?:string;summaryIndex?:number}
interface Envelope {method?:string;params?:EventParams;replayed?:boolean;[field:string]:unknown}
interface EventState {selectedId:string|null;listVersion:number;sidebar:unknown;threads:unknown[];projects:unknown[];models:unknown[];threadCursor:string|null;localRequests:Request[];status:(ConnectionStatus&{pendingRequests?:Request[];service?:{outputJournal?:unknown;[field:string]:unknown}})|null;detail:({thread:{status?:unknown;name?:string;[field:string]:unknown};pendingRequests?:Request[];[field:string]:unknown})|null;runtimeNotices:Map<string,Map<string,Record<string,unknown>>>}
export interface EventDependencies {
 state:EventState;sideChat:()=>{event:(method:string,params:EventParams)=>void}|null|undefined;
 accountVersion:{next:()=>number;get:()=>number};createdThreads:{clear:()=>void};workspaceStarting:()=>boolean;
 renderThreads:()=>void;renderProjects:()=>void;renderModels:()=>void;refreshAccountUsage:(force:boolean)=>unknown;
 catalogs:{pendingModels:()=>unknown;pendingProjects:()=>unknown};loadThreads:((append?:boolean,force?:boolean)=>unknown)&{pending:()=>unknown};loadModels:(force:boolean)=>unknown;loadProjects:()=>unknown;
 connected:()=>boolean;recordError:(error:unknown,stage:string)=>void;scheduleListRefresh:()=>void;scheduleDetailRefresh:()=>void;scheduleStreamRender:(kind?:'all'|'text')=>void;
 authRecoveryMessage:(error:unknown)=>unknown;notifyTaskEvent:(method:string,params:EventParams|Request)=>unknown;applyStatus:(status:ConnectionStatus)=>void;
 renderStatus:()=>void;renderRequests:()=>void;renderThread:()=>void;resumeWorkspace:()=>Promise<unknown>;
 notifyManagerError:(params:EventParams)=>boolean;toast:(message:string,error:boolean,duration:number)=>unknown;messageOf:(value:unknown)=>string;requestKey:(request:Request)=>string;
 updateExtensionNotice:(notices:EventState['runtimeNotices'],params:EventParams)=>unknown;
 upsertTurn:(turn:StreamTurn)=>void;upsertItem:(turnId:string|undefined,item:StreamItem)=>void;ensureTurn:(id:string|undefined)=>StreamTurn|null;turns:()=>StreamTurn[];
}
export function createEventHandler(deps:EventDependencies){
 const {state,createdThreads,renderThreads,renderProjects,renderModels,catalogs,loadThreads,loadModels,loadProjects,connected,recordError,scheduleListRefresh,scheduleDetailRefresh,scheduleStreamRender,authRecoveryMessage,notifyTaskEvent,applyStatus,renderStatus,renderRequests,renderThread,resumeWorkspace,notifyManagerError,toast,messageOf,requestKey,updateExtensionNotice,upsertTurn,upsertItem,ensureTurn,turns}=deps;
return function handleEvent(event:{data:string;type?:string}) {
  let data:Envelope; try { data = JSON.parse(event.data); } catch { return; }
  const method = data.method || event.type!, p = data.params || {};
  deps.sideChat()?.event(method,p);
  if(method==='account/updated'){
    const version=deps.accountVersion.next();
    state.listVersion++;createdThreads.clear();state.sidebar=null;state.threads=[];state.projects=[];state.models=[];state.threadCursor=null;
    renderThreads();renderProjects();renderModels();
    void deps.refreshAccountUsage(true);
    // Drain old reads before reloading; their version guards discard late data.
    void Promise.allSettled([catalogs.pendingModels(),catalogs.pendingProjects(),loadThreads.pending()]).then(()=>{
      if(version!==deps.accountVersion.get()||!connected())return;
      return Promise.allSettled([loadModels(true),loadProjects(),loadThreads(false,true)]).then(results=>{for(const result of results)if(result.status==='rejected')recordError(result.reason,'账号切换刷新');});
    });
    return;
  }
  if (method==='manager/sidebarChanged'||/thread\/(section|readState)\//.test(method)||method.startsWith('threadSection/'))scheduleListRefresh();
  if(method==='manager/taskNotice'){
    // Historical notifications are intentionally not replayed.
    return;
  }
  if(authRecoveryMessage(p.turn?.error||p.error))void deps.refreshAccountUsage(true);
  if(!data.replayed)notifyTaskEvent(method,p);
  if (method === 'manager/status') {
    const was = connected(),previousConnection=state.status?.connection?.connectedAt,previousInstance=state.status?.instanceId; applyStatus(p.status || p); renderStatus(); renderRequests(); renderThread();
    for(const request of state.status!.pendingRequests||[])notifyTaskEvent('manager/request',request);
    if (!deps.workspaceStarting() && connected() && (!was||previousConnection!==state.status?.connection?.connectedAt||previousInstance!==state.status?.instanceId)) resumeWorkspace().catch(e => recordError(e,'sync'));
    return;
  }
  if (method === 'manager/error') { recordError(p.message || p.error || p,p.stage || 'remote'); if(notifyManagerError(p))toast(messageOf(p.message || p.error || p),true,11000); return; }
  if (method === 'manager/request') {
    const r = p.request || p; if (r.id != null) state.localRequests = [...state.localRequests.filter(x => requestKey(x) !== requestKey(r)),r];
    renderRequests();
    return;
  }
  if (method === 'serverRequest/resolved' || method === 'manager/requestResolved') {
    const rid = p.requestId ?? p.id, resolvedKey = p.key ?? (typeof rid + ':' + String(rid)); const filter = (list:Request[]|undefined) => (list || []).filter(r => requestKey(r) !== resolvedKey);
    state.localRequests = filter(state.localRequests); if (state.status) state.status!.pendingRequests = filter(state.status!.pendingRequests); if (state.detail) state.detail.pendingRequests = filter(state.detail.pendingRequests); renderRequests(); return;
  }
  if (/thread\/(started|name\/updated|archived|unarchived)|turn\/(started|completed)/.test(method)) scheduleListRefresh();
  const threadId = p.threadId || p.thread?.id;
  if (method === 'mcpServer/startupStatus/updated') {
    updateExtensionNotice(state.runtimeNotices,p);
    if (threadId === state.selectedId && state.detail) scheduleStreamRender();
    return;
  }
  if (threadId !== state.selectedId || !state.detail) return;
  if (method === 'thread/tokenUsage/updated' || method === 'turn/moderationMetadata') return;
  if (method === 'thread/goal/cleared') { scheduleDetailRefresh(); return; }
  if (method === 'thread/queue/changed') { scheduleDetailRefresh(); return; }
  if (method === 'thread/status/changed') { state.detail.thread.status = p.status; scheduleStreamRender(); return; }
  if (method === 'thread/name/updated') { state.detail.thread.name = p.threadName || p.name; renderThread(); return; }
  if (method === 'turn/started' || method === 'turn/completed') {
    if (p.turn) upsertTurn(p.turn); if (method === 'turn/completed') { state.detail.thread.status = {type:'idle'}; scheduleDetailRefresh(); }
    else state.detail.thread.status = {type:'active',activeFlags:[]}; scheduleStreamRender(); return;
  }
  if (method === 'item/started' || method === 'item/completed') { if (p.item) upsertItem(p.turnId,p.item); scheduleStreamRender(); return; }
  if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') {
    const t = ensureTurn(p.turnId); if (!t) return; let item = t.items.find(x => x.id === p.itemId);
    if (!item) { item = {id:p.itemId,type:method.includes('/plan/') ? 'plan' : 'agentMessage',text:''}; t.items.push(item); } item.text = (item.text || '') + (p.delta || ''); scheduleStreamRender('text'); return;
  }
  if (method === 'item/commandExecution/outputDelta') {
    if(state.status?.service?.outputJournal){scheduleDetailRefresh();return;}
    const t = ensureTurn(p.turnId); if (!t) return; let item = t.items.find(x => x.id === p.itemId);
    if (!item) { item = {id:p.itemId,type:'commandExecution',status:'inProgress',aggregatedOutput:''}; t.items.push(item); }
    item.aggregatedOutput = (item.aggregatedOutput || '') + (p.delta || ''); scheduleStreamRender(); return;
  }
  if (method === 'item/reasoning/summaryTextDelta') {
    const t = ensureTurn(p.turnId); if (!t) return; let item = t.items.find(x => x.id === p.itemId);
    if (!item) { item = {id:p.itemId,type:'reasoning',summary:[]}; t.items.push(item); }
    const i = p.summaryIndex || 0; item.summary![i] = (item.summary![i] || '') + (p.delta || ''); scheduleStreamRender('text'); return;
  }
  if (method === 'error') {
    const t = ensureTurn(p.turnId || turns().at(-1)?.id); if (t) t.error = p.error || p; recordError(p.error || p,'remote'); scheduleStreamRender(); return;
  }
  if (/updated|completed|changed/.test(method)) scheduleDetailRefresh();
}
}
