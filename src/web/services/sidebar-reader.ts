interface SidebarThread {id:string;activity?:unknown;archived?:boolean;[field:string]:unknown}
import type {SidebarSnapshot} from './sidebar';
interface SidebarState {status?:{instanceId?:unknown;connection?:{connectedAt?:unknown}}|null;projectId?:string|null;projects:unknown[];listVersion:number;loadingThreads:boolean;threadPageError:boolean;search:string;threads:SidebarThread[];threadCursor:string|null;selectedId:string|null;sidebarArchived:boolean;sidebar?:SidebarSnapshot|null;selectedArchived:boolean;threadListSource:string|null}
interface Dependencies {state:SidebarState;createdThreads:Map<string,SidebarThread>;connected:()=>boolean;loadProjects:()=>Promise<unknown>;threadName:(thread:SidebarThread)=>string;element:(id:'project-list')=>HTMLElement;renderThreads:()=>void;renderControls:()=>void;api:(path:string)=>Promise<SidebarSnapshot>;loadThreads:(append?:boolean,reportFailure?:boolean,fresh?:boolean)=>Promise<void>;recordError:(error:unknown,stage:string)=>void;toast:(message:string,error:boolean)=>void;messageOf:(error:unknown)=>string;requestAnimationFrame:(callback:()=>void)=>unknown}
export function createSidebarReader({state,createdThreads,connected,loadProjects,threadName,element:$,renderThreads,renderControls,api,loadThreads,recordError,toast,messageOf,requestAnimationFrame}:Dependencies){
let threadSearch='';
async function readThreads(append = false, reportFailure = false) {
  if (!connected() || (append && (state.loadingThreads || !state.threadCursor))) return;
  // Restore project metadata before grouping the cross-project thread list.
  if (state.projectId && !state.projects.length) await loadProjects();
  const seq = ++state.listVersion; state.loadingThreads = true; state.threadPageError = false;
  if (!append) {
    if (threadSearch !== state.search) {
      state.threads = [...createdThreads.values()].filter(t => !state.search || threadName(t).includes(state.search));
      $('project-list').scrollTop = 0;
    }
    threadSearch = state.search; state.threadCursor = null;
  }
  renderThreads();
  const q = new URLSearchParams({activity:'deferred'}); if (state.search) q.set('search',state.search); if(state.selectedId)q.set('selectedId',state.selectedId);
  if (append && state.threadCursor) q.set('cursor',state.threadCursor);
  try {
    if(state.sidebarArchived)q.set('archived','true');
    const d = await api('/api/sidebar?' + q); if (seq !== state.listVersion) return;
    if(state.sidebar?.accountScope===d.accountScope){const previous=new Map(state.threads.map(t=>[t.id,t.activity]));for(const t of d.data||[])if(!t.activity&&previous.has(t.id))t.activity=previous.get(t.id);}
    const accountChanged=state.sidebar&&state.sidebar.accountScope!==d.accountScope;
    if(accountChanged){createdThreads.clear();if(append){void loadThreads(false,false,true);return;}}
    d.activityPhase='loading';state.sidebar=d;state.projects=d.projects||[];if(d.selectedThread?.id===state.selectedId)state.selectedArchived=!!d.selectedThread.archived;
    state.threadListSource = d.historySource || null;
    for (const thread of d.data || []) createdThreads.delete(thread.id);
    const pending = state.sidebarArchived?[]:[...createdThreads.values()].filter(t => !state.search || threadName(t).includes(state.search));
    const all = append ? [...state.threads,...(d.data || [])] : [...pending,...(d.data || [])];
    const seen = new Set<string>(); state.threads = all.filter(t => !seen.has(t.id) && seen.add(t.id)); state.threadCursor = d.nextCursor || null;
    void loadSidebarActivity(d,seq);
  } catch (e) { if (seq === state.listVersion) { state.threadPageError = true; recordError(e,'threads'); toast(messageOf(e),true); } if (reportFailure) throw e; }
  finally { if (seq === state.listVersion) { state.loadingThreads = false; renderThreads(); renderControls(); if (!state.threadPageError) requestAnimationFrame(loadVisibleThreads); } }
}
async function loadSidebarActivity(snapshot:SidebarSnapshot,seq:number){
  const instance=state.status?.instanceId,connection=state.status?.connection?.connectedAt;
  const current=()=>seq===state.listVersion&&state.sidebar===snapshot&&connected()&&state.status?.instanceId===instance&&state.status?.connection?.connectedAt===connection;
  const ids=(snapshot.data||[]).map(t=>t.id);
  for(let offset=0;offset<ids.length&&current();offset+=200){
    try{
      const data=await api('/api/sidebar/activity?'+new URLSearchParams({ids:JSON.stringify(ids.slice(offset,offset+200))}));
      if(!current())return;
      if(data.accountScope!==snapshot.accountScope){snapshot.activityPhase='error';renderThreads();return;}
      const activity=new Map((data.data||[]).map(t=>[t.id,t]));
      for(const t of state.threads)if(activity.has(t.id)){const next=activity.get(t.id)!;if(next.activity)t.activity=next.activity;else delete t.activity;t.latestTurn=next.latestTurn;}
      if(offset+200<ids.length)renderThreads();
    }catch(error){if(current()){snapshot.activityPhase='error';recordError(error,'sidebar-activity');renderThreads();}return;}
  }
  if(current()){snapshot.activityPhase='ready';renderThreads();}
}
function loadVisibleThreads() {
  const list = $('project-list');
  if (list.clientHeight > 0 && list.scrollHeight - list.scrollTop - list.clientHeight < 120) loadThreads(true);
}
return {readThreads,loadSidebarActivity,loadVisibleThreads};
}
