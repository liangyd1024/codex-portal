import {Fragment,useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
interface QueuePart {type:string;text?:string;[key:string]:unknown}
interface QueueItem {id:string;input?:QueuePart[];[key:string]:unknown}
interface QueueContext {host:string;id:string|null;queue?:{data?:QueueItem[]};visible:boolean;ready:boolean;running:boolean;supported:boolean;editable:boolean}
interface QueueOptions {
 host:HTMLElement;context:()=>QueueContext;
 api:(path:string,options:{method:'POST';body:{queuedSubmissionId:string;text?:string;expectedText?:string}})=>Promise<unknown>;
 refresh:()=>Promise<unknown>;onError:(error:unknown)=>void;
}
type QueueAction='steer'|'delete';
interface QueueView {signature:string;items:QueueItem[];context:QueueContext;busy:Set<string>}
const contextKey=(context:QueueContext)=>JSON.stringify([context.host,context.id]);
const content=(item:QueueItem)=>(item.input||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
const message=(error:unknown)=>(error as {message:string}).message;
function Icon({kind}:{kind:'edit'|'clear'}){return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={kind==='edit'?'M5 4v10a4 4 0 0 0 4 4h10m-4-4 4 4-4 4':'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7'}/></svg>;}
function QueueRows({store,act,edit}:{store:StoreApi<QueueView>;act:(item:QueueItem,action:QueueAction)=>Promise<void>;edit:(item:QueueItem)=>void}) {
 const view=useStore(store),c=view.context;
 return <Fragment key={view.signature}>{view.items.map((item,index)=>{
  const text=content(item)||'图片或引用消息',pending=view.busy.has(contextKey(c)+':'+item.id),disabled=!c.ready||!c.supported||pending;
  return <div className="composer-queue-row goal-toolbar" aria-busy={pending} key={index}>
   <button className="goal-edit queue-edit" type="button" data-id={item.id} title={text} aria-label={'编辑排队消息：'+text} disabled={!c.ready||!c.editable||pending} onClick={()=>edit(item)}><Icon kind="edit"/><span className="composer-queue-text">{text}</span></button>
   <button className="goal-clear" type="button" title="删除排队消息" aria-label="删除排队消息" disabled={disabled} onClick={()=>void act(item,'delete')}><Icon kind="clear"/></button>
   <button className="queue-guide" type="button" title={c.running?'引导当前任务':'立即发送'} aria-label={c.running?'引导当前任务':'立即发送'} disabled={disabled} onClick={()=>void act(item,'steer')}>{c.running?'引导':'发送'}</button>
  </div>;
 })}</Fragment>;
}
interface Editor {text:string;revision:number;feedback:string;disabled:boolean;busy?:boolean;input:(text:string)=>void;submit:()=>void;reload:()=>void;cancel:()=>void;composition:(value:boolean)=>void}
function QueueEditor({store}:{store:StoreApi<Editor>}){
 const v=store.getState(),area=useRef<HTMLTextAreaElement>(null),form=useRef<HTMLFormElement>(null),feedback=useRef<HTMLParagraphElement>(null),reload=useRef<HTMLButtonElement>(null),submit=useRef<HTMLButtonElement>(null),composing=useRef(false);
 useLayoutEffect(()=>{
  // React owns the nodes; this subscription alone owns their changing properties.
  // Native updates retain the baseline's transient disabled/focus behavior.
  let revision=-1;
  const apply=()=>{const state=store.getState();if(revision!==state.revision){area.current!.value=state.text;revision=state.revision;}area.current!.readOnly=state.disabled;reload.current!.disabled=submit.current!.disabled=state.disabled;feedback.current!.textContent=state.feedback;if(state.busy===undefined)form.current!.removeAttribute('aria-busy');else form.current!.setAttribute('aria-busy',String(state.busy));};
  apply();return store.subscribe(apply);
 },[store]);
 return <><h2>编辑排队消息</h2><form ref={form} className="composer-goal" onSubmit={e=>{e.preventDefault();v.submit();}} onKeyDown={e=>{if(e.key==='Enter'&&(composing.current||e.nativeEvent.isComposing||e.keyCode===229))e.stopPropagation();}}>
 <label>消息内容<textarea ref={area} rows={7} maxLength={100000} onInput={e=>v.input(e.currentTarget.value)} onCompositionStart={()=>{composing.current=true;v.composition(true);}} onCompositionEnd={()=>{composing.current=false;v.composition(false);}}/></label>
 <p ref={feedback} role="status"></p><div className="goal-edit-actions"><button ref={reload} type="button" onClick={v.reload}>重新读取消息</button><button type="button" onClick={v.cancel}>取消</button><button ref={submit} type="submit">保存</button></div>
 </form></>;
}
export function installQueuedInputs({host,context,api,refresh,onError}:QueueOptions) {
 const list=document.createElement('div');list.className='composer-queue';list.setAttribute('aria-label','排队消息');list.hidden=true;host.querySelector('form.composer')!.before(list);
 const dialog=document.createElement('dialog');dialog.className='composer-dialog queue-edit-dialog';dialog.setAttribute('aria-label','编辑排队消息');document.body.append(dialog);
 const store=createStore<QueueView>(()=>({signature:'',items:[],context:context(),busy:new Set()}));
 // Empty hosts need neither React roots nor delegated event listeners. Mount
 // synchronously on first use, before exposing rows or focusing the editor.
 let root:ReturnType<typeof createRoot>|undefined,editorRoot:ReturnType<typeof createRoot>|undefined;
 let mounted=false,signature='',serial=0,editing:{scope:string;id:string}|null=null,editorSerial=0;
 const busy=new Set<string>(),versions=new WeakMap<QueueItem,number>(),drafts=new Map<string,{base:string;text:string}>();
 const version=(item:QueueItem)=>{if(!versions.has(item))versions.set(item,++serial);return versions.get(item);};
 const itemKey=(c:QueueContext,item:QueueItem)=>contextKey(c)+':'+item.id;
 dialog.addEventListener('close',()=>{const previous=editing;editing=null;if(previous&&contextKey(context())===previous.scope)list.querySelectorAll<HTMLButtonElement>('.queue-edit').forEach(b=>{if(b.dataset.id===previous.id)b.focus();});});
 async function act(item:QueueItem,action:QueueAction){
  const c=context(),key=itemKey(c,item);if(busy.has(key)||!c.ready||!c.supported)return;busy.add(key);render();
  try{await api('/api/threads/'+encodeURIComponent(String(c.id))+'/queue-'+action,{method:'POST',body:{queuedSubmissionId:item.id}});drafts.delete(key);}
  catch(error){if(contextKey(context())===contextKey(c))onError(error);}
  finally{busy.delete(key);if(contextKey(context())===contextKey(c)){await refresh().catch(onError);signature='';render();}}
 }
 function edit(item:QueueItem){
  const c=context(),key=itemKey(c,item);if(!c.ready||!c.editable||busy.has(key))return;
  const draft=drafts.get(key)||{base:content(item),text:content(item)};drafts.set(key,draft);
  const session={scope:contextKey(c),id:item.id};editing=session;
  const same=()=>editing===session&&contextKey(context())===contextKey(c)&&dialog.open;
  let composing=false,reloading=false;
  const editor=createStore<Editor>(()=>({text:draft.text,revision:0,feedback:'',disabled:false,input:text=>{draft.text=text;},composition:value=>{composing=value;},cancel:()=>dialog.close(),reload:()=>void reload(),submit:()=>void submit()}));
  const update=(value:Partial<Editor>)=>editor.setState(value);
  async function reload(){
   if(busy.has(key)||reloading)return;reloading=true;update({disabled:true});
   try{await refresh();if(!same())return;const latest=context().queue?.data?.find(q=>q.id===item.id);if(!latest)throw Error('消息已离开队列，草稿已保留。');draft.base=content(latest);draft.text=draft.base;update({text:draft.text,revision:editor.getState().revision+1,feedback:'已读取当前消息。'});}
   catch(error){if(same())update({feedback:message(error)});}
   finally{reloading=false;if(same())update({disabled:false});}
  }
  async function submit(){
   if(composing||reloading||!same()||busy.has(key))return;
   const now=context();if(!now.ready||!now.editable){update({feedback:'连接尚未恢复，草稿已保留。'});return;}
   if(draft.text===draft.base){drafts.delete(key);dialog.close();return;}
   // Finish the row commit before disabling the focused editor control.
   // Both updates remain synchronous and precede the request.
   busy.add(key);render();update({disabled:true,feedback:'正在保存…',busy:true});
   try{await api('/api/threads/'+encodeURIComponent(String(c.id))+'/queue-update',{method:'POST',body:{queuedSubmissionId:item.id,text:draft.text,expectedText:draft.base}});drafts.delete(key);if(same())dialog.close();if(contextKey(context())===contextKey(c))await refresh();}
   catch(error){if(same())update({feedback:message(error)});}
   finally{busy.delete(key);if(same())update({disabled:false,busy:false});signature='';render();}
  }
  flushSync(()=>(editorRoot??=createRoot(dialog)).render(<QueueEditor key={++editorSerial} store={editor}/>));dialog.showModal();dialog.querySelector('textarea')!.focus();
 }
 function render(){
  const c=context();if(editing&&(!c.visible||editing.scope!==contextKey(c)))dialog.close();
  const items=c.visible?(c.queue?.data||[]):[],next=JSON.stringify([contextKey(c),items.map(version),c.ready,c.running,c.supported,c.editable,[...busy]]);
  if(next===signature)return;signature=next;list.hidden=!items.length;
  const view={signature:next,items,context:c,busy:new Set(busy)};
  if(!mounted&&!items.length){store.setState(view);return;}
  flushSync(()=>{store.setState(view);if(!mounted){(root??=createRoot(list)).render(<QueueRows store={store} act={act} edit={edit}/>);mounted=true;}});
 }
 return {render};
}
