import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Running {active:boolean;disabled:boolean;hidden:boolean;count:number;pending:boolean;uncertain:boolean;search:boolean}
interface View {running:Running;archived:boolean|undefined;pressed:string|undefined;hidden:boolean;label:string}
interface Options {before:HTMLElement;onRunning:()=>void;onRetry:()=>void;onArchive:()=>void;onMore:(button:HTMLButtonElement)=>void}
interface Instance extends Options {id:number;store:StoreApi<View>;node:HTMLDivElement|null}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
// Only installation requires an immediate DOM handle; view updates can batch.
function publish(instance:Instance,patch:Partial<View>){const old=instance.store.getState();if(Object.entries(patch).every(([key,value])=>Object.is(old[key as keyof View],value)))return;instance.store.setState(patch);}
function Toolbar({instance}:{instance:Instance}){
 const view=useStore(instance.store),ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{instance.node=ref.current!;instance.before.before(instance.node);return()=>{instance.node=null;};},[instance]);
 const r=view.running,label='运行中 · '+(r.pending||r.uncertain?r.count?r.count+'+':'…':r.count);
 return createPortal(<div className="sidebar-tools" ref={ref}>
  <button type="button" className="sidebar-running-filter" hidden={r.hidden} aria-pressed={r.active} aria-controls="thread-list" disabled={r.disabled} title={(r.search?'当前搜索范围内':'当前连接中')+'正在执行或需要你回答的会话'} onClick={instance.onRunning}>{label}</button>
  <button type="button" className="sidebar-view" aria-pressed={view.pressed as 'true'|'false'|undefined} onClick={instance.onArchive}>{view.archived?'返回会话':'已归档'}</button>
  <button type="button" className="icon-button" aria-label="侧边栏设置" onClick={e=>instance.onMore(e.currentTarget)}>⋯</button>
  <span className="sidebar-progress" role="status" hidden={view.hidden}>{view.label}</span>
  {r.active&&(r.pending||r.uncertain)&&<div className="sidebar-running-notice"><span role="status">{r.pending?'正在确认运行状态…':r.count?'已确认 '+r.count+' 个，部分状态待确认':'运行状态待确认'}</span>{r.uncertain&&!r.pending&&<button type="button" onClick={instance.onRetry}>重试</button>}</div>}
 </div>,instance.before.parentElement!);
}
export function SidebarToolbars(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Toolbar key={instance.id} instance={instance}/>)}</>;}
export function installReactSidebarToolbar(options:Options){
 const instance:Instance={...options,id:++sequence,store:createStore<View>(()=>({running:{active:false,disabled:true,hidden:false,count:0,pending:true,uncertain:false,search:false},archived:undefined,pressed:undefined,hidden:true,label:'正在更新…'})),node:null};
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));
 return {node:instance.node!,setRunning(running:Running){if(JSON.stringify(instance.store.getState().running)!==JSON.stringify(running))publish(instance,{running});},setArchived(archived:boolean|undefined){publish(instance,{archived,pressed:String(archived)});},progress:{get textContent(){return instance.store.getState().label;},set textContent(label:string){publish(instance,{label});},get hidden(){return instance.store.getState().hidden;},set hidden(hidden:boolean){publish(instance,{hidden});}}};
}
