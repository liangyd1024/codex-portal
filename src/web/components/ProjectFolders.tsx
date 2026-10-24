import {useLayoutEffect,useRef,type FormEvent,type KeyboardEvent,type SyntheticEvent} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore} from 'zustand';
interface Entry {name:string;path:string}
interface Project {id:string;roots:string[];[key:string]:unknown}
interface Listing {path:string;parent:string|null;entries:Entry[];hostName:string}
interface Options {
 api:<T>(path:string,options?:{method?:string;body?:unknown;timeout?:number})=>Promise<T>;
 context:()=>{host:string;instance?:string;ready:boolean;open:boolean};
 onSelect:(project:Project)=>void;storage?:Storage;
}
interface View {active:boolean;busy:boolean;ready:boolean;cwd:string;parent:string|null;entries:Entry[]|null;revision:number;target:string;status:string;createHidden:boolean;showHidden:boolean;path:string;pathRevision:number;nameRevision:number}
interface Actions {close:()=>void;load:(path?:string|null)=>Promise<void>;location:(event:FormEvent)=>void;create:(event:FormEvent)=>void;use:()=>void;toggleCreate:()=>void;hidden:(checked:boolean)=>void;compositionStart:()=>void;compositionEnd:()=>void;keydown:(event:KeyboardEvent<HTMLDialogElement>)=>void;cancel:(event:SyntheticEvent)=>void;closed:()=>void}
const initial:View={active:false,busy:false,ready:false,cwd:'',parent:null,entries:null,revision:0,target:'',status:'',createHidden:true,showHidden:false,path:'',pathRevision:0,nameRevision:0};
const store=createStore<{view:View;actions:Actions|null}>(()=>({view:initial,actions:null}));
let batching=0;
function batch<T>(work:()=>T):T{return flushSync(()=>{batching++;try{return work();}finally{batching--;}});}
function publish(patch:Partial<View>){const view=store.getState().view;if(Object.entries(patch).every(([key,value])=>Object.is(view[key as keyof View],value)))return;const update=()=>store.setState({view:{...view,...patch}});if(batching)update();else flushSync(update);}

