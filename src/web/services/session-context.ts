type Status = string | {type?:string;[field:string]:unknown} | null | undefined;
interface Turn {status?:Status;[field:string]:unknown}
interface Session {status?:Status;pendingRequests?:unknown;lastTurnStatus?:string;turns?:Turn[];historySource?:string;[field:string]:unknown}
interface Handoff {threadId?:string;[field:string]:unknown}
interface State {
 detail?:{thread?:Session;turns?:Turn[];controlled?:unknown;recovering?:unknown;historySource?:string;handoff?:Handoff|null;[field:string]:unknown}|null;
 status?:{connection?:{state?:string};service?:{releasing?:unknown;protocolValidation?:{features?:Record<string,{supported?:boolean}>}};controlledThreads?:string[];handoffs?:Handoff[]|null;[field:string]:unknown}|null;
 selectedId?:string|null;transport:boolean;desktopMode:boolean;busy:Set<string>;
}
export function createSessionContext({state,statusNames}:{state:State;statusNames:Record<string,string>}){
function typeOf(value:Status) { return typeof value === 'string' ? value : value?.type || ''; }
function currentThread() { return state.detail?.thread; }
function turns() { return state.detail?.turns || currentThread()?.turns || []; }
function connected() { return ['connected','ready'].includes(state.status?.connection?.state!); }
function connectionPending() {return ['connecting','reconnecting'].includes(state.status?.connection?.state!);}
function featureReady(name:string) {return state.status?.service?.protocolValidation?.features?.[name]?.supported!==false;}
function sessionLabel(session:Session|null|undefined) {
  if(!usable()||!session||typeOf(session.status)==='unknown')return '状态未确认';
  if(session.pendingRequests)return '待处理';
  if(typeOf(session.status)==='active')return '执行中';
  if(session.lastTurnStatus==='failed')return '失败';
  if(session.lastTurnStatus==='completed')return '已完成';
  if(session.lastTurnStatus==='interrupted')return '已停止';
  return statusNames[typeOf(session.status)]||'状态未确认';
}
function usable() { return connected() && state.transport && !state.status?.service?.releasing; }
function controlled() {
  if (!state.detail || !state.selectedId || state.detail.recovering) return false;
  if(state.busy.has('handoff:'+state.selectedId)||currentHandoff())return false;
  return Boolean(state.detail.controlled || state.status?.controlledThreads?.includes(state.selectedId));
}
function currentHandoff() {
  if(Array.isArray(state.status?.handoffs))return state.status.handoffs.find(v=>v.threadId===state.selectedId)||null;
  return state.detail?.handoff||null;
}
function snapshotHistory() { return state.detail?.historySource === 'snapshot' || currentThread()?.historySource === 'snapshot'; }
function uncertainHistory() { return snapshotHistory() && !controlled() && !state.desktopMode; }
function running() {
  if(state.desktopMode)return typeOf(currentThread()?.status)==='active';
  if (uncertainHistory()) return false;
  return turns().some(t => ['inProgress','in_progress','running'].includes(typeOf(t.status))) || typeOf(currentThread()?.status) === 'active';
}
return {typeOf,currentThread,turns,connected,connectionPending,featureReady,sessionLabel,usable,controlled,currentHandoff,snapshotHistory,uncertainHistory,running};
}
