import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface Options {input:HTMLTextAreaElement;beforeOpen:()=>void;dismissMenu:()=>void}
interface Instance extends Options {id:number;store:StoreApi<{title:string|null}>;dialog:HTMLDialogElement|null;opener:HTMLElement|undefined;version:number}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function Dialog({instance}:{instance:Instance}){
 const title=useStore(instance.store).title,ref=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{
  const dialog=ref.current!;instance.dialog=dialog;
  const backdrop=(e:MouseEvent)=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();};
  const closed=()=>{if(!dialog.open&&document.activeElement!==instance.input)instance.opener?.focus();};
  dialog.addEventListener('click',backdrop);dialog.addEventListener('close',closed);
  return ()=>{dialog.removeEventListener('click',backdrop);dialog.removeEventListener('close',closed);instance.dialog=null;};
 },[instance]);
 // The catalog and goal editor own separate portals in this dialog. Changing
 // its heading must not replace their nodes or interfere with native selection.
 return createPortal(<dialog className="composer-dialog" ref={ref}>{title!==null&&<><h2>{title}</h2><button type="button" className="composer-dialog-close" onClick={()=>ref.current!.close()}>关闭</button></>}</dialog>,document.body);
}
export function ComposerDialogs(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Dialog key={instance.id} instance={instance}/>)}</>;}
export function installReactComposerDialog(options:Options){
 const instance:Instance={...options,id:++sequence,store:createStore<{title:string|null}>(()=>({title:null})),dialog:null,opener:undefined,version:0};
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));
 return {dialog:instance.dialog!,version:()=>instance.version,opener:()=>instance.opener,open(title:string,button:HTMLElement){
  instance.version++;instance.beforeOpen();instance.opener=button.closest('details')?.querySelector('summary')||button;instance.dismissMenu();
  flushSync(()=>instance.store.setState({title}));instance.dialog!.showModal();
 }};
}
