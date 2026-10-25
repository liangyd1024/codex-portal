import {createWorkspaceState} from './state';
import type {NativeRecord,WorkspaceIdentity} from '../contracts/view';

/** Controller-owned coordination only. Native records remain open and lossless. */
export interface ControllerState<Drafts extends Map<string,string>> extends WorkspaceIdentity {
 status:NativeRecord|null;models:NativeRecord[];projects:NativeRecord[];threads:NativeRecord[];detail:NativeRecord|null;
 sidebar:NativeRecord|null;sidebarArchived:boolean;selectedArchived:boolean;projectId:string|null;search:string;
 threadCursor:string|null;historyCursor:string|null;loadedOlderHistory:boolean;
 model:string;effort:string;csrf:string;busy:Set<string>;loadingThreads:boolean;loadingModels:boolean;loadingProjects:boolean;threadListSource:unknown;
 runtimeNotices:Map<string,Map<string,NativeRecord>>;loadingDetail:boolean;
 errors:{message:string;stage:string;time:number}[];localRequests:NativeRecord[];drafts:Drafts;selectionVersion:number;
 listVersion:number;detailVersion:number;threadPageError:boolean;historyError:string;eventSource:EventSource|null;
 lastSync:Date|null;refreshScope:string;refreshMessage:string;refreshing:boolean;streamRender:boolean;requestSignature:string;
}
export function createControllerState<Drafts extends Map<string,string>>(
 initial:Pick<ControllerState<Drafts>,'desktopMode'|'selectedId'|'projectId'|'drafts'>,
):ControllerState<Drafts>{
 return createWorkspaceState<ControllerState<Drafts>>({
  desktopMode:initial.desktopMode,status:null,models:[],projects:[],threads:[],selectedId:initial.selectedId,detail:null,
  sidebar:null,sidebarArchived:false,selectedArchived:false,projectId:initial.projectId,search:'',threadCursor:null,historyCursor:null,loadedOlderHistory:false,
  model:'',effort:'',csrf:'',transport:false,busy:new Set(),loadingThreads:false,loadingModels:false,loadingProjects:false,threadListSource:null,
  runtimeNotices:new Map(),loadingDetail:false,errors:[],localRequests:[],drafts:initial.drafts,selectionVersion:0,
  listVersion:0,detailVersion:0,threadPageError:false,historyError:'',eventSource:null,lastSync:null,refreshScope:'',refreshMessage:'',refreshing:false,streamRender:false,requestSignature:'',
 });
}
