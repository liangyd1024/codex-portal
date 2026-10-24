import {memo} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import type {AutomationListOptions,AutomationDialogOptions,AutomationViewsRenderer,TaskRow} from '../services/automation-view';
interface ListInstance extends AutomationListOptions {id:number;store:StoreApi<{rows:TaskRow[]|null;revision:number}>}
interface DialogInstance extends AutomationDialogOptions {id:number}
const registry=createStore<{lists:ListInstance[];dialogs:DialogInstance[]}>(()=>({lists:[],dialogs:[]}));let sequence=0;
const TaskList=memo(function TaskList({list,showTask,store}:ListInstance){
 const {rows,revision}=useStore(store);
 return createPortal(rows===null?null:rows.length?rows.map(({task,meta})=><article className="automation-row" data-id={task.id} key={revision+':'+task.id}><button type="button" className="automation-name" onClick={()=>showTask(task)}>{task.name}</button><p className="subtle">{meta}</p><details className="automation-actions" onToggle={e=>{const actions=e.currentTarget;if(actions.open)for(const other of list.querySelectorAll<HTMLDetailsElement>('details[open]'))if(other!==actions)other.open=false;}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.currentTarget.open=false;e.currentTarget.querySelector('summary')!.focus();}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}}><summary className="" aria-label={task.name+'的操作'}>⋯</summary><div className="automation-menu"><button type="button" className="text-button" onClick={e=>{e.currentTarget.closest('details')!.open=false;showTask(task,'edit');}}>编辑</button><button type="button" className="text-button danger" onClick={e=>{e.currentTarget.closest('details')!.open=false;showTask(task,'delete');}}>删除</button></div></details></article>):<p className="subtle" key={revision}>没有匹配的定时任务。</p>,list);
});
const TaskDialog=memo(function TaskDialog({dialog,view:v,edit,manage,openThread}:DialogInstance){return createPortal(<><div className="automation-task-heading"><h2 className="">{v.name}</h2><button type="button" className="icon-button" aria-label="关闭任务详情" onClick={()=>dialog.close()}>×</button></div><div className="automation-task-content"><p className="subtle">{v.status}</p>{v.mode==='view'?<button type="button" className="secondary-button" onClick={edit}>编辑任务</button>:<><h3 className="">{v.heading}</h3><p className="subtle">{v.explanation}</p><button type="button" className="secondary-button" onClick={manage}>{v.manageLabel}</button></>}<h3 className="">任务内容</h3><p className="automation-prompt">{v.prompt}</p><h3 className="">运行记录</h3>{v.targetThreadId?<button type="button" className="text-button" onClick={()=>openThread(v.targetThreadId!)}>打开执行会话</button>:null}{v.lastRun?<p className="subtle">{v.lastRun}</p>:null}{!v.runs.length?<p className="subtle">{v.emptyRuns}</p>:v.runs.map((run,i)=><button type="button" className="text-button" key={i} onClick={()=>openThread(run.threadId)}>{run.label}</button>)}</div></>,dialog);});
export function AutomationViews(){const {lists,dialogs}=useStore(registry);return <>{lists.map(instance=><TaskList key={instance.id} {...instance}/>)}{dialogs.map(instance=><TaskDialog key={instance.id} {...instance}/>)}</>;}
export const reactAutomationViews:AutomationViewsRenderer={
 list(options:AutomationListOptions){const store=createStore<{rows:TaskRow[]|null;revision:number}>(()=>({rows:null,revision:0}));const instance={...options,id:++sequence,store};flushSync(()=>registry.setState({lists:[...registry.getState().lists,instance]}));return {render(rows:TaskRow[]|null){
   const previous=store.getState().rows;
   const same=previous&&rows&&previous.length===rows.length&&previous.every((row,index)=>row.task===rows[index]!.task&&row.meta===rows[index]!.meta);
   if(same){
    const list=options.list,selection=list.ownerDocument.getSelection();
    // Keep baseline resets when rebuilding would clear focus, hover, menus or selection.
    const active=list.contains(list.ownerDocument.activeElement)||list.matches(':hover')||list.querySelector('details[open]')||(selection&&!selection.isCollapsed&&selection.rangeCount>0&&selection.getRangeAt(0).intersectsNode(list));
    if(!active)return;
   }
   flushSync(()=>store.setState(s=>({rows,revision:s.revision+1})));
  }};},
 task(options:AutomationDialogOptions){const instance={...options,id:++sequence};flushSync(()=>registry.setState({dialogs:[...registry.getState().dialogs,instance]}));return {closeButton:options.dialog.querySelector<HTMLButtonElement>('[aria-label="关闭任务详情"]')!,dispose(){flushSync(()=>registry.setState({dialogs:registry.getState().dialogs.filter(view=>view!==instance)}));}};}
};
