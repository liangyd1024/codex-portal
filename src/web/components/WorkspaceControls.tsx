import {flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
type Id='new-thread'|'takeover'|'refresh-projects'|'refresh-all'|'thread-search'|'more-threads'|'composer-availability';
interface View {disabled?:boolean;hidden?:boolean;text?:string;title?:string;description?:string;reason?:{text:string;hidden:boolean}}
const store=createStore<Partial<Record<Id,View>>>(()=>({}));
const actions:Partial<Record<Id,(event:Event)=>unknown>>={};
export function setWorkspaceControlAction(id:Id,action:(event:Event)=>unknown){actions[id]=action;}
export function publishWorkspaceControl(id:Id,patch:View){const old=store.getState()[id]||{};if(Object.entries(patch).every(([key,value])=>key==='reason'?old.reason===value||(old.reason!==undefined&&patch.reason!==undefined&&old.reason.text===patch.reason.text&&old.reason.hidden===patch.reason.hidden):old[key as keyof View]===value))return;flushSync(()=>store.setState({[id]:{...old,...patch}}));}
// Materialize siblings before the mobile layout adapter relocates their buttons.
// Subsequent publications update these stable nodes without inserting into the old parent.
export function prepareWorkspaceControlReasons(){
 const current=store.getState();
 flushSync(()=>store.setState({
  'new-thread':{...current['new-thread'],reason:current['new-thread']?.reason??{text:'',hidden:true}},
  takeover:{...current.takeover,reason:current.takeover?.reason??{text:'',hidden:true}},
 }));
}
export function ThreadSearch(){const v=useStore(store,s=>s['thread-search']);return <input id="thread-search" type="search" placeholder="搜索会话" aria-label="搜索目标机器会话" autoComplete="off" disabled={v?.disabled} onInput={e=>actions['thread-search']?.(e.nativeEvent)}/>;}
function Reason({id,view}:{id:'new-thread'|'takeover';view:View|undefined}){return view?.reason?<p id={'reason-'+id} className={id==='new-thread'?'sr-only':'control-reason'} hidden={view.reason.hidden}>{view.reason.text}</p>:null;}
export function NewThreadButton(){const v=useStore(store,s=>s['new-thread']);return <><button className="new-thread" id="new-thread" aria-label="新建会话" title={v?.title??'新建会话（⌘/Ctrl+N）'} disabled={v?.disabled??true} aria-description={v?.description} aria-describedby={v?.reason?'reason-new-thread':undefined} onClick={e=>actions['new-thread']?.(e.nativeEvent)}>新建</button><Reason id="new-thread" view={v}/></>;}
export function TakeoverButton(){const v=useStore(store,s=>s.takeover);return <><button className="secondary-button" id="takeover" hidden={v?.hidden??true} disabled={v?.disabled} aria-describedby={v?.reason?'reason-takeover':undefined} onClick={e=>actions.takeover?.(e.nativeEvent)}><svg className="icon"><use href="#i-link"/></svg><span>{v?.text??'重试'}</span></button><Reason id="takeover" view={v}/></>;}
export function RefreshProjectsButton(){const v=useStore(store,s=>s['refresh-projects']);return <button className="icon-button" id="refresh-projects" title="刷新项目" aria-label="刷新项目" disabled={v?.disabled} onClick={e=>actions['refresh-projects']?.(e.nativeEvent)}><svg className="icon"><use href="#i-refresh"/></svg></button>;}
export function RefreshAllButton(){const v=useStore(store,s=>s['refresh-all']);return <button className="icon-button" id="refresh-all" title="刷新状态与会话" aria-label="刷新状态与会话" disabled={v?.disabled} onClick={e=>actions['refresh-all']?.(e.nativeEvent)}><svg className="icon"><use href="#i-refresh"/></svg></button>;}
export function MoreThreadsButton(){const v=useStore(store,s=>s['more-threads']);return <button type="button" className="load-more" id="more-threads" hidden={v?.hidden??true} disabled={v?.disabled} onClick={e=>actions['more-threads']?.(e.nativeEvent)}>{v?.text??'正在加载会话…'}</button>;}
export function ComposerAvailability(){const v=useStore(store,s=>s['composer-availability']);return <p id="composer-availability" className="composer-availability" role="status" hidden={v?.hidden??true}>{v?.text}</p>;}
