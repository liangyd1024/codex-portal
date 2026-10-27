export interface SelectionDetail {goalError?:unknown;goal?:unknown;thread?:{id?:string;turns?:unknown[];[field:string]:unknown};turns?:unknown[];nextCursor?:string|null;historyCursor?:string|null;recovering?:boolean;[field:string]:unknown}
interface SelectionState {busy:Set<string>;desktopMode:boolean;drafts:{set:(id:string,value:string)=>unknown;get:(id:string)=>string|undefined};selectionVersion:number;selectedId:string|null;detail:SelectionDetail|null;historyCursor:string|null;loadedOlderHistory:boolean;loadingDetail:boolean;historyError:string}
interface Elements {'messages':HTMLElement;'message-input':HTMLTextAreaElement}
interface Dependencies {cancelNotification?:()=>void;state:SelectionState;location:Pick<Location,'href'>;history:Pick<History,'replaceState'>;document:Pick<Document,'querySelector'>;closeNewChat:()=>void;automations:()=>{close:()=>void;threadId?:string|null}|null|undefined;toggleInspector:(open:boolean)=>void;element:<K extends keyof Elements>(id:K)=>Elements[K];inputId:()=>string|null;saveView:()=>void;resizeInput:()=>void;renderModels:(preferThread:boolean)=>void;renderThread:()=>void;renderThreads:()=>void;renderRequests:()=>void;saveDetailSoon:()=>void;compactLayout:()=>boolean;toggleSidebar:(open:boolean,remember:boolean)=>void;refreshSelected:()=>Promise<void>;scrollFollow:()=>{schedule:()=>void}|null|undefined;messageOf:(error:unknown)=>string;recordError:(error:unknown,stage:string)=>void}
export function createThreadSelection({cancelNotification,state,location,history,document,closeNewChat,automations,toggleInspector,element:$,inputId,saveView,resizeInput,renderModels,renderThread,renderThreads,renderRequests,saveDetailSoon,compactLayout,toggleSidebar,refreshSelected,scrollFollow,messageOf,recordError}:Dependencies){
function applyDetail(data:SelectionDetail, resetModels = false) {
  if(data.goalError&&state.detail?.thread?.id===data.thread?.id)data.goal=state.detail!.goal;
  const desktopMode=data.controlled===true?false:data.controlState==='desktop'&&data.desktop?true:state.desktopMode;
  if(!data.recovering&&state.desktopMode!==desktopMode){
    state.desktopMode=desktopMode;
    document.querySelector<HTMLElement>('.main-panel')!.classList.toggle('desktop-chat',desktopMode);
    saveView();
  }
  state.detail = {...data, turns:data.turns || data.thread?.turns || []};
  state.historyCursor = data.nextCursor || data.historyCursor || null; state.historyError = '';
  if (resetModels||state.desktopMode) renderModels(true); renderThread(); renderRequests(); if(!data.recovering)saveDetailSoon();
}
async function selectThread(id:string,options:{desktop?:boolean;notification?:boolean}={}) {
  if(state.busy.has('create'))return;
  if(!options.notification)cancelNotification?.();
  const url=new URL(location.href);url.searchParams.delete('thread');history.replaceState(null,'',url);
  closeNewChat();
  automations()?.close();state.desktopMode=Boolean(options.desktop||id===automations()?.threadId);
  document.querySelector<HTMLElement>('.main-panel')!.classList.toggle('desktop-chat',state.desktopMode);
  toggleInspector(false);
  $('messages').style.paddingBottom = '';
  if (inputId()) state.drafts.set(inputId()!,$('message-input').value);
  const seq = ++state.selectionVersion; state.selectedId = id; state.detail = null; state.historyCursor = null; state.loadedOlderHistory = false; state.loadingDetail = true; state.historyError = ''; saveView();
  $('message-input').value = state.drafts.get(id) || ''; resizeInput(); renderThread(); renderThreads(); if (compactLayout()) toggleSidebar(false, false);
  try { await refreshSelected(); if (seq !== state.selectionVersion) return; scrollFollow()?.schedule(); }
  catch (e) { if (seq !== state.selectionVersion) return; state.loadingDetail = false; state.historyError = messageOf(e); recordError(e,'thread'); renderThread(); }
}
return {applyDetail,selectThread};
}
