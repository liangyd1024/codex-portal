import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Thread {id:string;[key:string]:unknown}
interface Snapshot {accountScope:string;data:Thread[];nextCursor?:string|null}
interface Options {anchor:HTMLElement;api:(path:string)=>Promise<Snapshot>;restore:(thread:Thread)=>Promise<unknown>;focus:()=>void;error:(message:string)=>void}
interface View {id:string;scope:string;serial:number;pending:boolean}
interface Instance extends Options {key:number;store:StoreApi<{view:View|null}>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function hide(instance:Instance,serial?:number){const view=instance.store.getState().view;if(!view||serial!==undefined&&serial!==view.serial)return;flushSync(()=>instance.store.setState({view:null}));}
async function restore(instance:Instance,view:View){
 if(instance.store.getState().view?.pending)return;
 flushSync(()=>instance.store.setState({view:{...view,pending:true}}));
 try{
  const first=await instance.api('/api/sidebar?archived=true&search=');
  if(first.accountScope!==view.scope)throw Error('目标账号已变化，请在已归档列表核对。');
  let thread=first.data.find(t=>t.id===view.id),cursor=first.nextCursor;
  while(!thread&&cursor){const page=await instance.api('/api/sidebar?archived=true&cursor='+encodeURIComponent(cursor));thread=page.data.find(t=>t.id===view.id);cursor=page.nextCursor;}
  if(!thread)throw Error('归档状态已变化，请刷新列表。');
  await instance.restore(thread);hide(instance,view.serial);instance.focus();
 }catch(error){instance.error((error as Error).message);const current=instance.store.getState().view;if(current?.serial===view.serial)flushSync(()=>instance.store.setState({view:{...current,pending:false}}));}
}
function Notice({instance,view}:{instance:Instance;view:View}){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{instance.anchor.after(ref.current!);},[instance,view.serial]);
 return createPortal(<div className="sidebar-undo" role="status" ref={ref}><span>会话已归档</span><button disabled={view.pending} onClick={()=>{void restore(instance,view);}}>撤销</button></div>,instance.anchor.parentElement!);
}
function Undo({instance}:{instance:Instance}){const view=useStore(instance.store).view;return view?<Notice key={view.serial} instance={instance} view={view}/>:null;}
export function SidebarUndos(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Undo key={instance.key} instance={instance}/>)}</>;}
export function installReactSidebarUndo(options:Options){
 const instance:Instance={...options,key:++sequence,store:createStore<{view:View|null}>(()=>({view:null}))};let serial=0;
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));
 return {show(id:string,scope:string){flushSync(()=>instance.store.setState({view:{id,scope,serial:++serial,pending:false}}));},hide(){hide(instance);}};
}
