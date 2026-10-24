import {Fragment} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {createStore,useStore,type StoreApi} from 'zustand';
import type {AttachmentItem as Item,AttachmentView as View,AttachmentViewOptions as Options} from '../services/attachments';
interface State {view:View|null;revision:number;picture:Item|null;pictureRevision:number}
interface Instance extends Options {key:number;store:StoreApi<State>}
const registry=createStore<{instances:Instance[]}>(()=>({instances:[]}));let sequence=0;
function AttachmentView({instance}:{instance:Instance}){
 const {view,revision,picture,pictureRevision}=useStore(instance.store);
 const show=(item:Item)=>{
  flushSync(()=>instance.store.setState(s=>({picture:{...item},pictureRevision:s.pictureRevision+1})));
  instance.preview.showModal();
 };
 // Match the original card rebuild on render, including focus loss. The list
 // shell and its clipboard selection class remain owned by the controller.
 return <>{createPortal(view?<Fragment key={revision}>{view.items.map(item=><div className="attachment-card" key={item.id}><button type="button" className="attachment-preview" aria-label={'预览 '+item.name} disabled={!item.url} onClick={item.url?()=>show(item):undefined}>{item.url?<img src={item.url} alt={item.name}/>: '处理中…'}</button><button type="button" aria-label={'移除 '+item.name} disabled={view.busy} onClick={()=>instance.remove(view.id,item.id)}>×</button></div>)}</Fragment>:null,instance.list)}{createPortal(picture?<Fragment key={pictureRevision}><button type="button" onClick={()=>instance.preview.close()}>关闭</button><img src={picture.url} alt={picture.name}/></Fragment>:null,instance.preview)}</>;
}
export function AttachmentViews(){const instances=useStore(registry).instances;return <>{instances.map(instance=><AttachmentView key={instance.key} instance={instance}/>)}</>;}
export function installReactAttachmentView(options:Options){
 const instance:Instance={...options,key:++sequence,store:createStore<State>(()=>({view:null,revision:0,picture:null,pictureRevision:0}))};
 flushSync(()=>registry.setState({instances:[...registry.getState().instances,instance]}));
 const buttonState=createStore(()=>({disabled:false}));
 return {images:{store:buttonState,open:options.openFiles,setDisabled(disabled:boolean){if(buttonState.getState().disabled!==disabled)flushSync(()=>buttonState.setState({disabled}));}},render(view:View){
  const old=instance.store.getState().view;
  const same=old&&old.id===view.id&&old.busy===view.busy&&old.items.length===view.items.length&&old.items.every((item,i)=>item.id===view.items[i]!.id&&item.name===view.items[i]!.name&&item.url===view.items[i]!.url);
  // Typing does not change the cards. Skip that render only when rebuilding
  // would not clear a card's focus, hover, or selected text in the baseline.
  const selection=window.getSelection();
  if(same&&!options.list.contains(document.activeElement)&&!options.list.matches(':hover')&&!options.list.contains(selection?.anchorNode??null)&&!options.list.contains(selection?.focusNode??null))return;
  flushSync(()=>instance.store.setState(s=>({view:{...view,items:view.items.map(item=>({...item}))},revision:s.revision+1})));
 }};
}
