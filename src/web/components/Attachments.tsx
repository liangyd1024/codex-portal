import {Fragment,createRef,useLayoutEffect,type RefObject} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import type {AttachmentItem as Item,AttachmentView as View,AttachmentViewOptions as Options} from '../services/attachments';
interface State {view:View|null;revision:number;picture:Item|null;pictureRevision:number}
interface Instance extends Options {key:number;store:StoreApi<State>;list:RefObject<HTMLDivElement|null>;preview:RefObject<HTMLDialogElement|null>;file:RefObject<HTMLInputElement|null>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function AttachmentView({instance}:{instance:Instance}){
 const {view,revision,picture,pictureRevision}=useStore(instance.store);
 // Keep the original form order before annotation controls are installed.
 useLayoutEffect(()=>{instance.form.prepend(instance.list.current!);instance.form.append(instance.file.current!);},[instance]);
 const show=(item:Item)=>{
  flushSync(()=>instance.store.setState(s=>({picture:{...item},pictureRevision:s.pictureRevision+1})));
  instance.preview.current!.showModal();
 };
 // The clipboard adapter only toggles its selection class; React owns the nodes.
 const formContent=<><div ref={instance.list} className="attachment-list" aria-label="待发送图片" hidden={!view?.items.length}>{view?<Fragment key={revision}>{view.items.map(item=><div className="attachment-card" key={item.id}><button type="button" className="attachment-preview" aria-label={'预览 '+item.name} disabled={!item.url} onClick={item.url?()=>show(item):undefined}>{item.url?<img src={item.url} alt={item.name}/>: '处理中…'}</button><button type="button" aria-label={'移除 '+item.name} disabled={view.busy} onClick={()=>instance.remove(view.id,item.id)}>×</button></div>)}</Fragment>:null}</div><input ref={instance.file} type="file" accept="image/*" multiple hidden id={instance.prefix+'image-files'} onChange={event=>{const files=[...event.currentTarget.files!];event.currentTarget.value='';void instance.addFiles(files);}}/></>;
 return <>{instance.form.id==='message-form'?formContent:createPortal(formContent,instance.form)}{createPortal(<dialog ref={instance.preview} className="composer-dialog image-preview" onClick={event=>{if(event.target===event.currentTarget)event.currentTarget.close();}}>{picture?<Fragment key={pictureRevision}><button type="button" onClick={()=>instance.preview.current!.close()}>关闭</button><img src={picture.url} alt={picture.name}/></Fragment>:null}</dialog>,document.body)}</>;

}
export function MainAttachments(){const instance=useStore(registry).instances.find(instance=>instance.form.id==='message-form');return instance?<AttachmentView instance={instance}/>:null;}
export function AttachmentViews(){const instances=useStore(registry).instances;return <>{instances.filter(instance=>instance.form.id!=='message-form').map(instance=><AttachmentView key={instance.key} instance={instance}/>)}</>;}
export function installReactAttachmentView(options:Options){
 const instance:Instance={...options,list:createRef(),preview:createRef(),file:createRef(),key:++sequence,store:createStore<State>(()=>({view:null,revision:0,picture:null,pictureRevision:0}))};
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));
 const buttonState=createStore(()=>({disabled:false}));
 const list=instance.list.current!,preview=instance.preview.current!;
 return {list,preview,images:{store:buttonState,open:()=>instance.file.current!.click(),setDisabled(disabled:boolean){if(buttonState.getState().disabled!==disabled)flushSync(()=>buttonState.setState({disabled}));}},render(view:View){
  const old=instance.store.getState().view;
  const same=old&&old.id===view.id&&old.busy===view.busy&&old.items.length===view.items.length&&old.items.every((item,i)=>item.id===view.items[i]!.id&&item.name===view.items[i]!.name&&item.url===view.items[i]!.url);
  // Typing does not change the cards. Skip that render only when rebuilding
  // would not clear a card's focus, hover, or selected text in the baseline.
  const selection=window.getSelection();
  if(same&&!list.contains(document.activeElement)&&!list.matches(':hover')&&!list.contains(selection?.anchorNode??null)&&!list.contains(selection?.focusNode??null))return;
  flushSync(()=>instance.store.setState(s=>({view:{...view,items:view.items.map(item=>({...item}))},revision:s.revision+1})));
 }};
}
