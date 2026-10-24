import {Fragment} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createStore, useStore, type StoreApi} from 'zustand';

interface QueuePart {type:string;text?:string;[key:string]:unknown}
interface QueueItem {id:string;input?:QueuePart[];[key:string]:unknown}
interface QueueContext {
 host:string;id:string|null;queue?:{data?:QueueItem[]};
 visible:boolean;ready:boolean;running:boolean;supported:boolean;
}
interface QueueOptions {
 host:HTMLElement;context:()=>QueueContext;
 api:(path:string,options:{method:'POST';body:{queuedSubmissionId:string}})=>Promise<unknown>;
 refresh:()=>Promise<unknown>;onError:(error:unknown)=>void;
}
type QueueAction='steer'|'delete';
interface QueueView {signature:string;items:QueueItem[];context:QueueContext;busy:Set<string>}
const contextKey=(context:QueueContext)=>JSON.stringify([context.host,context.id]);
function QueueRows({store,act}:{store:StoreApi<QueueView>;act:(item:QueueItem,action:QueueAction)=>Promise<void>}) {
 const view=useStore(store),c=view.context;
 // The baseline replaces rows on each changed signature, including focus behavior.
 return <Fragment key={view.signature}>{view.items.map((item,index)=>{
  const text=(item.input||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n')||'图片或引用消息';
  const imageCount=(item.input||[]).filter(part=>['image','localImage'].includes(part.type)).length;
  const disabled=!c.ready||!c.supported||view.busy.has(contextKey(c)+':'+item.id);
  return <div className="composer-queue-row" key={index}>
   <span className="subtle">↳</span>
   <div className="composer-queue-text">{text}{imageCount>0&&<span className="subtle">{' · '+imageCount+' 张图片'}</span>}</div>
   <button className="text-button" type="button" disabled={disabled} onClick={()=>void act(item,'steer')}>{c.running?'引导':'立即发送'}</button>
   <button className="icon-button" type="button" aria-label="删除排队消息" disabled={disabled} onClick={()=>void act(item,'delete')}>×</button>
  </div>;
 })}</Fragment>;
}
export function installQueuedInputs({host,context,api,refresh,onError}:QueueOptions) {
 const list=document.createElement('div');list.className='composer-queue';list.setAttribute('aria-label','排队消息');list.hidden=true;host.prepend(list);
 const store=createStore<QueueView>(()=>({signature:'',items:[],context:context(),busy:new Set()}));
 const root=createRoot(list);
 let mounted=false,signature='',serial=0;const busy=new Set<string>(),versions=new WeakMap<QueueItem,number>();
 const version=(item:QueueItem)=>{if(!versions.has(item))versions.set(item,++serial);return versions.get(item);};
 async function act(item:QueueItem,action:QueueAction){
  const c=context(),key=contextKey(c)+':'+item.id;if(busy.has(key))return;busy.add(key);render();
  try{await api('/api/threads/'+encodeURIComponent(String(c.id))+'/queue-'+action,{method:'POST',body:{queuedSubmissionId:item.id}});}
  catch(error){onError(error);}
  finally{busy.delete(key);if(contextKey(context())===contextKey(c)){await refresh().catch(onError);signature='';render();}}
 }
 function render(){
  const c=context(),items=c.visible?(c.queue?.data||[]):[];
  const next=JSON.stringify([contextKey(c),items.map(version),c.ready,c.running,c.supported,[...busy]]);
  if(next===signature)return;signature=next;list.hidden=!items.length;
  flushSync(()=>{store.setState({signature:next,items,context:c,busy:new Set(busy)});if(!mounted){root.render(<QueueRows store={store} act={act}/>);mounted=true;}});
 }
 return {render};
}
