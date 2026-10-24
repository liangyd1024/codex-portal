import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface View {archived:boolean|undefined;pressed:string|undefined;hidden:boolean;label:string}
interface Options {before:HTMLElement;onArchive:()=>void;onMore:(button:HTMLButtonElement)=>void}
interface Instance extends Options {id:number;store:StoreApi<View>;node:HTMLDivElement|null}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
// Only installation requires an immediate DOM handle; view updates can batch.
function publish(instance:Instance,patch:Partial<View>){const old=instance.store.getState();if(Object.entries(patch).every(([key,value])=>Object.is(old[key as keyof View],value)))return;instance.store.setState(patch);}
function Toolbar({instance}:{instance:Instance}){
 const view=useStore(instance.store),ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{instance.node=ref.current!;instance.before.before(instance.node);return()=>{instance.node=null;};},[instance]);
 return createPortal(<div className="sidebar-tools" ref={ref}><button type="button" className="sidebar-view" aria-pressed={view.pressed as 'true'|'false'|undefined} disabled={false} onClick={instance.onArchive}>{view.archived?'返回会话':'已归档'}</button><span className="sidebar-progress" role="status" hidden={view.hidden}>{view.label}</span><button type="button" className="icon-button" aria-label="侧边栏设置" disabled={false} onClick={e=>instance.onMore(e.currentTarget)}>⋯</button></div>,instance.before.parentElement!);
}
export function SidebarToolbars(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Toolbar key={instance.id} instance={instance}/>)}</>;}
export function installReactSidebarToolbar(options:Options){
 const instance:Instance={...options,id:++sequence,store:createStore<View>(()=>({archived:undefined,pressed:undefined,hidden:true,label:'正在更新…'})),node:null};
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));
 return {node:instance.node!,setArchived(archived:boolean|undefined){publish(instance,{archived,pressed:String(archived)});},progress:{get textContent(){return instance.store.getState().label;},set textContent(label:string){publish(instance,{label});},get hidden(){return instance.store.getState().hidden;},set hidden(hidden:boolean){publish(instance,{hidden});}}};
}
