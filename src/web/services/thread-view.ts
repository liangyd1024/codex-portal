export interface ViewState {transport:boolean;desktopMode:boolean;selectedId:string|null;detailVersion:number;status:{instanceId?:unknown;connection?:{connectedAt?:unknown};[key:string]:unknown}|null}
interface Context {state:ViewState;newChatOpen:boolean;automations?:{opened?:boolean}|null;sideChat?:{visibleId?:string|null}|null}
interface Dependencies {viewId:string;host:string;context:()=>Context;request:(path:string,options:{method:string;body:{viewId:string;threadId:string|null;sideThreadId:string|null;revision:number}})=>Promise<unknown>;refresh:()=>void}
export function createThreadViewReporter({viewId:threadViewId,host:targetHost,context,request:api,refresh:scheduleDetailRefresh}:Dependencies){
 let threadViewRevision=0,threadViewReport:{key:string;promise?:Promise<unknown>}|null=null;
 function reportThreadView(){
  const {state,newChatOpen,automations,sideChat}=context();
  if(!state.transport)return Promise.resolve();
  const threadId=newChatOpen||state.desktopMode||automations?.opened?null:state.selectedId||null;
  const sideThreadId=sideChat?.visibleId||null;
  const key=JSON.stringify([targetHost,threadId,sideThreadId,state.status?.instanceId,state.status?.connection?.connectedAt]);
  if(threadViewReport?.key===key)return threadViewReport.promise!;
  const report:{key:string;promise?:Promise<unknown>}={key},version=state.detailVersion;threadViewReport=report;
  report.promise=api('/api/thread-view',{method:'POST',body:{viewId:threadViewId,threadId,sideThreadId,revision:++threadViewRevision}}).then(result=>{
    if(threadViewReport===report&&threadId&&state.detailVersion!==version)scheduleDetailRefresh();
    return result;
  }).catch(error=>{if(threadViewReport===report)threadViewReport=null;throw error;});
  return report.promise;
 }
 return {report:reportThreadView,reset:()=>{threadViewReport=null;}};
}
