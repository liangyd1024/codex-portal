import {flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import {CapacityRetry,type CapacityView,type InstallOptions} from '../services/capacity-retry';
interface View {hidden:boolean;status:string;retryDisabled:boolean;cancelHidden:boolean;reloadHidden:boolean;reloadDisabled:boolean;reloadLabel:string}
interface Instance {store:StoreApi<View>;controller:CapacityRetry;reload:()=>Promise<void>}
const registry=createStore<{instance:Instance|null}>(()=>({instance:null}));
export function CapacityRetryPanel(){
 const instance=useStore(registry,state=>state.instance);
 return instance?<Panel instance={instance}/>:null;
}
function Panel({instance}:{instance:Instance}){
 const view=useStore(instance.store);
 return <div className="capacity-retry" hidden={view.hidden}><span role="status">{view.status}</span><button type="button" className="secondary-button" disabled={view.retryDisabled} onClick={()=>void instance.controller.retry()}>立即重试</button><button type="button" className="text-button" hidden={view.cancelHidden} onClick={()=>instance.controller.cancel()}>取消自动重试</button><button type="button" className="text-button" hidden={view.reloadHidden} disabled={view.reloadDisabled} onClick={()=>void instance.reload()}>{view.reloadLabel}</button></div>;
}
export function installReactCapacityRetry({context,send,refresh,storage}:InstallOptions){
 const store=createStore<View>(()=>({hidden:true,status:'',retryDisabled:false,cancelHidden:false,reloadHidden:false,reloadDisabled:false,reloadLabel:'刷新状态'}));
 let refreshing=false;
 const changed=(v:CapacityView|null)=>{
  if(!v){flushSync(()=>store.setState({hidden:true}));return;}
  const phase=v.entry.phase;
  let status=phase==='waiting'?`模型容量已满，${v.seconds} 秒后重试。`:phase==='blocked'?'正在确认会话状态…':phase==='sending'?'正在重试…':phase==='sent'?'已提交重试，正在同步…':phase==='uncertain'?'重试结果未确认，请刷新会话核对。':v.entry.error||'自动重试已暂停，可稍后重试或选择其他模型。';
  if(!v.ready&&!['sending','sent','uncertain'].includes(phase))status=context().unavailableReason||'正在确认会话状态，暂不能重试。';
  flushSync(()=>store.setState({hidden:false,status,retryDisabled:refreshing||!v.ready||['sending','sent','uncertain'].includes(phase),cancelHidden:phase!=='waiting',reloadHidden:!refresh||!['blocked','paused','uncertain'].includes(phase),reloadDisabled:refreshing,reloadLabel:refreshing?'正在刷新…':'刷新状态'}));
 };
 const controller=new CapacityRetry({context,send,storage,changed});
 const reload=async()=>{
  if(refreshing)return;refreshing=true;const key=controller.sync()?.key;controller.tick();
  try{await refresh!();const v=controller.sync();if(v?.key===key&&v&&v.ready&&['RETRY_THREAD_BUSY','RETRY_STATE_UNKNOWN','RETRY_STATE_CHANGED'].includes(v.entry.errorCode!)){delete v.entry.error;delete v.entry.errorCode;controller.save(v.key,v.entry);}}
  catch{const v=controller.sync();if(v&&v.key===key){v.entry.error='状态刷新失败，请检查连接后重试。';controller.save(v.key,v.entry);}}
  finally{refreshing=false;controller.tick();}
 };
 flushSync(()=>registry.setState({instance:{store,controller,reload}}));
 let timer:ReturnType<typeof setInterval>|null=setInterval(()=>controller.tick(),1000);
 window.addEventListener('pagehide',()=>{if(timer!==null)clearInterval(timer);timer=null;});
 window.addEventListener('pageshow',()=>{if(timer===null)timer=setInterval(()=>controller.tick(),1000);controller.tick();});
 return controller;
}
