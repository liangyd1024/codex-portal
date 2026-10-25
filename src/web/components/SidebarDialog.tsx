import {useLayoutEffect,useRef} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
type Field={kind:'text';label:string;value:string}|{kind:'select';label:string;value:string;options:{name:string;id:string}[]}|{kind:'message';text:string};
interface Options {title:string;accountScope:string;field:Field;submitLabel?:string;execute:(value:string)=>Promise<unknown>;closed:()=>void}
interface View extends Options {serial:number;pending:boolean;error:string}
interface Instance {id:number;store:StoreApi<{view:View|null}>;node:HTMLDialogElement|null}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function update(instance:Instance,serial:number,patch:Partial<View>){const view=instance.store.getState().view;if(view?.serial===serial)flushSync(()=>instance.store.setState({view:{...view,...patch}}));}
function close(instance:Instance,serial:number){const view=instance.store.getState().view;if(view?.serial!==serial)return;instance.node?.close();flushSync(()=>instance.store.setState({view:null}));view.closed();}
async function submit(instance:Instance,view:View,form:HTMLFormElement){
 if(instance.store.getState().view?.pending)return;
 const value=form.querySelector<HTMLInputElement|HTMLSelectElement>('input,select')?.value||'';
 update(instance,view.serial,{pending:true});
 try{await view.execute(value);close(instance,view.serial);}
 catch(error){update(instance,view.serial,{error:(error as Error).message});}
 finally{update(instance,view.serial,{pending:false});if(instance.store.getState().view?.serial===view.serial)instance.node?.querySelector<HTMLElement>('input,select,button')?.focus();}
}
function Form({instance,view}:{instance:Instance;view:View}){
 const ref=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{
  const dialog=ref.current!;instance.node=dialog;
  // Match native select assignment, including a missing selected option.
  if(view.field.kind==='select')dialog.querySelector('select')!.value=view.field.value;
  if(view.field.kind==='text')dialog.querySelector('input')!.value=view.field.value;
  const cancelled=(event:Event)=>{if(dialog.dataset.busy==='true')event.preventDefault();};
  const closed=()=>{if(dialog.isConnected)close(instance,view.serial);};
  const backdrop=(event:MouseEvent)=>{if(event.target!==dialog||dialog.dataset.busy==='true')return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close(instance,view.serial);};
  dialog.addEventListener('cancel',cancelled);dialog.addEventListener('close',closed);dialog.addEventListener('click',backdrop);
  return()=>{dialog.removeEventListener('cancel',cancelled);dialog.removeEventListener('close',closed);dialog.removeEventListener('click',backdrop);instance.node=null;};
 },[instance,view.serial]);
 const field=view.field;
 return createPortal(<dialog className="sidebar-dialog" aria-labelledby="sidebar-dialog-title" data-account-scope={view.accountScope} ref={ref}><form onSubmit={e=>{e.preventDefault();void submit(instance,view,e.currentTarget);}} onKeyDown={e=>{if(e.key==='Enter'&&(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229))e.preventDefault();}}><h2 id="sidebar-dialog-title">{view.title}</h2>{field.kind==='message'?<p>{field.text}</p>:<label>{field.label}{field.kind==='text'?<input required maxLength={200}/>:<select>{field.options.map((option,index)=><option key={index} value={option.id}>{option.name}</option>)}</select>}</label>}<p className="sidebar-dialog-error" role="alert">{view.error}</p><div className="sidebar-dialog-actions"><button type="button" className="secondary-button" disabled={view.pending} onClick={()=>close(instance,view.serial)}>取消</button><button type="submit" className="primary-button" disabled={view.pending}>{view.pending?'正在处理…':view.submitLabel||'保存'}</button></div></form></dialog>,document.body);
}
function Dialog({instance}:{instance:Instance}){const view=useStore(instance.store).view;return view?<Form key={view.serial} instance={instance} view={view}/>:null;}
export function SidebarDialogs(){const instances=useStore(registry).instances;return <>{instances.map(instance=><Dialog key={instance.id} instance={instance}/>)}</>;}
export function installReactSidebarDialog(){
 const instance:Instance={id:++sequence,store:createStore<{view:View|null}>(()=>({view:null})),node:null};let serial=0;
 let registered=false;
 const register=()=>{if(!registered){registered=true;registry.setState({instances:[...registry.getState().instances,instance]});}};
 return {open(options:Options){flushSync(()=>{instance.store.setState({view:{...options,serial:++serial,pending:false,error:''}});register();});const dialog=instance.node!;return {dialog,show(){dialog.showModal();dialog.querySelector<HTMLElement>('input,select,button')?.focus();if(options.field.kind==='text')dialog.querySelector('input')!.select();}};}};
}
