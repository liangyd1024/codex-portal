import {Fragment} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Entry {label:string;disabled?:boolean;reason?:string;run?:()=>unknown}
interface View {entries:Entry[];revision:number}
interface Instance {id:number;store:StoreApi<{view:View|null}>;node:HTMLDivElement|null;select:(entry:Entry)=>void}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function Menu({instance}:{instance:Instance}){
 const v=useStore(instance.store).view;if(!v)return null;
 return createPortal(<div key={v.revision} className="sidebar-menu" role="menu" ref={node=>{instance.node=node;}} onKeyDown={e=>{
  const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End','Tab'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowUp'||e.shiftKey?-1:1)+buttons.length)%buttons.length;buttons[next]?.focus();}
 }}>{v.entries.map((item,index)=>{const reason=item.reason&&item.disabled?item.reason:undefined;return <Fragment key={index}><button type="button" role="menuitem" disabled={!!item.disabled} title={reason} aria-description={reason} aria-describedby={reason?'sidebar-reason-'+index:undefined} onClick={()=>instance.select(item)}>{item.label}</button>{reason&&<span className="control-reason" id={'sidebar-reason-'+index}>{reason}</span>}</Fragment>;})}</div>,document.body);
}
export function SidebarMenus(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Menu key={instance.id} instance={instance}/>)}</>;}
export function installReactSidebarMenu(select:Instance['select']){
 const instance:Instance={id:++sequence,store:createStore<{view:View|null}>(()=>({view:null})),node:null,select};let revision=0;
 let registered=false;
 const register=()=>{if(!registered){registered=true;registry.setState({instances:[...registry.getState().instances,instance]});}};
 return {open(entries:Entry[]){flushSync(()=>{instance.store.setState({view:{entries,revision:++revision}});register();});return instance.node!;},close(){flushSync(()=>instance.store.setState({view:null}));}};
}
