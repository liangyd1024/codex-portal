import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Running {active:boolean;disabled:boolean;hidden:boolean;count:number;pending:boolean;uncertain:boolean;search:boolean}
interface Completed {active:boolean;count:number}
interface View {completed:Completed;running:Running;archived:boolean|undefined;hidden:boolean;label:string}
interface Options {before:HTMLElement;onAll:()=>void;onRunning:()=>void;onCompleted:()=>void;onArchive:()=>void;onMore:(button:HTMLButtonElement)=>void}
interface Instance extends Options {id:number;store:StoreApi<View>;node:HTMLDivElement|null}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
// Only installation requires an immediate DOM handle; view updates can batch.
function publish(instance:Instance,patch:Partial<View>){const old=instance.store.getState();if(Object.entries(patch).every(([key,value])=>Object.is(old[key as keyof View],value)))return;instance.store.setState(patch);}
function Toolbar({instance}:{instance:Instance}){
 const view=useStore(instance.store),ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{instance.node=ref.current!;instance.before.before(instance.node);return()=>{instance.node=null;};},[instance]);
 const r=view.running,c=view.completed,count=r.pending||r.uncertain?r.count?r.count+'+':'…':r.count;
 const compact=(n:number)=>n>99?'99+':n;
 return createPortal(<div className="sidebar-tools" ref={ref}>
  {view.archived?<div className="sidebar-archive-heading"><button type="button" className="sidebar-archive-back" aria-label="返回全部会话" onClick={instance.onArchive}><svg className="icon" aria-hidden="true"><use href="#i-chevron"/></svg></button><span>已归档</span></div>:<div className={'sidebar-view-switch'+(c.count?' has-completed':'')} role="group" aria-label="会话视图">
   <button type="button" className="sidebar-all-filter" aria-pressed={!r.active&&!c.active} aria-controls="thread-list" onClick={instance.onAll}>全部</button>
   <button type="button" className="sidebar-running-filter" aria-pressed={r.active} aria-controls="thread-list" disabled={r.disabled} title={(r.search?'当前搜索范围内':'当前连接中')+'正在执行或需要你回答的会话'} onClick={instance.onRunning} aria-label={'运行中 '+count}><span>运行中</span><span>{r.count>99?'99+':count}</span></button>
   {c.count>0&&<button type="button" className="sidebar-completed-filter" aria-pressed={c.active} aria-controls="thread-list" aria-label={'已完成 '+c.count} title={(r.search?'当前搜索范围内':'当前连接中')+'已完成、待查看的会话：'+c.count} onClick={instance.onCompleted}><span>已完成</span><span>{compact(c.count)}</span></button>}
  </div>}
  <button type="button" className="icon-button sidebar-more" aria-label="侧边栏更多操作" onClick={e=>instance.onMore(e.currentTarget)}>⋯</button>
  <span className="sidebar-progress" role="status" hidden={view.hidden}>{view.label}</span>
 </div>,instance.before.parentElement!);
}
export function SidebarToolbars(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Toolbar key={instance.id} instance={instance}/>)}</>;}
export function installReactSidebarToolbar(options:Options){
 const instance:Instance={...options,id:++sequence,store:createStore<View>(()=>({completed:{active:false,count:0},running:{active:false,disabled:true,hidden:false,count:0,pending:true,uncertain:false,search:false},archived:undefined,hidden:true,label:'正在更新…'})),node:null};
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));
 return {node:instance.node!,setCompleted(completed:Completed){const old=instance.store.getState().completed;if(old.active!==completed.active||old.count!==completed.count)publish(instance,{completed});},setRunning(running:Running){if(JSON.stringify(instance.store.getState().running)!==JSON.stringify(running))publish(instance,{running});},setArchived(archived:boolean|undefined){publish(instance,{archived});},progress:{get textContent(){return instance.store.getState().label;},set textContent(label:string){publish(instance,{label});},get hidden(){return instance.store.getState().hidden;},set hidden(hidden:boolean){publish(instance,{hidden});}}};
}
