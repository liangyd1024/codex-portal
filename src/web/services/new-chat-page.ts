interface Project {id:string;roots?:string[];name?:string;[field:string]:unknown}
interface Elements {'message-input':HTMLTextAreaElement;'conversation':HTMLElement;'new-chat-page':HTMLElement;'new-composer-slot':HTMLElement}
interface Dependencies {
 setNewChatVisible:(visible:boolean)=>void;
 state:{busy:Set<string>;drafts:{get:(id:string|null)=>string|undefined;set:(id:string,value:string)=>unknown};selectedId:string|null;desktopMode:boolean;selectionVersion:number;projects:Project[];projectId:string|null};
 newDraft:{cwd:string;save:()=>void};newDraftId:string;
 opened:{get:()=>boolean;set:(value:boolean)=>void};
 element:<K extends keyof Elements>(id:K)=>Elements[K];document:Pick<Document,'querySelector'>;
 toast:(message:string,error:boolean)=>void;renderThread:()=>void;resizeInput:()=>void;queueMicrotask:(run:()=>void)=>void;
 reportThreadView:()=>Promise<unknown>;recordError:(error:unknown,stage:string)=>void;
 currentThread:()=>{cwd?:string}|null|undefined;
 projectFolderOptions:(projects:Project[])=>{root:string;name:string}[];
 publishProjectPicker:(view:{options:{root:string;name:string}[];value:string})=>void;
 automations:()=>{close:()=>void}|null|undefined;flushDrafts:()=>void;
 installProjectPickerActions:(actions:{change:(value:string)=>void})=>void;
 renderControls:()=>void;publishNewChatControls:(view:{errorHidden:boolean})=>void;
 toggleInspector:(open:boolean)=>void;compactLayout:()=>boolean;toggleSidebar:(open:boolean,remember:boolean)=>void;
 renderModels:()=>void;mobileUI:()=>{syncDrawers:()=>void}|null|undefined;
}
export function createNewChatPage(d:Dependencies){
 const {state,newDraft,newDraftId,opened,element:$,document,toast,renderThread,resizeInput,queueMicrotask,reportThreadView,recordError,currentThread,projectFolderOptions,publishProjectPicker,automations,flushDrafts,installProjectPickerActions,renderControls,publishNewChatControls,toggleInspector,compactLayout,toggleSidebar,renderModels,mobileUI}=d;
function rememberNewDraft(){try{newDraft.save();}catch{toast('新会话草稿设置暂未保存，请保留当前页面。',true);}}
function closeNewChat(restore=true){
  if(!opened.get())return;
  state.drafts.set(newDraftId,$('message-input').value);opened.set(false);
  $('conversation').append(document.querySelector<HTMLElement>('.composer-region')!);
  d.setNewChatVisible(false);document.querySelector<HTMLElement>('.main-panel')!.classList.remove('new-chat-open');document.querySelector<HTMLElement>('.main-panel')!.classList.toggle('desktop-chat',restore&&state.desktopMode);
  if(restore){$('message-input').value=state.drafts.get(state.selectedId)||'';renderThread();resizeInput();queueMicrotask(()=>void reportThreadView().catch(e=>recordError(e,'thread')));}
}
function updateNewProjects(projectRoot?:unknown) {
  const preferred=(typeof projectRoot==='string'?projectRoot:null)||newDraft.cwd||state.projects.find(p=>p.id===state.projectId)?.roots?.[0]||currentThread()?.cwd;
  const options=projectFolderOptions(state.projects);
  const value=options.some(p=>p.root===preferred)?preferred!:(options[0]?.root||'');
  publishProjectPicker({options,value});newDraft.cwd=value;rememberNewDraft();
}
function openNewDialog(projectRoot?:unknown) {
  if(state.busy.has('create'))return;
  automations()?.close();document.querySelector<HTMLElement>('.main-panel')!.classList.remove('desktop-chat');
  flushDrafts();updateNewProjects(projectRoot);
  installProjectPickerActions({change:value=>{newDraft.cwd=value;rememberNewDraft();renderControls();}});
  state.selectionVersion++;opened.set(true);d.setNewChatVisible(true);document.querySelector<HTMLElement>('.main-panel')!.classList.add('new-chat-open');
  void reportThreadView().catch(e=>recordError(e,'thread'));
  $('new-composer-slot').append(document.querySelector<HTMLElement>('.composer-region')!);
  $('message-input').value=state.drafts.get(newDraftId)||'';
  publishNewChatControls({errorHidden:true});toggleInspector(false);if(compactLayout())toggleSidebar(false,false);
  renderModels();renderControls();resizeInput();mobileUI()?.syncDrawers();$('message-input').focus();
}
return {rememberNewDraft,closeNewChat,updateNewProjects,openNewDialog};
}
