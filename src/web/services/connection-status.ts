import {selectConnectionStatus} from '../../../public/connection-state.js';
export interface ConnectionStatus {instanceId?:string;connection?:{state?:string;connectedAt?:string;[key:string]:unknown};controlledThreads?:string[];handoffs?:{threadId?:string;[key:string]:unknown}[];[key:string]:unknown}
interface Thread {activity?:unknown;status?:unknown;[key:string]:unknown}
export interface StatusState {status:ConnectionStatus|null;selectedId:string|null;listVersion:number;loadingThreads:boolean;threads:Thread[];detailVersion:number;csrf:string;localRequests:unknown[];detail:({thread?:Thread;backgroundTerminals?:unknown;controlled?:boolean;controlState?:string;pendingRequests?:unknown[];[key:string]:unknown})|null}
export function applyControllerStatus(state:StatusState,status:ConnectionStatus,retiredStatusInstances:Set<string>){
  const next=selectConnectionStatus(state.status,status,retiredStatusInstances) as ConnectionStatus;
  const previous=state.status;
  const connectionChanged=previous&&(previous.instanceId!==next.instanceId||previous.connection?.state!==next.connection?.state||previous.connection?.connectedAt!==next.connection?.connectedAt);
  if(connectionChanged){
    state.listVersion++;state.loadingThreads=false;
    for(const thread of state.threads||[]){delete thread.activity;thread.status={type:'unknown'};}
    if(state.detail){
      state.detail.backgroundTerminals={error:'连接已变化，正在重新核对后台命令。'};
      if(state.detail.thread){delete state.detail.thread.activity;state.detail.thread.status={type:'unknown'};}
    }
  }
  if(previous&&(connectionChanged||
    previous.controlledThreads?.includes(state.selectedId!)!==next.controlledThreads?.includes(state.selectedId!)||
    Boolean(previous.handoffs?.some(h=>h.threadId===state.selectedId))!==Boolean(next.handoffs?.some(h=>h.threadId===state.selectedId))))state.detailVersion++;
  if(state.status?.instanceId&&next.instanceId!==state.status.instanceId){
    state.csrf='';state.localRequests=[];
    if(state.detail){state.detail.controlled=false;state.detail.controlState='viewing';state.detail.pendingRequests=[];}
  }
  state.status=next;
}
