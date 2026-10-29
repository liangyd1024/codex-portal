import {summarizeTitle} from '../../../lib/thread-title.mjs';
interface Thread {id: string; cwd?: string; name?: string; [key: string]: unknown}
interface Detail {id?: string; thread?: Thread; controlled?:boolean;controlState?:string;creationReady?:boolean;creationError?:string; [key: string]: unknown}
interface Draft {cwd: string; phase: string; begin: () => void; failed: (error: unknown) => void; complete: () => void}
interface State {
 busy: Set<string>; model: string; effort: string; drafts: Map<string,string>;
 threads: Thread[]; projects: {id: string; roots?: string[]}[];
 desktopMode: boolean; sidebarArchived: boolean; selectedArchived: boolean;
 selectedId: string | null; selectionVersion: number; loadingDetail: boolean;
 projectId: string | null; search: string; historyCursor: string | null; loadedOlderHistory: boolean; historyError: string;
}
interface Dependencies {
 state: State; draft: Draft; draftId: string; access: string; createdThreads: Map<string,Thread>;
 input: () => Pick<HTMLTextAreaElement,'value'>;
 hasAttachments: () => boolean;
 attachmentsPending: () => boolean;
 validate: (text: string, active: boolean) => void;
 toast: (message: string, error: boolean) => void;
 hideError: () => void;
 showError: (error: unknown) => void;
 recordError: (error: unknown, stage: string) => void;
 action: (key: string, run: () => Promise<void>) => Promise<unknown>;
 preferDesktop?:()=>boolean;
 post: (body: {cwd: string; model: string; effort: string; access: string;preferDesktop?:boolean;name?:string}) => Promise<Detail>;
 moveAttachments: (from: string, to: string) => void;
 moveComposer: (from: string, to: string) => void;
 close: (restore: boolean) => void;
 expandProject: (id: string) => void;
 clearSearch: () => void;
 saveView: () => void;
 applyDetail: (detail: Detail & {thread: Thread; controlled: boolean}, resetModels: boolean) => void;
 renderThreads: () => void;
 send: () => Promise<unknown>;
 loadThreads: () => Promise<unknown>;
 loadStatus: () => Promise<unknown>;
}
export function createThreadFromDraft(d: Dependencies) {
 const {state,draft} = d;
 return async function createThread() {
  if(state.busy.has('create') || draft.phase!=='editing')return;
  const cwd=draft.cwd,model=state.model,effort=state.effort,text=d.input().value;
  if(!cwd || (!text.trim()&&!d.hasAttachments()) || d.attachmentsPending())return;
  try{d.validate(text,false);}catch(error){d.toast((error as Error).message,true);return;}
  state.drafts.set(d.draftId,text);d.hideError();
  let created=false,ready=false;
  await d.action('create',async()=>{
   try{
    draft.begin();
    const preferDesktop=d.preferDesktop?.();
    const detail=await d.post({cwd,model,effort,access:d.access,...(preferDesktop?{preferDesktop:true,name:summarizeTitle(text,{hasImages:d.hasAttachments()})}:{})});
    const id=detail.thread?.id||detail.id;if(!id)throw Error('未返回会话 ID，请刷新侧栏核对创建结果。');
    const thread={...detail.thread,id,cwd,name:detail.thread?.name||'新会话'};
    d.createdThreads.set(id,thread);state.threads.unshift(thread);
    d.moveAttachments(d.draftId,id);d.moveComposer(d.draftId,id);
    d.close(false);state.desktopMode=detail.controlState==='desktop';state.drafts.set(id,text);state.drafts.delete(d.draftId);
    state.sidebarArchived=false;state.selectedArchived=false;state.selectedId=id;state.selectionVersion++;
    state.model=model;state.effort=effort;state.loadingDetail=false;
    const project=state.projects.find(p=>p.roots?.includes(cwd));state.projectId=project?.id||null;if(project)d.expandProject(project.id);
    state.search='';d.clearSearch();state.historyCursor=null;state.loadedOlderHistory=false;state.historyError='';
    d.saveView();d.input().value=text;d.applyDetail({...detail,thread,controlled:detail.controlled!==false},true);d.renderThreads();
    draft.complete();created=true;ready=detail.creationReady!==false;
    if(detail.creationError)d.toast(detail.creationError,true);
   }catch(error){draft.failed(error);d.showError(error);d.recordError(error,'create');}
  });
  if(created){if(ready)await d.send();void Promise.allSettled([d.loadThreads(),d.loadStatus()]);}
 };
}