export function ProjectFolders(){
 const {view:v,actions:a}=useStore(store),path=useRef<HTMLInputElement>(null),name=useRef<HTMLInputElement>(null);
 useLayoutEffect(()=>{if(path.current)path.current.value=v.path;},[v.pathRevision]);
 useLayoutEffect(()=>{if(name.current)name.current.value='';},[v.nameRevision]);
 if(!v.active||!a)return null;
 const disabled=v.busy||!v.ready,entries=v.entries;
 return createPortal(<dialog id="project-folders-dialog" aria-labelledby="project-folders-title" aria-busy={v.busy}
 onCompositionStart={a.compositionStart} onCompositionEnd={a.compositionEnd} onKeyDown={a.keydown} onCancel={a.cancel} onClose={a.closed}>
 <header><h2 id="project-folders-title">浏览文件夹</h2><button type="button" className="icon-button" aria-label="关闭文件夹浏览" onClick={a.close}>×</button></header>
 <p className="folder-target">{v.target}</p>
 <form className="folder-location" onSubmit={a.location}><label className="sr-only" htmlFor="folder-path">目标机器绝对路径</label><input ref={path} id="folder-path" autoComplete="off" spellCheck={false} disabled={disabled}/><button type="submit" disabled={disabled}>前往</button></form>
 <nav aria-label="目录操作"><button type="button" data-action="home" disabled={disabled} onClick={()=>void a.load()}>主目录</button><button type="button" data-action="up" disabled={disabled||!v.parent} onClick={()=>void a.load(v.parent)}>上一级</button><button type="button" data-action="refresh" disabled={disabled} onClick={()=>void a.load(v.cwd||path.current?.value||undefined)}>刷新</button><button type="button" data-action="new" disabled={disabled||!v.cwd} onClick={a.toggleCreate}>新建文件夹</button></nav>
 <form className="folder-create" hidden={v.createHidden} onSubmit={a.create}><label htmlFor="folder-name">文件夹名称</label><input ref={name} id="folder-name" autoComplete="off" maxLength={255} disabled={disabled}/><button type="submit" disabled={disabled}>创建文件夹</button></form>
 <label className="folder-hidden"><input type="checkbox" checked={v.showHidden} disabled={disabled} onChange={e=>a.hidden(e.currentTarget.checked)}/>显示隐藏文件夹</label>
 <div className="folder-list" aria-label="文件夹列表">{entries&&(entries.length?entries.map((entry,index)=><button key={v.revision+':'+index} type="button" title={entry.path} disabled={disabled} onClick={()=>void a.load(entry.path)}>{entry.name}</button>):<p>此处没有可显示的子文件夹</p>)}</div>
 <p className="folder-status" role="status" aria-live="polite">{v.status}</p><p className="folder-limit">项目可在网页版使用。如需在 Codex 桌面显示，请在桌面添加同一文件夹。</p>
 <footer><button type="button" className="primary-button folder-use" disabled={disabled||!v.cwd} onClick={a.use}>{v.busy?'正在处理…':'使用此文件夹'}</button></footer>
 </dialog>,document.body);
}
export function installProjectFolders({api,context,onSelect,storage=sessionStorage}:Options){
 let dialog:HTMLDialogElement,pathInput:HTMLInputElement,name:HTMLInputElement;
 let cwd='',parent:string|null=null,entries:Entry[]=[],busy=false,epoch=0,contextKey='',composing=false,compositionEnded=0,returnFocus:HTMLElement|undefined;
 const active=(token:number)=>dialog.open&&token===epoch&&context().ready;
 const pendingKeys=new Map<string,string>();
 function keyFor(path:string){
  const pending=pendingKeys.get(path);if(pending)return pending;
  const key='rcm.project-create.'+context().host+':'+path;
  let id:string|null=null;try{id=storage.getItem(key);}catch{}
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))id=crypto.randomUUID();
  const value=id!;try{storage.setItem(key,value);}catch{throw new Error('浏览器无法保存创建回执，请允许浏览器存储后重试。');}pendingKeys.set(path,value);return value;
 }
 function controls(){publish({busy,ready:context().ready,cwd,parent});}
 function render(){const visible=entries.filter(e=>store.getState().view.showHidden||!e.name.startsWith('.'));publish({entries:visible,revision:store.getState().view.revision+1,busy,ready:context().ready,cwd,parent});}
 async function run(work:(token:number)=>Promise<unknown>){
  if(busy||!context().ready)return;
  const token=epoch;let failure:string|undefined;
  try{await batch(()=>{busy=true;publish({status:'正在处理…'});controls();return work(token);});}
  catch(error){if(active(token))failure=String((error as {message?:unknown})?.message||'请求失败，请重试。');}
  finally{batch(()=>{if(failure!==undefined)publish({status:failure});busy=false;controls();});}
 }
 async function read(path:string|null|undefined,token:number){
  if(!active(token))return false;cwd='';parent=null;entries=[];publish({entries:null});controls();
  const result=await api<Listing>('/api/project-folders'+(path?'?path='+encodeURIComponent(path):''),{timeout:25000});
  if(!active(token))return false;
  cwd=result.path;parent=result.parent;entries=result.entries;
  batch(()=>{publish({path:cwd,pathRevision:store.getState().view.pathRevision+1,target:'目标机器：'+result.hostName,status:''});render();});return true;
 }
 function load(path?:string|null){return run(token=>read(path,token));}
 function sync(){
  const c=context(),key=c.host+':'+c.instance+':'+c.ready;
  if(key!==contextKey){contextKey=key;epoch++;if(dialog.open&&!c.ready)publish({status:'连接不可用，输入已保留。恢复连接后请刷新目录。'});}
  if(dialog.open&&!c.open)dialog.close();controls();
 }
 const actions:Actions={close:()=>dialog.close(),load,
  location:event=>{event.preventDefault();if(!composing&&Date.now()-compositionEnded>=100)void load(pathInput.value);},
  create:event=>{event.preventDefault();if(composing||Date.now()-compositionEnded<100)return;const parentPath=cwd,folderName=name.value;
   void run(async token=>{const result=await api<Listing>('/api/project-folders',{method:'POST',body:{parent:parentPath,name:folderName},timeout:25000});if(!active(token))return;publish({createHidden:true,nameRevision:store.getState().view.nameRevision+1});await read(result.path,token);});},
  use:()=>{const selected=cwd;void run(async token=>{const idempotencyKey=keyFor(selected);const result=await api<{project:Project}>('/api/projects/open',{method:'POST',body:{path:selected,idempotencyKey},timeout:90000});if(!active(token))return;onSelect(result.project);pendingKeys.delete(selected);try{storage.removeItem('rcm.project-create.'+context().host+':'+selected);}catch{}dialog.close();});},
  toggleCreate:()=>{const createHidden=!store.getState().view.createHidden;publish({createHidden});if(!createHidden)name.focus();},
  hidden:showHidden=>batch(()=>{publish({showHidden});render();}),
  compositionStart:()=>{composing=true;},compositionEnd:()=>{composing=false;compositionEnded=Date.now();},
  keydown:event=>{event.stopPropagation();if(event.nativeEvent.isComposing||composing||event.keyCode===229||Date.now()-compositionEnded<100){if(event.key==='Enter')event.preventDefault();return;}if(event.key==='Escape'){event.preventDefault();dialog.close();}},
  cancel:event=>{if(composing||Date.now()-compositionEnded<100)event.preventDefault();},
  closed:()=>{epoch++;if(busy)publish({status:'请求可能仍在目标机器执行，请刷新目录核对后继续。'});if(context().open)returnFocus?.focus();},
 };
 flushSync(()=>store.setState({view:{...initial,active:true},actions}));
 dialog=document.getElementById('project-folders-dialog') as HTMLDialogElement;
 pathInput=dialog.querySelector<HTMLInputElement>('#folder-path')!;name=dialog.querySelector<HTMLInputElement>('#folder-name')!;
 return {sync,open(anchor:HTMLElement){returnFocus=anchor;sync();if(!context().ready)return;epoch++;dialog.showModal();if(!busy)void load(cwd||undefined);else publish({status:'上一请求仍在确认，请稍候。'});}};
}
